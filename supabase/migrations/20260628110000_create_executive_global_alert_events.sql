CREATE TABLE IF NOT EXISTS public.executive_global_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('media', 'alta')),
  alert_types text[] NOT NULL DEFAULT '{}'::text[],
  alert_titles text[] NOT NULL DEFAULT '{}'::text[],
  selected_company_rank integer,
  top_quartile_cutoff integer,
  total_companies integer,
  leader_company_name text,
  detail text NOT NULL,
  recommendation text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executive_global_alert_events_company_created_at
  ON public.executive_global_alert_events(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executive_global_alert_events_company_season
  ON public.executive_global_alert_events(company_id, season, created_at DESC);

ALTER TABLE public.executive_global_alert_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive global alert events" ON public.executive_global_alert_events;
DROP POLICY IF EXISTS "Users can insert executive global alert events" ON public.executive_global_alert_events;
DROP POLICY IF EXISTS "Users can delete executive global alert events" ON public.executive_global_alert_events;

CREATE POLICY "Users can view executive global alert events"
  ON public.executive_global_alert_events
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive global alert events"
  ON public.executive_global_alert_events
  FOR INSERT
  WITH CHECK (public.has_company_access(company_id));

CREATE POLICY "Users can delete executive global alert events"
  ON public.executive_global_alert_events
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_global_alert_events TO authenticated;
