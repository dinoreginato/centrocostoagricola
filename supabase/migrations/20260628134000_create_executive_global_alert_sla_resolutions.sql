CREATE TABLE IF NOT EXISTS public.executive_global_alert_sla_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.executive_global_alert_events(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  stage_key text NOT NULL CHECK (stage_key IN ('recognition', 'communication', 'closure')),
  resolution_kind text NOT NULL CHECK (resolution_kind IN ('normalizada', 'cerrada')),
  owner_label text,
  detail text NOT NULL,
  recommendation text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_sla_resolutions_company_created
  ON public.executive_global_alert_sla_resolutions(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_sla_resolutions_event_created
  ON public.executive_global_alert_sla_resolutions(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_sla_resolutions_company_stage
  ON public.executive_global_alert_sla_resolutions(company_id, stage_key, created_at DESC);

ALTER TABLE public.executive_global_alert_sla_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive global alert sla resolutions" ON public.executive_global_alert_sla_resolutions;
DROP POLICY IF EXISTS "Users can insert executive global alert sla resolutions" ON public.executive_global_alert_sla_resolutions;
DROP POLICY IF EXISTS "Users can delete executive global alert sla resolutions" ON public.executive_global_alert_sla_resolutions;

CREATE POLICY "Users can view executive global alert sla resolutions"
  ON public.executive_global_alert_sla_resolutions
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive global alert sla resolutions"
  ON public.executive_global_alert_sla_resolutions
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive global alert sla resolutions"
  ON public.executive_global_alert_sla_resolutions
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_global_alert_sla_resolutions TO authenticated;
