import { supabase } from '../supabase/client';

export type Worker = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  birth_date?: string | null;
  gender?: 'male' | 'female' | 'unspecified';
  is_pensioner?: boolean;
  pension_type?: 'old_age' | 'disability_total' | 'disability_partial' | 'other' | null;
  voluntary_afp_after_legal_age?: boolean;
  art69_exempt?: boolean;
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

export async function createWorker(params: {
  companyId: string;
  name: string;
  role: string;
  birthDate?: string | null;
  gender?: 'male' | 'female' | 'unspecified';
  isPensioner?: boolean;
  pensionType?: 'old_age' | 'disability_total' | 'disability_partial' | 'other' | null;
  voluntaryAfpAfterLegalAge?: boolean;
  art69Exempt?: boolean;
}) {
  const { error } = await supabase.from('workers').insert({
    company_id: params.companyId,
    name: params.name,
    role: params.role,
    birth_date: params.birthDate || null,
    gender: params.gender || 'unspecified',
    is_pensioner: Boolean(params.isPensioner),
    pension_type: params.isPensioner ? params.pensionType || 'old_age' : null,
    voluntary_afp_after_legal_age: Boolean(params.voluntaryAfpAfterLegalAge),
    art69_exempt: Boolean(params.art69Exempt)
  });
  if (error) throw error;
}

export async function updateWorker(params: {
  workerId: string;
  name: string;
  role: string;
  birthDate?: string | null;
  gender?: 'male' | 'female' | 'unspecified';
  isPensioner?: boolean;
  pensionType?: 'old_age' | 'disability_total' | 'disability_partial' | 'other' | null;
  voluntaryAfpAfterLegalAge?: boolean;
  art69Exempt?: boolean;
}) {
  const { error } = await supabase
    .from('workers')
    .update({
      name: params.name,
      role: params.role,
      birth_date: params.birthDate || null,
      gender: params.gender || 'unspecified',
      is_pensioner: Boolean(params.isPensioner),
      pension_type: params.isPensioner ? params.pensionType || 'old_age' : null,
      voluntary_afp_after_legal_age: Boolean(params.voluntaryAfpAfterLegalAge),
      art69_exempt: Boolean(params.art69Exempt)
    })
    .eq('id', params.workerId);
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

export async function deleteWorkerCosts(params: { costIds: string[] }) {
  if (!params.costIds || params.costIds.length === 0) return;
  const { error } = await supabase.from('worker_costs').delete().in('id', params.costIds);
  if (error) throw error;
}
