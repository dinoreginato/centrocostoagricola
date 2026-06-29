import { supabase } from '../supabase/client';

export type ExecutiveGlobalRankingSnapshotCreate = {
  companyId: string;
  season: string;
  rankingSignature: string;
  selectedCompanyRank?: number | null;
  totalCompanies: number;
  leaderCompanyName?: string | null;
  averageScore: number;
  averageClosurePct: number;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveGlobalRankingSnapshotRow = {
  id: string;
  company_id: string;
  created_by: string;
  season: string;
  ranking_signature: string;
  selected_company_rank: number | null;
  total_companies: number;
  leader_company_name: string | null;
  average_score: number;
  average_closure_pct: number;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ExecutiveGlobalPreventiveSnapshotCreate = {
  companyId: string;
  season: string;
  preventiveSignature: string;
  totalRecommendations: number;
  topSeverity?: 'media' | 'alta' | null;
  topStageKey?: 'recognition' | 'communication' | 'closure' | null;
  topOwnerLabel?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveGlobalPreventiveSnapshotRow = {
  id: string;
  company_id: string;
  created_by: string;
  season: string;
  preventive_signature: string;
  total_recommendations: number;
  top_severity: 'media' | 'alta' | null;
  top_stage_key: 'recognition' | 'communication' | 'closure' | null;
  top_owner_label: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveGlobalRankingSnapshot(params: ExecutiveGlobalRankingSnapshotCreate) {
  const { error } = await supabase
    .from('executive_global_ranking_snapshots')
    .insert({
      company_id: params.companyId,
      season: params.season,
      ranking_signature: params.rankingSignature,
      selected_company_rank: params.selectedCompanyRank ?? null,
      total_companies: params.totalCompanies,
      leader_company_name: params.leaderCompanyName ?? null,
      average_score: params.averageScore,
      average_closure_pct: params.averageClosurePct,
      summary: params.summary,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveGlobalRankingSnapshots(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_global_ranking_snapshots')
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
  return (data || []) as ExecutiveGlobalRankingSnapshotRow[];
}

export async function createExecutiveGlobalPreventiveSnapshot(params: ExecutiveGlobalPreventiveSnapshotCreate) {
  const { error } = await supabase
    .from('executive_global_preventive_snapshots')
    .insert({
      company_id: params.companyId,
      season: params.season,
      preventive_signature: params.preventiveSignature,
      total_recommendations: params.totalRecommendations,
      top_severity: params.topSeverity ?? null,
      top_stage_key: params.topStageKey ?? null,
      top_owner_label: params.topOwnerLabel ?? null,
      summary: params.summary,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveGlobalPreventiveSnapshots(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_global_preventive_snapshots')
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
  return (data || []) as ExecutiveGlobalPreventiveSnapshotRow[];
}
