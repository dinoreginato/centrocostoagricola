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

export async function fetchPendingGeneralCosts(params: { companyId: string }) {
  const pageSize = 5000;
  let from = 0;
  const items: GeneralCostInvoiceItemRow[] = [];

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
      .or(
        [
          'category.ilike.%insumo%',
          'category.ilike.%servicio%',
          'category.ilike.%transporte%',
          'category.ilike.%honorario%',
          'category.ilike.%otro%',
          'category.is.null'
        ].join(',')
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    ((data || []) as unknown as GeneralCostInvoiceItemRow[]).forEach((r) => items.push(r));
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

  const filteredItems = items.filter((item) => {
    const cat = normalize(item.category || item.products?.category || '');
    if (!cat) return true;
    return ['insumo', 'servicio', 'transporte', 'honorario', 'otro'].some((k) => cat.includes(k));
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
    const grossAmount = itemNet * (1 + taxPercent / 100);

    const total = isCreditNote ? -Math.abs(grossAmount) : Math.abs(grossAmount);
    const assigned = assignmentMap.get(String(item.id)) || 0;
    const remaining = total - assigned;

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
