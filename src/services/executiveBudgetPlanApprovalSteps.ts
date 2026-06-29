import { supabase } from '../supabase/client';
import type { ExecutiveBudgetPlanVersionKind } from './executiveBudgetPlanVersions';

export type ExecutiveBudgetPlanApprovalRole = 'gerencia_agricola' | 'control_gestion' | 'gerencia_general' | 'comite';
export type ExecutiveBudgetPlanApprovalStatus = 'pendiente' | 'aprobada' | 'observada' | 'congelada';

export const EXECUTIVE_BUDGET_PLAN_APPROVAL_STEP_DEFS: Array<{
  role: ExecutiveBudgetPlanApprovalRole;
  order: number;
}> = [
  { role: 'gerencia_agricola', order: 1 },
  { role: 'control_gestion', order: 2 },
  { role: 'gerencia_general', order: 3 },
  { role: 'comite', order: 4 }
];

export type ExecutiveBudgetPlanApprovalStepRow = {
  id: string;
  company_id: string;
  version_id: string;
  created_by: string;
  season: string;
  version_kind: ExecutiveBudgetPlanVersionKind;
  approval_role: ExecutiveBudgetPlanApprovalRole;
  step_order: number;
  approval_status: ExecutiveBudgetPlanApprovalStatus;
  responsible_label: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  decided_at: string | null;
  updated_at: string;
  created_at: string;
};

export async function ensureExecutiveBudgetPlanApprovalSteps(params: {
  companyId: string;
  versionId: string;
  season: string;
  versionKind: ExecutiveBudgetPlanVersionKind;
  metadata?: Record<string, unknown>;
}) {
  const rows = EXECUTIVE_BUDGET_PLAN_APPROVAL_STEP_DEFS.map((step) => ({
    company_id: params.companyId,
    version_id: params.versionId,
    season: params.season,
    version_kind: params.versionKind,
    approval_role: step.role,
    step_order: step.order,
    approval_status: 'pendiente' as ExecutiveBudgetPlanApprovalStatus,
    metadata: params.metadata || {}
  }));

  const { error } = await supabase
    .from('executive_budget_plan_approval_steps')
    .upsert(rows, {
      onConflict: 'version_id,approval_role',
      ignoreDuplicates: true
    });

  if (error) throw error;
}

export async function updateExecutiveBudgetPlanApprovalStep(params: {
  stepId: string;
  status: ExecutiveBudgetPlanApprovalStatus;
  responsibleLabel: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from('executive_budget_plan_approval_steps')
    .update({
      approval_status: params.status,
      responsible_label: params.responsibleLabel,
      reason: params.reason,
      metadata: params.metadata || {},
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', params.stepId);

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanApprovalSteps(params: {
  companyId: string;
  season?: string;
  versionId?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_approval_steps')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })
    .order('step_order', { ascending: true });

  if (params.season) {
    query = query.eq('season', params.season);
  }

  if (params.versionId) {
    query = query.eq('version_id', params.versionId);
  }

  if (params.limit && params.limit > 0) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ExecutiveBudgetPlanApprovalStepRow[];
}
