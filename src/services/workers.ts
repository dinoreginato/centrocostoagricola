import { supabase } from '../supabase/client';

export type Worker = {
  id: string;
  company_id: string;
  name: string;
  role: string;
};

export type WorkerCost = {
  id: string;
  company_id: string;
  worker_id: string;
  sector_id: string;
  date: string;
  amount: number;
  description: string;
  is_piece_rate?: boolean | null;
  piece_quantity?: number | null;
  piece_price?: number | null;
  worker_name?: string | null;
  labor_type?: string | null;
  workers?: { name: string } | null;
  sectors?: { name: string } | null;
};

export type WorkerCostInsert = Omit<WorkerCost, 'id' | 'workers' | 'sectors' | 'worker_id'> & { worker_id: string | null };

export async function fetchWorkers(params: { companyId: string }): Promise<Worker[]> {
  const { data, error } = await supabase.from('workers').select('*').eq('company_id', params.companyId).order('name');
  if (error) throw error;
  return (data || []) as unknown as Worker[];
}

export async function fetchWorkerCosts(params: { companyId: string }): Promise<WorkerCost[]> {
  const { data, error } = await supabase
    .from('worker_costs')
    .select('*, workers(name), sectors(name)')
    .eq('company_id', params.companyId)
    .order('date', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as WorkerCost[];
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

export async function insertWorkerCosts(params: { rows: WorkerCostInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('worker_costs').insert(params.rows);
  if (error) throw error;
}

export async function deleteWorkerCost(params: { costId: string }) {
  const { error } = await supabase.from('worker_costs').delete().eq('id', params.costId);
  if (error) throw error;
}
