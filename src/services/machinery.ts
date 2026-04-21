import { supabase } from '../supabase/client';

export async function fetchMachineryAssignmentsSummary(params: { companyId: string }) {
  const assignmentMap = new Map<string, number>();

  try {
    const { data: summary, error: rpcError } = await supabase.rpc('get_machinery_assignments_summary', { p_company_id: params.companyId });
    if (rpcError) throw rpcError;
    (summary || []).forEach((item: any) => {
      assignmentMap.set(String(item.invoice_item_id), Number(item.total_assigned));
    });
  } catch {
    const { data: fallbackData, error } = await supabase
      .from('machinery_assignments')
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

export async function fetchPendingMachineryItems(params: { companyId: string }) {
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
    .order('id', { ascending: false })
    .range(0, 19999);

  if (error) throw error;

  const filteredItems = (items || []).filter((item: any) => {
    if (item.invoices?.company_id !== params.companyId) return false;

    const rawCat = item.category || item.products?.category || '';
    const rawName = item.products?.name || '';

    const cat = String(rawCat).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const name = String(rawName).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const textToCheck = `${cat} ${name}`;

    const allowedKeywords = ['maquinaria', 'repuesto'];
    return allowedKeywords.some((keyword) => textToCheck.includes(keyword));
  });

  const assignmentMap = await fetchMachineryAssignmentsSummary({ companyId: params.companyId });

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

export async function fetchMachineryHistory(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('machinery_assignments')
    .select(
      `
      id, assigned_amount, assigned_date, sector_id, invoice_item_id, machine_id,
      machines (name),
      sectors (name),
      invoice_items!inner (
        products (name),
        invoices!inner (invoice_number, company_id, invoice_date, document_type)
      )
    `
    )
    .eq('invoice_items.invoices.company_id', params.companyId)
    .order('assigned_date', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data || []) as any[];
}

export async function deleteMachineryAssignment(params: { assignmentId: string }) {
  const { error } = await supabase.from('machinery_assignments').delete().eq('id', params.assignmentId);
  if (error) throw error;
}

export async function deleteAllMachineryAssignments(params: { companyId: string }) {
  try {
    const { error: rpcError } = await supabase.rpc('delete_machinery_assignments_by_company', { p_company_id: params.companyId });
    if (!rpcError) return;
    throw rpcError;
  } catch {
    const { data: assignments, error: fetchError } = await supabase
      .from('machinery_assignments')
      .select('id, invoice_items!inner(invoices!inner(company_id))')
      .eq('invoice_items.invoices.company_id', params.companyId);
    if (fetchError) throw fetchError;
    if (!assignments || assignments.length === 0) return;

    const ids = assignments.map((a: any) => a.id);
    const BATCH_SIZE = 100;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const { error: deleteError } = await supabase.from('machinery_assignments').delete().in('id', batch);
      if (deleteError) throw deleteError;
    }
  }
}
