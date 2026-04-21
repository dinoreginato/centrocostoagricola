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

