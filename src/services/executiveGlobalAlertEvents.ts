import { supabase } from '../supabase/client';

export type ExecutiveGlobalAlertEventCreate = {
  companyId: string;
  season: string;
  severity: 'media' | 'alta';
  alertTypes: string[];
  alertTitles: string[];
  selectedCompanyRank?: number | null;
  topQuartileCutoff?: number | null;
  totalCompanies?: number | null;
  leaderCompanyName?: string | null;
  detail: string;
  recommendation: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveGlobalAlertManagementStatus = 'pendiente' | 'reconocida' | 'comunicada' | 'cerrada';
export type ExecutiveGlobalAlertTransitionStatus = ExecutiveGlobalAlertManagementStatus | 'sin_estado';
export type ExecutiveGlobalAlertSlaEscalationSeverity = 'alta' | 'critica';
export type ExecutiveGlobalAlertSlaResolutionKind = 'normalizada' | 'cerrada';

export type ExecutiveGlobalAlertEventRow = {
  id: string;
  company_id: string;
  created_by: string;
  season: string;
  severity: 'media' | 'alta';
  alert_types: string[];
  alert_titles: string[];
  selected_company_rank: number | null;
  top_quartile_cutoff: number | null;
  total_companies: number | null;
  leader_company_name: string | null;
  detail: string;
  recommendation: string;
  management_status: ExecutiveGlobalAlertManagementStatus;
  management_owner_label: string | null;
  management_note: string | null;
  management_updated_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ExecutiveGlobalAlertTransitionCreate = {
  companyId: string;
  eventId: string;
  fromStatus: ExecutiveGlobalAlertTransitionStatus;
  toStatus: ExecutiveGlobalAlertManagementStatus;
  ownerLabel?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
};

export type ExecutiveGlobalAlertTransitionRow = {
  id: string;
  company_id: string;
  event_id: string;
  created_by: string;
  from_status: ExecutiveGlobalAlertTransitionStatus;
  to_status: ExecutiveGlobalAlertManagementStatus;
  owner_label: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ExecutiveGlobalAlertSlaEscalationCreate = {
  companyId: string;
  eventId: string;
  stageKey: 'recognition' | 'communication' | 'closure';
  escalationSeverity: ExecutiveGlobalAlertSlaEscalationSeverity;
  ownerLabel?: string | null;
  overdueHours: number;
  targetHours: number;
  detail: string;
  recommendation: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveGlobalAlertSlaEscalationRow = {
  id: string;
  company_id: string;
  event_id: string;
  created_by: string;
  stage_key: 'recognition' | 'communication' | 'closure';
  escalation_severity: ExecutiveGlobalAlertSlaEscalationSeverity;
  owner_label: string | null;
  overdue_hours: number;
  target_hours: number;
  detail: string;
  recommendation: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ExecutiveGlobalAlertSlaResolutionCreate = {
  companyId: string;
  eventId: string;
  stageKey: 'recognition' | 'communication' | 'closure';
  resolutionKind: ExecutiveGlobalAlertSlaResolutionKind;
  ownerLabel?: string | null;
  detail: string;
  recommendation: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveGlobalAlertSlaResolutionRow = {
  id: string;
  company_id: string;
  event_id: string;
  created_by: string;
  stage_key: 'recognition' | 'communication' | 'closure';
  resolution_kind: ExecutiveGlobalAlertSlaResolutionKind;
  owner_label: string | null;
  detail: string;
  recommendation: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveGlobalAlertEvent(params: ExecutiveGlobalAlertEventCreate) {
  const { data, error } = await supabase
    .from('executive_global_alert_events')
    .insert({
      company_id: params.companyId,
      season: params.season,
      severity: params.severity,
      alert_types: params.alertTypes,
      alert_titles: params.alertTitles,
      selected_company_rank: params.selectedCompanyRank ?? null,
      top_quartile_cutoff: params.topQuartileCutoff ?? null,
      total_companies: params.totalCompanies ?? null,
      leader_company_name: params.leaderCompanyName ?? null,
      detail: params.detail,
      recommendation: params.recommendation,
      management_status: 'pendiente',
      metadata: params.metadata || {}
    })
    .select('id')
    .single();

  if (error) throw error;
  return data as { id: string };
}

export async function updateExecutiveGlobalAlertEvent(params: {
  companyId: string;
  eventId: string;
  managementStatus: ExecutiveGlobalAlertManagementStatus;
  managementOwnerLabel?: string | null;
  managementNote?: string | null;
}) {
  const { error } = await supabase
    .from('executive_global_alert_events')
    .update({
      management_status: params.managementStatus,
      management_owner_label: params.managementOwnerLabel?.trim() || null,
      management_note: params.managementNote?.trim() || null,
      management_updated_at: new Date().toISOString()
    })
    .eq('company_id', params.companyId)
    .eq('id', params.eventId);

  if (error) throw error;
}

export async function createExecutiveGlobalAlertTransition(params: ExecutiveGlobalAlertTransitionCreate) {
  const { error } = await supabase
    .from('executive_global_alert_event_transitions')
    .insert({
      company_id: params.companyId,
      event_id: params.eventId,
      from_status: params.fromStatus,
      to_status: params.toStatus,
      owner_label: params.ownerLabel?.trim() || null,
      note: params.note?.trim() || null,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function createExecutiveGlobalAlertSlaEscalation(params: ExecutiveGlobalAlertSlaEscalationCreate) {
  const { error } = await supabase
    .from('executive_global_alert_sla_escalations')
    .insert({
      company_id: params.companyId,
      event_id: params.eventId,
      stage_key: params.stageKey,
      escalation_severity: params.escalationSeverity,
      owner_label: params.ownerLabel?.trim() || null,
      overdue_hours: params.overdueHours,
      target_hours: params.targetHours,
      detail: params.detail,
      recommendation: params.recommendation,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function createExecutiveGlobalAlertSlaResolution(params: ExecutiveGlobalAlertSlaResolutionCreate) {
  const { error } = await supabase
    .from('executive_global_alert_sla_resolutions')
    .insert({
      company_id: params.companyId,
      event_id: params.eventId,
      stage_key: params.stageKey,
      resolution_kind: params.resolutionKind,
      owner_label: params.ownerLabel?.trim() || null,
      detail: params.detail,
      recommendation: params.recommendation,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveGlobalAlertEvents(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_global_alert_events')
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
  return (data || []) as ExecutiveGlobalAlertEventRow[];
}

export async function loadExecutiveGlobalAlertTransitions(params: {
  companyId: string;
  eventIds?: string[];
  limit?: number;
}) {
  let query = supabase
    .from('executive_global_alert_event_transitions')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.eventIds && params.eventIds.length > 0) {
    query = query.in('event_id', params.eventIds);
  }

  if (params.limit && params.limit > 0) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ExecutiveGlobalAlertTransitionRow[];
}

export async function loadExecutiveGlobalAlertSlaEscalations(params: {
  companyId: string;
  eventIds?: string[];
  limit?: number;
}) {
  let query = supabase
    .from('executive_global_alert_sla_escalations')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.eventIds && params.eventIds.length > 0) {
    query = query.in('event_id', params.eventIds);
  }

  if (params.limit && params.limit > 0) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ExecutiveGlobalAlertSlaEscalationRow[];
}

export async function loadExecutiveGlobalAlertSlaResolutions(params: {
  companyId: string;
  eventIds?: string[];
  limit?: number;
}) {
  let query = supabase
    .from('executive_global_alert_sla_resolutions')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.eventIds && params.eventIds.length > 0) {
    query = query.in('event_id', params.eventIds);
  }

  if (params.limit && params.limit > 0) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ExecutiveGlobalAlertSlaResolutionRow[];
}
