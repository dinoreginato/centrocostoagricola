import { supabase } from '../supabase/client';
import type { ExecutiveBudgetPlanVersionKind } from './executiveBudgetPlanVersions';

export type ExecutiveBudgetPlanVerificationFolioStatus = 'emitido' | 'publicado' | 'acusado';
export type ExecutiveBudgetPlanVerificationValidationStatus = 'pendiente' | 'listo' | 'documento_incompleto';

export type ExecutiveBudgetPlanVerificationFolioCreate = {
  companyId: string;
  versionId: string;
  signoffEventId?: string | null;
  publicationEventId?: string | null;
  receiptId?: string | null;
  season: string;
  versionKind: ExecutiveBudgetPlanVersionKind;
  verificationSignature: string;
  folioCode: string;
  verificationCode: string;
  folioStatus: ExecutiveBudgetPlanVerificationFolioStatus;
  validationStatus?: ExecutiveBudgetPlanVerificationValidationStatus;
  externalValidationCode?: string | null;
  verificationUrl?: string | null;
  qrPayload?: string | null;
  documentRef?: string | null;
  documentHash?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type ExecutiveBudgetPlanVerificationFolioRow = {
  id: string;
  company_id: string;
  version_id: string;
  signoff_event_id: string | null;
  publication_event_id: string | null;
  receipt_id: string | null;
  created_by: string;
  season: string;
  version_kind: ExecutiveBudgetPlanVersionKind;
  verification_signature: string;
  folio_code: string;
  verification_code: string;
  folio_status: ExecutiveBudgetPlanVerificationFolioStatus;
  validation_status: ExecutiveBudgetPlanVerificationValidationStatus;
  external_validation_code: string | null;
  verification_url: string | null;
  qr_payload: string | null;
  document_ref: string | null;
  document_hash: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveBudgetPlanVerificationFolio(params: ExecutiveBudgetPlanVerificationFolioCreate) {
  const { error } = await supabase
    .from('executive_budget_plan_verification_folios')
    .insert({
      company_id: params.companyId,
      version_id: params.versionId,
      signoff_event_id: params.signoffEventId || null,
      publication_event_id: params.publicationEventId || null,
      receipt_id: params.receiptId || null,
      season: params.season,
      version_kind: params.versionKind,
      verification_signature: params.verificationSignature,
      folio_code: params.folioCode,
      verification_code: params.verificationCode,
      folio_status: params.folioStatus,
      validation_status: params.validationStatus || 'pendiente',
      external_validation_code: params.externalValidationCode || null,
      verification_url: params.verificationUrl || null,
      qr_payload: params.qrPayload || null,
      document_ref: params.documentRef || null,
      document_hash: params.documentHash || null,
      summary: params.summary,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanVerificationFolios(params: {
  companyId: string;
  season?: string;
  versionId?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_verification_folios')
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
  return (data || []) as ExecutiveBudgetPlanVerificationFolioRow[];
}
