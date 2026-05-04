import { supabase } from '../supabase/client';

type GeneralCostInvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  company_id: string;
  document_type: string | null;
  tax_percentage?: number | null;
  exempt_amount?: number | null;
  special_tax_amount?: number | null;
  total_amount?: number | null;
};

type GeneralCostProductRow = { name: string | null; category: string | null } | null;

type GeneralCostInvoiceItemRow = {
  id: string;
  total_price: number | null;
  category: string | null;
  products?: GeneralCostProductRow;
  invoices: GeneralCostInvoiceRow;
};

type GeneralCostSummaryRow = { invoice_item_id: string; total_assigned: number | null };

export type PendingGeneralCostItem = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  date: string;
  description: string;
  category: string | null;
  total_amount: number;
  assigned_amount: number;
  remaining_amount: number;
};

export type GeneralCostHistoryItem = {
  id: string;
  assigned_amount: number;
  assigned_date: string;
  sector_id?: string | null;
  invoice_item_id: string;
  category: string;
  description: string;
  sectors: { name?: string | null } | null;
  invoice_items: {
    products?: { name?: string | null } | null;
    invoices?: { invoice_number?: string | null } | null;
  } | null;
};

export type GeneralCostInsert = {
  company_id: string;
  invoice_item_id: string;
  sector_id: string;
  amount: number;
  date: string;
  category: string;
  description: string;
};

type GeneralCostRaw = {
  id: string;
  amount: number;
  date: string;
  invoice_item_id: string;
  category: string;
  description: string;
  sectors: { id?: string | null; name?: string | null } | null;
  invoice_items: GeneralCostHistoryItem['invoice_items'];
};

export async function fetchGeneralCostsDiagnosis(params: { companyId: string; query: string }) {
  const q = String(params.query || '').trim();
  if (!q) return { invoices: [], items: [], assignedByItemId: {} as Record<string, number> };

  const { data: invoices, error: invError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, supplier, company_id, document_type, tax_percentage, exempt_amount, special_tax_amount, total_amount')
    .eq('company_id', params.companyId)
    .ilike('invoice_number', `%${q}%`)
    .order('invoice_date', { ascending: false })
    .range(0, 49);

  if (invError) throw invError;

  const { data: products, error: prodError } = await supabase
    .from('products')
    .select('id')
    .eq('company_id', params.companyId)
    .ilike('name', `%${q}%`)
    .range(0, 49);

  if (prodError) throw prodError;

  const productIds = (products || []).map((p: any) => String(p.id));
  const invoiceIds = Array.from(new Set((invoices || []).map((i: any) => String(i.id))));

  const items: any[] = [];

  if (invoiceIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < invoiceIds.length; i += chunkSize) {
      const chunk = invoiceIds.slice(i, i + chunkSize);
      const { data: invItems, error: invItemsError } = await supabase
        .from('invoice_items')
        .select('id, invoice_id, product_id, total_price, category, created_at, products(name, category), invoices!inner(id, invoice_number, invoice_date, company_id, document_type, tax_percentage, exempt_amount, special_tax_amount, total_amount)')
        .in('invoice_id', chunk)
        .eq('invoices.company_id', params.companyId)
        .order('created_at', { ascending: false })
        .range(0, 200);
      if (invItemsError) throw invItemsError;
      (invItems || []).forEach((r: any) => items.push(r));
    }
  }

  if (productIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const { data: prodItems, error: prodItemsError } = await supabase
        .from('invoice_items')
        .select('id, invoice_id, product_id, total_price, category, created_at, products(name, category), invoices!inner(id, invoice_number, invoice_date, company_id, document_type, tax_percentage, exempt_amount, special_tax_amount, total_amount)')
        .in('product_id', chunk)
        .eq('invoices.company_id', params.companyId)
        .order('created_at', { ascending: false })
        .range(0, 200);
      if (prodItemsError) throw prodItemsError;
      (prodItems || []).forEach((r: any) => items.push(r));
    }
  }

  const itemIds = Array.from(new Set(items.map((r) => String(r.id))));
  const assignedByItemId: Record<string, number> = {};
  if (itemIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < itemIds.length; i += chunkSize) {
      const chunk = itemIds.slice(i, i + chunkSize);
      const { data: gc, error: gcError } = await supabase.from('general_costs').select('invoice_item_id, amount').in('invoice_item_id', chunk);
      if (gcError) throw gcError;
      (gc || []).forEach((row: any) => {
        const key = String(row.invoice_item_id);
        assignedByItemId[key] = (assignedByItemId[key] || 0) + Number(row.amount || 0);
      });
    }
  }

  return { invoices: invoices || [], items, assignedByItemId };
}

