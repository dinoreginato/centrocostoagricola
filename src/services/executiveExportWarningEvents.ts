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
  metadata?: Record<string, unknown>;
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
      metadata: params.metadata || {}
    });

  if (error) throw error;
}
