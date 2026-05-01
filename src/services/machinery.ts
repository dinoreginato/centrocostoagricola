import { supabase } from '../supabase/client';

export type MachineryAssignmentInsert = {
  invoice_item_id: string;
  sector_id?: string | null;
  machine_id?: string | null;
  assigned_amount: number;
  assigned_date: string;
  notes?: string | null;
};

export type MachineryAssignmentUpdate = Partial<Omit<MachineryAssignmentInsert, 'invoice_item_id'>>;

export type MachineUpsert = {
  name: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  plate?: string | null;
  description?: string | null;
  current_hours?: number | null;
  maintenance_interval_hours?: number | null;
  last_maintenance_hours?: number | null;
  is_active?: boolean | null;
};

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
      created_at,
      products (name, category),
      invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage)
    `
    )
    .eq('invoices.company_id', params.companyId)
    .or('category.ilike.%maquinaria%,category.ilike.%repuesto%')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, 9999);

  if (error) throw error;

  const normalize = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const allowedCategoryKeywords = ['maquinaria', 'repuesto'];

  const filteredItems = (items || []).filter((item: any) => {
    if (item.invoices?.company_id !== params.companyId) return false;

    const cat = normalize(item.category || item.products?.category || '');
    return allowedCategoryKeywords.some((k) => cat.includes(k));
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
  return (data || []) as unknown as Array<{
    id: string;
    assigned_amount: number;
    assigned_date: string;
    sector_id: string | null;
    invoice_item_id: string;
    machine_id: string | null;
    machines: { name: string | null } | null;
    sectors: { name: string | null } | null;
    invoice_items: {
      products?: { name: string | null } | null;
      invoices?: { invoice_number: string | null; company_id?: string | null; invoice_date?: string | null; document_type?: string | null } | null;
    };
  }>;
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

export async function fetchActiveMachines(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('machines')
    .select('id, name, type, brand, model, plate, description, current_hours, maintenance_interval_hours, last_maintenance_hours')
    .eq('company_id', params.companyId)
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function fetchInvoiceItemForMachinery(params: { invoiceItemId: string }) {
  const { data, error } = await supabase
    .from('invoice_items')
    .select(
      `
      id, total_price, category,
      products (name, category),
      invoices!inner (id, invoice_number, invoice_date, company_id, document_type, tax_percentage)
    `
    )
    .eq('id', params.invoiceItemId)
    .single();

  if (error) throw error;
  return data;
}

export async function deleteMachineryAssignmentsByInvoiceItem(params: { invoiceItemId: string }) {
  const { error } = await supabase.from('machinery_assignments').delete().eq('invoice_item_id', params.invoiceItemId);
  if (error) throw error;
}

export async function updateMachineryAssignment(params: { assignmentId: string; patch: MachineryAssignmentUpdate }) {
  const { error } = await supabase.from('machinery_assignments').update(params.patch).eq('id', params.assignmentId);
  if (error) throw error;
}

export async function syncMachineryAssignmentsForItem(params: { invoiceItemId: string; excludeAssignmentId: string; patch: MachineryAssignmentUpdate }) {
  const { error } = await supabase
    .from('machinery_assignments')
    .update(params.patch)
    .eq('invoice_item_id', params.invoiceItemId)
    .neq('id', params.excludeAssignmentId);
  if (error) throw error;
}

export async function insertMachineryAssignments(params: { rows: MachineryAssignmentInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('machinery_assignments').insert(params.rows);
  if (error) throw error;
}

export async function upsertMachine(params: { companyId: string; machineId?: string | null; payload: MachineUpsert }) {
  const machineData = { ...params.payload, company_id: params.companyId };

  if (params.machineId) {
    const { error } = await supabase.from('machines').update(machineData).eq('id', params.machineId);
    if (error) throw error;
    return params.machineId;
  }

  const { data, error } = await supabase.from('machines').insert([machineData]).select().single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deactivateMachine(params: { machineId: string }) {
  const { error } = await supabase.from('machines').update({ is_active: false }).eq('id', params.machineId);
  if (error) throw error;
}

export async function fetchMachineExpenses(params: { machineId: string }) {
  const { data, error } = await supabase
    .from('machinery_assignments')
    .select(
      `
      id, assigned_amount, assigned_date,
      sectors (name),
      invoice_items!inner (
        products (name),
        invoices!inner (invoice_number)
      )
    `
    )
    .eq('machine_id', params.machineId)
    .order('assigned_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchMachineryAssignmentsWithMachine(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('machinery_assignments')
    .select(
      `
      id, assigned_amount, assigned_date,
      sectors (name),
      machines (name, type, brand, model),
      invoice_items!inner (
        products (name),
        invoices!inner (invoice_number, company_id)
      )
    `
    )
    .eq('invoice_items.invoices.company_id', params.companyId)
    .not('machine_id', 'is', null)
    .order('machine_id', { ascending: true })
    .order('assigned_date', { ascending: false });

  if (error) throw error;
  return data || [];
}
