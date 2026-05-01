import { supabase } from '../supabase/client';

function normalize(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export async function fetchLaborAssignmentsSummary(params: { companyId: string }) {
  const assignmentMap = new Map<string, number>();

  try {
    const { data: summary, error: rpcError } = await supabase.rpc('get_labor_assignments_summary', { p_company_id: params.companyId });
    if (rpcError) throw rpcError;
    (summary || []).forEach((item: any) => {
      assignmentMap.set(String(item.invoice_item_id), Number(item.total_assigned));
    });
  } catch {
    const { data: fallbackData, error } = await supabase
      .from('labor_assignments')
      .select('invoice_item_id, assigned_amount, invoice_items!inner(invoices!inner(company_id))')
      .eq('invoice_items.invoices.company_id', params.companyId);
    if (error) throw error;
    (fallbackData || []).forEach((item: any) => {
      const key = String(item.invoice_item_id);
      const current = assignmentMap.get(key) || 0;
      assignmentMap.set(key, current + Number(item.assigned_amount));
    });
  }

  return assignmentMap;
}

export async function fetchPendingLaborItems(params: { companyId: string }) {
  const pageSize = 5000;
  let from = 0;
  const items: any[] = [];

  while (true) {
    const { data, error } = await supabase
      .from('invoice_items')
      .select(
        `
        id, total_price, category,
        created_at,
        products (name),
        invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage)
      `
      )
      .eq('invoices.company_id', params.companyId)
      .or('category.ilike.%mano de obra%,category.ilike.%labores%')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    (data || []).forEach((r: any) => items.push(r));
    if (!data || data.length < pageSize) break;
    from += pageSize;
    if (from >= 100000) break;
  }

  const allowedCategoryKeywords = ['mano de obra', 'labores'];

  const filteredItems = items.filter((item: any) => {
    if (item.invoices?.company_id !== params.companyId) return false;
    const cat = normalize(item.category);
    return allowedCategoryKeywords.some((k) => cat.includes(k));
  });

  const assignmentMap = await fetchLaborAssignmentsSummary({ companyId: params.companyId });

  const pending: any[] = [];

  filteredItems.forEach((item: any) => {
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

    if (Math.abs(remaining) > 1) {
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

export async function fetchLaborHistory(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('labor_assignments')
    .select(
      `
      id, assigned_amount, assigned_date, sector_id, invoice_item_id, labor_type,
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
  return (data || []) as unknown as Array<{
    id: string;
    assigned_amount: number;
    assigned_date: string;
    sector_id: string | null;
    invoice_item_id: string;
    labor_type: string;
    sectors: { name: string | null } | null;
    invoice_items: {
      products?: { name: string | null } | null;
      invoices?: { invoice_number: string | null; company_id?: string | null } | null;
    };
  }>;
}

export async function deleteLaborAssignment(params: { assignmentId: string }) {
  const { error } = await supabase.from('labor_assignments').delete().eq('id', params.assignmentId);
  if (error) throw error;
}

export async function deleteAllLaborAssignments(params: { companyId: string }) {
  try {
    const { error: rpcError } = await supabase.rpc('delete_labor_assignments_by_company', { p_company_id: params.companyId });
    if (!rpcError) return;
    throw rpcError;
  } catch {
    const { data: assignments, error: fetchError } = await supabase
      .from('labor_assignments')
      .select('id, invoice_items!inner(invoices!inner(company_id))')
      .eq('invoice_items.invoices.company_id', params.companyId);
    if (fetchError) throw fetchError;
    if (!assignments || assignments.length === 0) return;

    const ids = assignments.map((a: any) => a.id);
    const BATCH_SIZE = 100;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const { error: deleteError } = await supabase.from('labor_assignments').delete().in('id', batch);
      if (deleteError) throw deleteError;
    }
  }
}

export async function updateLaborType(params: { assignmentId: string; laborType: string }) {
  const { error } = await supabase.from('labor_assignments').update({ labor_type: params.laborType }).eq('id', params.assignmentId);
  if (error) throw error;
}

export type LaborAssignmentInsert = {
  invoice_item_id: string;
  sector_id: string;
  assigned_amount: number;
  assigned_date: string;
  labor_type: string;
  worker_id?: string | null;
  notes?: string | null;
};

export type LaborAssignmentUpdate = Partial<Omit<LaborAssignmentInsert, 'invoice_item_id'>>;

export async function updateLaborAssignment(params: { assignmentId: string; patch: LaborAssignmentUpdate }) {
  const { error } = await supabase.from('labor_assignments').update(params.patch).eq('id', params.assignmentId);
  if (error) throw error;
}

export async function insertLaborAssignments(params: { rows: LaborAssignmentInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('labor_assignments').insert(params.rows);
  if (error) throw error;
}

export async function fetchLaborAssignmentsForAutoClassify(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('labor_assignments')
    .select(
      `
      id, labor_type,
      invoice_items!inner (
        products (name),
        invoices!inner (company_id)
      )
    `
    )
    .eq('invoice_items.invoices.company_id', params.companyId)
    .or('labor_type.eq.General,labor_type.is.null');

  if (error) throw error;
  return data || [];
}
