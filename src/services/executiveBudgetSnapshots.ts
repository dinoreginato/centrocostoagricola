import { supabase } from '../supabase/client';

export type ExecutiveBudgetClosureSnapshotStatus = 'completo' | 'parcial' | 'fragil';

export type ExecutiveBudgetClosureSnapshotCreate = {
  companyId: string;
  season: string;
  closureSignature: string;
  budgetStatus: ExecutiveBudgetClosureSnapshotStatus;
  totalBudget: number;
  totalActualCost: number;
  budgetExecutionPct: number;
  coveragePct: number;
  sectorsWithBudget: number;
  totalSectors: number;
  mixedFieldsCount: number;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveBudgetClosureSnapshotRow = {
  id: string;
  company_id: string;
  created_by: string;
  season: string;
  closure_signature: string;
  budget_status: ExecutiveBudgetClosureSnapshotStatus;
  total_budget: number;
  total_actual_cost: number;
  budget_execution_pct: number;
  coverage_pct: number;
  sectors_with_budget: number;
  total_sectors: number;
  mixed_fields_count: number;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveBudgetClosureSnapshot(params: ExecutiveBudgetClosureSnapshotCreate) {
  const { error } = await supabase
    .from('executive_budget_closure_snapshots')
    .insert({
      company_id: params.companyId,
      season: params.season,
      closure_signature: params.closureSignature,
      budget_status: params.budgetStatus,
      total_budget: params.totalBudget,
      total_actual_cost: params.totalActualCost,
      budget_execution_pct: params.budgetExecutionPct,
      coverage_pct: params.coveragePct,
      sectors_with_budget: params.sectorsWithBudget,
      total_sectors: params.totalSectors,
      mixed_fields_count: params.mixedFieldsCount,
      summary: params.summary,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveBudgetClosureSnapshots(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_closure_snapshots')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.season) {
    query = query.eq('season', params.season);
  }

  if (params.limit && params.limit > 0) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ExecutiveBudgetClosureSnapshotRow[];
}
