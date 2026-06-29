import { supabase } from '../supabase/client';
import type { ExecutiveBudgetPlanVersionKind } from './executiveBudgetPlanVersions';
import type { ExecutiveBudgetPlanApprovalRole } from './executiveBudgetPlanApprovalSteps';

export type ExecutiveBudgetPlanPublicationAction = 'firmada' | 'publicada_externa';
export type ExecutiveBudgetPlanPublicationChannel = 'comite' | 'directorio' | 'banco_inversionista' | 'auditoria_externa' | 'otro';

export type ExecutiveBudgetPlanPublicationEventCreate = {
  companyId: string;
  versionId: string;
  season: string;
  versionKind: ExecutiveBudgetPlanVersionKind;
  actionType: ExecutiveBudgetPlanPublicationAction;
  responsibleLabel: string;
  responsibleRole: ExecutiveBudgetPlanApprovalRole;
  recipientLabel?: string | null;
  publicationChannel?: ExecutiveBudgetPlanPublicationChannel | null;
  reason: string;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

export type ExecutiveBudgetPlanPublicationEventRow = {
  id: string;
  company_id: string;
  version_id: string;
  created_by: string;
  season: string;
  version_kind: ExecutiveBudgetPlanVersionKind;
  action_type: ExecutiveBudgetPlanPublicationAction;
  responsible_label: string;
  responsible_role: ExecutiveBudgetPlanApprovalRole;
  recipient_label: string | null;
  publication_channel: ExecutiveBudgetPlanPublicationChannel | null;
  reason: string;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveBudgetPlanPublicationEvent(params: ExecutiveBudgetPlanPublicationEventCreate) {
  const { error } = await supabase
    .from('executive_budget_plan_publication_events')
    .insert({
      company_id: params.companyId,
      version_id: params.versionId,
      season: params.season,
      version_kind: params.versionKind,
      action_type: params.actionType,
      responsible_label: params.responsibleLabel,
      responsible_role: params.responsibleRole,
      recipient_label: params.recipientLabel || null,
      publication_channel: params.publicationChannel || null,
      reason: params.reason,
      notes: params.notes || null,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanPublicationEvents(params: {
  companyId: string;
  season?: string;
  versionId?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_publication_events')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

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
  return (data || []) as ExecutiveBudgetPlanPublicationEventRow[];
}
