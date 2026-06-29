import { supabase } from '../supabase/client';
import type {
  ExecutiveBudgetPlanPublicationReceiptSource,
  ExecutiveBudgetPlanPublicationReceiptType
} from './executiveBudgetPlanPublications';

export type ExecutiveBudgetPlanPublicationIntegrationMode = 'webhook' | 'polling' | 'importador';
export type ExecutiveBudgetPlanPublicationIntegrationSyncStatus = 'pendiente' | 'procesada' | 'error';
export type ExecutiveBudgetPlanPublicationIntegrationSource = Exclude<ExecutiveBudgetPlanPublicationReceiptSource, 'manual'>;

export type ExecutiveBudgetPlanPublicationReceiptIntegrationCreate = {
  companyId: string;
  publicationEventId: string;
  versionId: string;
  season: string;
  receiptType: ExecutiveBudgetPlanPublicationReceiptType;
  confirmationSource: ExecutiveBudgetPlanPublicationIntegrationSource;
  integrationMode: ExecutiveBudgetPlanPublicationIntegrationMode;
  recipientLabel: string;
  providerLabel?: string | null;
  externalReference?: string | null;
  evidenceUrl?: string | null;
  integrationSignature: string;
  eventPayload?: Record<string, unknown>;
};

export type ExecutiveBudgetPlanPublicationReceiptIntegrationRow = {
  id: string;
  company_id: string;
  publication_event_id: string;
  version_id: string;
  processed_receipt_id: string | null;
  created_by: string;
  season: string;
  receipt_type: ExecutiveBudgetPlanPublicationReceiptType;
  confirmation_source: ExecutiveBudgetPlanPublicationIntegrationSource;
  integration_mode: ExecutiveBudgetPlanPublicationIntegrationMode;
  sync_status: ExecutiveBudgetPlanPublicationIntegrationSyncStatus;
  recipient_label: string;
  provider_label: string | null;
  external_reference: string | null;
  evidence_url: string | null;
  integration_signature: string;
  event_payload: Record<string, unknown> | null;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
};

export async function createExecutiveBudgetPlanPublicationReceiptIntegration(params: ExecutiveBudgetPlanPublicationReceiptIntegrationCreate) {
  const { error } = await supabase
    .from('executive_budget_plan_publication_receipt_integrations')
    .insert({
      company_id: params.companyId,
      publication_event_id: params.publicationEventId,
      version_id: params.versionId,
      season: params.season,
      receipt_type: params.receiptType,
      confirmation_source: params.confirmationSource,
      integration_mode: params.integrationMode,
      recipient_label: params.recipientLabel,
      provider_label: params.providerLabel || null,
      external_reference: params.externalReference || null,
      evidence_url: params.evidenceUrl || null,
      integration_signature: params.integrationSignature,
      event_payload: params.eventPayload || {}
    });

  if (error) throw error;
}

export async function updateExecutiveBudgetPlanPublicationReceiptIntegrationSync(params: {
  integrationId: string;
  syncStatus: ExecutiveBudgetPlanPublicationIntegrationSyncStatus;
  processedReceiptId?: string | null;
  lastError?: string | null;
}) {
  const { error } = await supabase
    .from('executive_budget_plan_publication_receipt_integrations')
    .update({
      sync_status: params.syncStatus,
      processed_receipt_id: params.processedReceiptId || null,
      processed_at: params.syncStatus === 'procesada' ? new Date().toISOString() : null,
      last_error: params.lastError || null
    })
    .eq('id', params.integrationId);

  if (error) throw error;
}

export async function loadExecutiveBudgetPlanPublicationReceiptIntegrations(params: {
  companyId: string;
  season?: string;
  versionId?: string;
  syncStatus?: ExecutiveBudgetPlanPublicationIntegrationSyncStatus;
  limit?: number;
}) {
  let query = supabase
    .from('executive_budget_plan_publication_receipt_integrations')
    .select('*')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false });

  if (params.season) {
    query = query.eq('season', params.season);
  }

  if (params.versionId) {
    query = query.eq('version_id', params.versionId);
  }

  if (params.syncStatus) {
    query = query.eq('sync_status', params.syncStatus);
  }

  if (params.limit && params.limit > 0) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ExecutiveBudgetPlanPublicationReceiptIntegrationRow[];
}
