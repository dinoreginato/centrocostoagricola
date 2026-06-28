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
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveGlobalAlertEvent(params: ExecutiveGlobalAlertEventCreate) {
  const { error } = await supabase
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
