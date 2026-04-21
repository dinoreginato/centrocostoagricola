import { supabase } from '../supabase/client';

export async function fetchPendingGeneralCosts(params: { companyId: string }) {
  const { data: items, error } = await supabase
    .from('invoice_items')
    .select(
      `
      id, total_price, category,
      products (name, category),
      invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage, exempt_amount, special_tax_amount, total_amount)
    `
    )
    .eq('invoices.company_id', params.companyId)
    .range(0, 9999);

  if (error) throw error;

  const CORE_EXCLUDED = [
    'mano de obra',
    'labores agricolas',
    'labores agricolas',
    'servicio de labores',
    'petroleo',
    'combustible',
    'diesel',
    'bencina',
    'riego',
    'agua',
    'electricidad',
    'maquinaria',
    'arriendo maquinaria',
    'repuesto',
    'mantencion',
    'quimicos',
    'fertilizantes',
    'pesticida',
    'fungicida',
    'herbicida',
    'insecticida',
    'semillas',
    'plantas',
    'plaguicida'
  ];

  const filteredItems = (items || []).filter((item: any) => {
    const rawCat = item.category || item.products?.category || '';
    const cat = String(rawCat).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const isCore = CORE_EXCLUDED.some((ex) => cat.includes(ex));
    return !isCore;
  });

  const { data: assignments, error: assignmentError } = await supabase.rpc('get_general_costs_summary', { p_company_id: params.companyId });
  if (assignmentError) throw assignmentError;

  const assignmentMap = new Map<string, number>();
  (assignments || []).forEach((a: any) => {
    assignmentMap.set(String(a.invoice_item_id), Number(a.total_assigned));
  });

  const invoiceSubtotals = new Map<string, number>();
  (items || []).forEach((item: any) => {
    const invId = String(item.invoices.id);
    const currentSum = invoiceSubtotals.get(invId) || 0;
    invoiceSubtotals.set(invId, currentSum + Number(item.total_price || 0));
  });

  const pending: any[] = [];

  filteredItems.forEach((item: any) => {
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
    const remaining = total - assigned;

    if (Math.abs(remaining) > 500) {
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
    .limit(500);

  if (error) throw error;

  return (data || []).map((d: any) => ({
    id: d.id,
    assigned_amount: d.amount,
    assigned_date: d.date,
    sector_id: d.sectors?.id,
    invoice_item_id: d.invoice_item_id,
    category: d.category,
    description: d.description,
    sectors: d.sectors,
    invoice_items: d.invoice_items
  })) as any[];
}

export async function deleteGeneralCostAssignment(params: { id: string }) {
  const { error } = await supabase.from('general_costs').delete().eq('id', params.id);
  if (error) throw error;
}

export async function deleteAllGeneralCostHistory(params: { companyId: string }) {
  const { error } = await supabase.from('general_costs').delete().eq('company_id', params.companyId);
  if (error) throw error;
}

