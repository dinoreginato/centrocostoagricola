CREATE TABLE IF NOT EXISTS public.executive_export_warning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  report_scope text NOT NULL DEFAULT 'executive' CHECK (report_scope IN ('executive')),
  export_format text NOT NULL CHECK (export_format IN ('pdf', 'excel')),
  readiness_title text NOT NULL,
  total_closure_pct numeric NOT NULL DEFAULT 0,
  warning_types text[] NOT NULL DEFAULT '{}'::text[],
  warning_summary text NOT NULL,
  warning_detail text,
  field_filter text,
  field_label text,
  compare_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  compare_company_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executive_export_warning_events_company_created_at
  ON public.executive_export_warning_events(company_id, created_at DESC);

ALTER TABLE public.executive_export_warning_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive export warning events" ON public.executive_export_warning_events;
DROP POLICY IF EXISTS "Users can insert executive export warning events" ON public.executive_export_warning_events;
DROP POLICY IF EXISTS "Users can delete executive export warning events" ON public.executive_export_warning_events;

CREATE POLICY "Users can view executive export warning events"
  ON public.executive_export_warning_events
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive export warning events"
  ON public.executive_export_warning_events
  FOR INSERT
  WITH CHECK (public.has_company_access(company_id));

CREATE POLICY "Users can delete executive export warning events"
  ON public.executive_export_warning_events
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_export_warning_events TO authenticated;
