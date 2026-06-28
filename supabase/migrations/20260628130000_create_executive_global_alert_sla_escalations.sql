CREATE TABLE IF NOT EXISTS public.executive_global_alert_sla_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.executive_global_alert_events(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  stage_key text NOT NULL CHECK (stage_key IN ('recognition', 'communication', 'closure')),
  escalation_severity text NOT NULL CHECK (escalation_severity IN ('alta', 'critica')),
  owner_label text,
  overdue_hours numeric NOT NULL DEFAULT 0,
  target_hours numeric NOT NULL DEFAULT 0,
  detail text NOT NULL,
  recommendation text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_sla_escalations_company_created
  ON public.executive_global_alert_sla_escalations(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_sla_escalations_event_created
  ON public.executive_global_alert_sla_escalations(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_sla_escalations_company_stage
  ON public.executive_global_alert_sla_escalations(company_id, stage_key, created_at DESC);

ALTER TABLE public.executive_global_alert_sla_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive global alert sla escalations" ON public.executive_global_alert_sla_escalations;
DROP POLICY IF EXISTS "Users can insert executive global alert sla escalations" ON public.executive_global_alert_sla_escalations;
DROP POLICY IF EXISTS "Users can delete executive global alert sla escalations" ON public.executive_global_alert_sla_escalations;

CREATE POLICY "Users can view executive global alert sla escalations"
  ON public.executive_global_alert_sla_escalations
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive global alert sla escalations"
  ON public.executive_global_alert_sla_escalations
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive global alert sla escalations"
  ON public.executive_global_alert_sla_escalations
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_global_alert_sla_escalations TO authenticated;
