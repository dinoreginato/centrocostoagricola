import { supabase } from '../supabase/client';

export type ExecutiveBudgetPlanVersionKind = 'base' | 'revision' | 'comite';
export type ExecutiveBudgetPlanStatus = 'completo' | 'parcial' | 'fragil';

export type ExecutiveBudgetPlanVersionCreate = {
  companyId: string;
  season: string;
  versionKind: ExecutiveBudgetPlanVersionKind;
  versionSignature: string;
  totalBudget: number;
  coveragePct: number;
  executionPct: number;
  budgetStatus: ExecutiveBudgetPlanStatus;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveBudgetPlanVersionRow = {
  id: string;
  company_id: string;
  created_by: string;
  season: string;
  version_kind: ExecutiveBudgetPlanVersionKind;
  version_signature: string;
  total_budget: number;
  coverage_pct: number;
  execution_pct: number;
  budget_status: ExecutiveBudgetPlanStatus;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveBudgetPlanVersion(params: ExecutiveBudgetPlanVersionCreate) {
  const { error } = await supabase
    .from('executive_budget_plan_versions')
    .insert({
      company_id: params.companyId,
      season: params.season,
      version_kind: params.versionKind,
      version_signature: params.versionSignature,
      total_budget: params.totalBudget,
      coverage_pct: params.coveragePct,
      execution_pct: params.executionPct,
      budget_status: params.budgetStatus,
      summary: params.summary,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanVersions(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_versions')
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
  return (data || []) as ExecutiveBudgetPlanVersionRow[];
}
