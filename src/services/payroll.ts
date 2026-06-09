import { supabase } from '../supabase/client';

export type PayrollRateRow = {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
  kind: 'rate' | 'cap_uf' | 'amount';
  payer: 'worker' | 'employer' | 'system';
  value: number;
  effective_from: string;
  source_url?: string | null;
  source_note?: string | null;
  created_at: string;
};

export type PayrollRateInsert = Omit<PayrollRateRow, 'id' | 'created_at'>;

export type PayrollRateProposal = {
  id: string;
  company_id: string;
  effective_from: string;
  status: 'proposed' | 'applied' | 'dismissed';
  sources: unknown;
  proposed_items: unknown;
  created_at: string;
  applied_at: string | null;
};

export async function fetchPayrollRatesForMonth(params: { companyId: string; monthStart: string }): Promise<PayrollRateRow[]> {
  const { data, error } = await supabase
    .from('payroll_rates')
    .select('*')
    .or(`company_id.is.null,company_id.eq.${params.companyId}`)
    .lte('effective_from', params.monthStart)
    .order('effective_from', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as PayrollRateRow[];
}

export async function upsertPayrollRates(params: { rows: PayrollRateInsert[] }) {
  if (!params.rows || params.rows.length === 0) return;
  const { error } = await supabase.from('payroll_rates').upsert(params.rows, { onConflict: 'company_id,code,effective_from' });
  if (error) throw error;
}

export async function createPayrollRateProposal(params: {
  companyId: string;
  effectiveFrom: string;
  sources: unknown;
  proposedItems: unknown;
}): Promise<PayrollRateProposal> {
  const { data, error } = await supabase
    .from('payroll_rate_proposals')
    .insert({
      company_id: params.companyId,
      effective_from: params.effectiveFrom,
      sources: params.sources,
      proposed_items: params.proposedItems,
      status: 'proposed'
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as unknown as PayrollRateProposal;
}

export async function fetchPayrollRateProposals(params: { companyId: string }): Promise<PayrollRateProposal[]> {
  const { data, error } = await supabase
    .from('payroll_rate_proposals')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as PayrollRateProposal[];
}

export async function updatePayrollRateProposalStatus(params: { proposalId: string; status: 'applied' | 'dismissed' }) {
  const patch: Record<string, unknown> = { status: params.status };
  if (params.status === 'applied') patch.applied_at = new Date().toISOString();
  const { error } = await supabase.from('payroll_rate_proposals').update(patch).eq('id', params.proposalId);
  if (error) throw error;
}

export type WorkerPayrollRunInsert = {
  company_id: string;
  worker_id: string;
  month: string;
  field_id: string | null;
  sector_id: string | null;
  gross_imponible: number;
  contract_type: 'indefinite' | 'fixed_term' | 'work';
  afp_name: string | null;
  afp_commission_rate: number;
  health_type: 'fonasa' | 'isapre';
  health_rate: number;
  health_plan_amount: number;
  ccaf_enabled?: boolean;
  ccaf_name?: string | null;
  mutual_rate: number;
};

export type WorkerPayrollItemInsert = {
  run_id: string;
  company_id: string;
  payer: 'worker' | 'employer';
  code: string;
  name: string;
  rate: number;
  base_amount: number;
  amount: number;
  sort_order: number;
};

export async function createWorkerPayrollRun(params: { run: WorkerPayrollRunInsert; items: WorkerPayrollItemInsert[] }) {
  const { data: runData, error: runError } = await supabase.from('worker_payroll_runs').insert(params.run).select('id').single();
  if (runError) throw runError;
  const runId = String((runData as any).id);

  if (params.items && params.items.length > 0) {
    const itemsToInsert = params.items.map((i) => ({ ...i, run_id: runId }));
    const { error: itemsError } = await supabase.from('worker_payroll_items').insert(itemsToInsert);
    if (itemsError) throw itemsError;
  }

  return runId;
}
