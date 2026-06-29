import { supabase } from '../supabase/client';
import type { ExecutiveBudgetPlanVersionKind } from './executiveBudgetPlanVersions';

export type ExecutiveBudgetPlanWorkflowAction = 'publicada' | 'observada' | 'freeze_comite';

export type ExecutiveBudgetPlanWorkflowEventCreate = {
  companyId: string;
  versionId?: string | null;
  season: string;
  versionKind: ExecutiveBudgetPlanVersionKind;
  actionType: ExecutiveBudgetPlanWorkflowAction;
  responsibleLabel: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveBudgetPlanWorkflowEventRow = {
  id: string;
  company_id: string;
  version_id: string | null;
  created_by: string;
  season: string;
  version_kind: ExecutiveBudgetPlanVersionKind;
  action_type: ExecutiveBudgetPlanWorkflowAction;
  responsible_label: string;
  reason: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveBudgetPlanWorkflowEvent(params: ExecutiveBudgetPlanWorkflowEventCreate) {
  const { error } = await supabase
    .from('executive_budget_plan_workflow_events')
    .insert({
      company_id: params.companyId,
      version_id: params.versionId || null,
      season: params.season,
      version_kind: params.versionKind,
      action_type: params.actionType,
      responsible_label: params.responsibleLabel,
      reason: params.reason,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanWorkflowEvents(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_workflow_events')
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
  return (data || []) as ExecutiveBudgetPlanWorkflowEventRow[];
}
