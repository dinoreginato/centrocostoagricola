import { supabase } from '../supabase/client';

export type ExecutiveExportWarningEventCreate = {
  companyId: string;
  season: string;
  exportFormat: 'pdf' | 'excel';
  readinessTitle: string;
  totalClosurePct: number;
  warningTypes: string[];
  warningSummary: string;
  warningDetail?: string | null;
  fieldFilter?: string | null;
  fieldLabel?: string | null;
  compareCompanyId?: string | null;
  compareCompanyName?: string | null;
  circulationRecipient?: string | null;
  circulationReason?: string | null;
  circulationNotes?: string | null;
  metadata?: Record<string, unknown>;
};

export type ExecutiveExportWarningEventRow = {
  id: string;
  company_id: string;
  created_by: string;
  season: string;
  report_scope: 'executive';
  export_format: 'pdf' | 'excel';
  readiness_title: string;
  total_closure_pct: number;
  warning_types: string[];
  warning_summary: string;
  warning_detail: string | null;
  field_filter: string | null;
  field_label: string | null;
  compare_company_id: string | null;
  compare_company_name: string | null;
  circulation_recipient: string | null;
  circulation_reason: string | null;
  circulation_notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function createExecutiveExportWarningEvent(params: ExecutiveExportWarningEventCreate) {
  const { error } = await supabase
    .from('executive_export_warning_events')
    .insert({
      company_id: params.companyId,
      season: params.season,
      report_scope: 'executive',
      export_format: params.exportFormat,
      readiness_title: params.readinessTitle,
      total_closure_pct: params.totalClosurePct,
      warning_types: params.warningTypes,
      warning_summary: params.warningSummary,
      warning_detail: params.warningDetail || null,
      field_filter: params.fieldFilter || null,
      field_label: params.fieldLabel || null,
      compare_company_id: params.compareCompanyId || null,
      compare_company_name: params.compareCompanyName || null,
      circulation_recipient: params.circulationRecipient || null,
      circulation_reason: params.circulationReason || null,
      circulation_notes: params.circulationNotes || null,
      metadata: params.metadata || {}
    });

  if (error) throw error;
}

export async function loadExecutiveExportWarningEvents(params: {
  companyId: string;
  season?: string;
  limit?: number;
}) {
  let query = supabase
    .from('executive_export_warning_events')
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
  return (data || []) as ExecutiveExportWarningEventRow[];
}
