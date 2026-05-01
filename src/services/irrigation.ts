import { supabase } from '../supabase/client';

export type IrrigationPendingItem = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  date: string;
  description: string;
  total_amount: number;
  assigned_amount: number;
  remaining_amount: number;
};

type IrrigationSummaryRow = { invoice_item_id: string; total_assigned: number | null };
type IrrigationFallbackRow = { invoice_item_id: string; assigned_amount: number | null };

type IrrigationInvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  company_id: string;
  document_type: string | null;
  tax_percentage?: number | null;
};

type IrrigationInvoiceItemRow = {
  id: string;
  total_price: number | null;
  category: string | null;
  products?: { name: string | null; category: string | null } | null;
  invoices: IrrigationInvoiceRow;
};

export type IrrigationHistoryRow = {
  id: string;
  assigned_amount: number;
  assigned_date: string;
  sector_id: string | null;
  invoice_item_id: string;
  sectors: { name: string | null } | null;
  invoice_items: {
    products?: { name: string | null } | null;
    invoices?: { invoice_number: string | null; company_id?: string | null } | null;
  };
};

export type IrrigationAssignmentInsert = {
  invoice_item_id: string;
  sector_id: string;
  assigned_amount: number;
  assigned_date: string;
  notes?: string | null;
};

export async function fetchIrrigationAssignmentsSummary(params: { companyId: string }) {
  const assignmentMap = new Map<string, number>();

  try {
    const { data: summary, error: rpcError } = await supabase.rpc('get_irrigation_assignments_summary', { p_company_id: params.companyId });
    if (rpcError) throw rpcError;
    ((summary || []) as unknown as IrrigationSummaryRow[]).forEach((item) => {
      assignmentMap.set(String(item.invoice_item_id), Number(item.total_assigned || 0));
    });
  } catch {
    const { data: fallbackData, error } = await supabase
      .from('irrigation_assignments')
      .select('invoice_item_id, assigned_amount, invoice_items!inner(invoices!inner(company_id))')
      .eq('invoice_items.invoices.company_id', params.companyId);
    if (error) throw error;
    ((fallbackData || []) as unknown as IrrigationFallbackRow[]).forEach((item) => {
      const key = String(item.invoice_item_id);
      const current = assignmentMap.get(key) || 0;
      assignmentMap.set(key, current + Number(item.assigned_amount || 0));
    });
  }

  return assignmentMap;
}

export async function fetchIrrigationPendingItems(params: { companyId: string }) {
  const { data: items, error } = await supabase
    .from('invoice_items')
    .select(
      `
      id, total_price, category,
      products (name, category),
      invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage)
    `
    )
    .eq('invoices.company_id', params.companyId)
    .range(0, 9999);

  if (error) throw error;

  const normalize = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const targetCategories = new Set(['riego', 'agua', 'electricidad']);
  const filteredItems = ((items || []) as unknown as IrrigationInvoiceItemRow[]).filter((item) => {
    if (item.invoices?.company_id !== params.companyId) return false;
    const cat = normalize(item.category || item.products?.category || '');
    return targetCategories.has(cat);
  });

  const assignmentMap = await fetchIrrigationAssignmentsSummary({ companyId: params.companyId });

  const pending: IrrigationPendingItem[] = [];
  filteredItems.forEach((item) => {
    if (item.invoices?.company_id !== params.companyId) return;

    const docType = String(item.invoices.document_type || '').toLowerCase();
    const isCreditNote =
      docType.includes('nota de cr') ||
      docType.includes('nota de cre') ||
      docType.includes('nota credito') ||
      docType.includes('credito') ||
      docType === 'nc';

    const taxPercent = item.invoices.tax_percentage !== undefined ? item.invoices.tax_percentage : 19;
    const netAmount = Number(item.total_price);
    const grossAmount = netAmount * (1 + taxPercent / 100);

    const total = isCreditNote ? -Math.abs(grossAmount) : Math.abs(grossAmount);
    const assigned = assignmentMap.get(String(item.id)) || 0;
    const remaining = total - assigned;

    if (Math.abs(remaining) > 500) {
      pending.push({
        id: String(item.id),
        invoice_id: String(item.invoices.id),
        invoice_number: String(item.invoices.invoice_number),
        date: String(item.invoices.invoice_date),
        description: `${item.products?.name || 'Sin descripción'} ${isCreditNote ? '(NC)' : ''} [${item.invoices.document_type}]`,
        total_amount: total,
        assigned_amount: assigned,
        remaining_amount: remaining
      });
    }
  });

  return pending;
}

export async function fetchIrrigationHistory(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('irrigation_assignments')
    .select(
      `
      id, assigned_amount, assigned_date, sector_id, invoice_item_id,
      sectors (name),
      invoice_items!inner (
        products (name),
        invoices!inner (invoice_number, company_id)
      )
    `
    )
    .eq('invoice_items.invoices.company_id', params.companyId)
    .order('assigned_date', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data || []) as unknown as IrrigationHistoryRow[];
}

export async function deleteIrrigationAssignment(params: { assignmentId: string }) {
  const { error } = await supabase.from('irrigation_assignments').delete().eq('id', params.assignmentId);
  if (error) throw error;
}

export async function deleteAllIrrigationAssignments(params: { companyId: string }) {
  try {
    const { error: rpcError } = await supabase.rpc('delete_irrigation_assignments_by_company', { p_company_id: params.companyId });
    if (!rpcError) return;
    throw rpcError;
  } catch {
    const { data: assignments, error: fetchError } = await supabase
      .from('irrigation_assignments')
      .select('id, invoice_items!inner(invoices!inner(company_id))')
      .eq('invoice_items.invoices.company_id', params.companyId);
    if (fetchError) throw fetchError;
    if (!assignments || assignments.length === 0) return;

    const ids = assignments.map((a: any) => a.id);
    const BATCH_SIZE = 100;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const { error: deleteError } = await supabase.from('irrigation_assignments').delete().in('id', batch);
      if (deleteError) throw deleteError;
    }
  }
}

export async function updateIrrigationAssignment(params: { id: string; sectorId: string; assignedAmount: number; assignedDate: string }) {
  const { error } = await supabase
    .from('irrigation_assignments')
    .update({
      sector_id: params.sectorId,
      assigned_amount: params.assignedAmount,
      assigned_date: params.assignedDate
    })
    .eq('id', params.id);

  if (error) throw error;
}

export async function insertIrrigationAssignments(params: { rows: IrrigationAssignmentInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('irrigation_assignments').insert(params.rows);
  if (error) throw error;
}
