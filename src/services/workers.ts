import { supabase } from '../supabase/client';

export async function fetchWorkers(params: { companyId: string }) {
  const { data, error } = await supabase.from('workers').select('*').eq('company_id', params.companyId).order('name');
  if (error) throw error;
  return data || [];
}

export async function fetchWorkerCosts(params: { companyId: string }) {
  const { data, error } = await supabase
    .from('worker_costs')
    .select('*, workers(name), sectors(name)')
    .eq('company_id', params.companyId)
    .order('date', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createWorker(params: { companyId: string; name: string; role: string }) {
  const { error } = await supabase.from('workers').insert({
    company_id: params.companyId,
    name: params.name,
    role: params.role
  });
  if (error) throw error;
}

export async function deleteWorker(params: { workerId: string }) {
  const { error } = await supabase.from('workers').delete().eq('id', params.workerId);
  if (error) throw error;
}

export async function insertWorkerCosts(params: { rows: any[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('worker_costs').insert(params.rows);
  if (error) throw error;
}

export async function deleteWorkerCost(params: { costId: string }) {
  const { error } = await supabase.from('worker_costs').delete().eq('id', params.costId);
  if (error) throw error;
}