export async function fetchPendingGeneralCosts(params: { companyId: string }) {
  const pageSize = 5000;
  let from = 0;
  const items: GeneralCostInvoiceItemRow[] = [];
  const invoiceSubtotals = new Map<string, number>();

  while (true) {
    const { data, error } = await supabase
      .from('invoice_items')
      .select(
        `
        id, total_price, category,
        created_at,
        products (name, category),
        invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage, exempt_amount, special_tax_amount, total_amount)
      `
      )
      .eq('invoices.company_id', params.companyId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    ((data || []) as unknown as GeneralCostInvoiceItemRow[]).forEach((r) => {
      items.push(r);
      const invId = String(r.invoices.id);
      invoiceSubtotals.set(invId, (invoiceSubtotals.get(invId) || 0) + Number(r.total_price || 0));
    });
    if (!data || data.length < pageSize) break;
    from += pageSize;
    if (from >= 200000) break;
  }

  const normalize = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const isExcludedFromDistribution = (cat: string) => {
    if (!cat) return false;
    const keywords = [
      'mano de obra',
      'labores',
      'servicio de labores',
      'petroleo',
      'diesel',
      'bencina',
      'combustible',
      'riego',
      'agua',
      'electricidad',
      'maquinaria',
      'arriendo maquinaria',
      'repuesto',
      'mantencion',
      'quimic',
      'fertiliz',
      'pestic',
      'fungic',
      'herbic',
      'insectic',
      'plaguicid'
    ];
    return keywords.some((k) => cat.includes(k));
  };

  const filteredItems = items.filter((item) => {
    const cat = normalize(item.category || item.products?.category || '');
    return !isExcludedFromDistribution(cat);
  });

  const { data: assignments, error: assignmentError } = await supabase.rpc('get_general_costs_summary', { p_company_id: params.companyId });
  if (assignmentError) throw assignmentError;

  const assignmentMap = new Map<string, number>();
  ((assignments || []) as unknown as GeneralCostSummaryRow[]).forEach((a) => {
    assignmentMap.set(String(a.invoice_item_id), Number(a.total_assigned || 0));
  });

  const pending: PendingGeneralCostItem[] = [];

  filteredItems.forEach((item) => {
    const docType = String(item.invoices.document_type || '').toLowerCase();
    const isCreditNote = docType.includes('nota de cr') || docType.includes('nc');

    let taxPercent = item.invoices.tax_percentage !== undefined ? item.invoices.tax_percentage : 19;
    if (docType.includes('exenta') || docType.includes('honorario')) taxPercent = 0;

    const itemNet = Number(item.total_price) || 0;
    const invId = String(item.invoices.id);
    const invoiceSubtotal = invoiceSubtotals.get(invId) || 0;
    const invoiceExempt = Number(item.invoices.exempt_amount) || 0;
    const invoiceSpecial = Number(item.invoices.special_tax_amount) || 0;

    const itemProportion = invoiceSubtotal > 0 ? itemNet / invoiceSubtotal : 1;
    const itemExemptShare = itemProportion * invoiceExempt;
    const itemSpecialShare = itemProportion * invoiceSpecial;

    const itemTaxAmount = itemNet * (taxPercent / 100);
    const grossAmount = itemNet + itemTaxAmount + itemExemptShare + itemSpecialShare;

    const total = isCreditNote ? -Math.abs(grossAmount) : Math.abs(grossAmount);
    const assigned = assignmentMap.get(String(item.id)) || 0;
    let remaining = total - assigned;
    if (!isCreditNote && remaining < 0) remaining = 0;

    if (Math.abs(remaining) > 1) {
      pending.push({
        id: String(item.id),
        invoice_id: String(item.invoices.id),
        invoice_number: String(item.invoices.invoice_number),
        date: String(item.invoices.invoice_date),
        description: `${item.products?.name || 'Item'} [${item.category}]`,
        category: item.category,
        total_amount: total,
        assigned_amount: assigned,
        remaining_amount: remaining
      });
    }
  });

  return pending;
}

export async function fetchGeneralCostsHistory(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('general_costs')
    .select(
      `
      id, amount, date, category, description, invoice_item_id,
      sectors (name),
      invoice_items (
        products (name),
        invoices (invoice_number)
      )
    `
    )
    .eq('company_id', params.companyId)
    .order('date', { ascending: false })
    .limit(5000);

  if (error) throw error;

  const rows = (data || []) as unknown as GeneralCostRaw[];
  return rows.map((d) => ({
    id: d.id,
    assigned_amount: d.amount,
    assigned_date: d.date,
    sector_id: d.sectors?.id,
    invoice_item_id: d.invoice_item_id,
    category: d.category,
    description: d.description,
    sectors: d.sectors,
    invoice_items: d.invoice_items
  })) as GeneralCostHistoryItem[];
}

export async function deleteGeneralCostAssignment(params: { id: string }) {
  const { error } = await supabase.from('general_costs').delete().eq('id', params.id);
  if (error) throw error;
}

export async function deleteAllGeneralCostHistory(params: { companyId: string }) {
  const { error } = await supabase.from('general_costs').delete().eq('company_id', params.companyId);
  if (error) throw error;
}

export async function updateGeneralCostAssignment(params: { id: string; sectorId: string; amount: number; date: string }) {
  const { error } = await supabase
    .from('general_costs')
    .update({
      sector_id: params.sectorId,
      amount: params.amount,
      date: params.date
    })
    .eq('id', params.id);

  if (error) throw error;
}

export async function insertGeneralCostAssignments(params: { rows: GeneralCostInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('general_costs').insert(params.rows);
  if (error) throw error;
}
