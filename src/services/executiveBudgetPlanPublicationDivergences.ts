import { supabase } from '../supabase/client';

export type ExecutiveBudgetPlanPublicationDivergenceStatus =
  | 'alineado'
  | 'documento_faltante'
  | 'referencia_distinta'
  | 'hash_distinto'
  | 'hash_y_referencia_distintos';

export type ExecutiveBudgetPlanPublicationDivergenceCreate = {
  companyId: string;
  versionId: string;
  signoffEventId?: string | null;
  publicationEventId?: string | null;
  season: string;
  divergenceSignature: string;
  divergenceStatus: ExecutiveBudgetPlanPublicationDivergenceStatus;
  signedDocumentRef?: string | null;
  signedDocumentHash?: string | null;
  publishedDocumentRef?: string | null;
  publishedDocumentHash?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveBudgetPlanPublicationDivergenceRow = {
  id: string;
  company_id: string;
  version_id: string;
  signoff_event_id: string | null;
  publication_event_id: string | null;
  created_by: string;
  season: string;
  divergence_signature: string;
  divergence_status: ExecutiveBudgetPlanPublicationDivergenceStatus;
  signed_document_ref: string | null;
  signed_document_hash: string | null;
  published_document_ref: string | null;
  published_document_hash: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveBudgetPlanPublicationDivergence(params: ExecutiveBudgetPlanPublicationDivergenceCreate) {
  const { error } = await supabase
    .from('executive_budget_plan_publication_divergences')
    .insert({
      company_id: params.companyId,
      version_id: params.versionId,
      signoff_event_id: params.signoffEventId || null,
      publication_event_id: params.publicationEventId || null,
      season: params.season,
      divergence_signature: params.divergenceSignature,
      divergence_status: params.divergenceStatus,
      signed_document_ref: params.signedDocumentRef || null,
      signed_document_hash: params.signedDocumentHash || null,
      published_document_ref: params.publishedDocumentRef || null,
      published_document_hash: params.publishedDocumentHash || null,
      summary: params.summary,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanPublicationDivergences(params: {
  companyId: string;
  season?: string;
  versionId?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_publication_divergences')
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
  return (data || []) as ExecutiveBudgetPlanPublicationDivergenceRow[];
}
