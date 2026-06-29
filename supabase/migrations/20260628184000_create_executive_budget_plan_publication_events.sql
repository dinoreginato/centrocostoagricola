CREATE TABLE IF NOT EXISTS public.executive_budget_plan_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.executive_budget_plan_versions(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  version_kind text NOT NULL CHECK (version_kind IN ('base', 'revision', 'comite')),
  action_type text NOT NULL CHECK (action_type IN ('firmada', 'publicada_externa')),
  responsible_label text NOT NULL,
  responsible_role text NOT NULL CHECK (responsible_role IN ('gerencia_agricola', 'control_gestion', 'gerencia_general', 'comite')),
  recipient_label text,
  publication_channel text CHECK (publication_channel IN ('comite', 'directorio', 'banco_inversionista', 'auditoria_externa', 'otro')),
  reason text NOT NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_publication_company_season
  ON public.executive_budget_plan_publication_events(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_publication_version
  ON public.executive_budget_plan_publication_events(version_id, created_at DESC);

ALTER TABLE public.executive_budget_plan_publication_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan publication events" ON public.executive_budget_plan_publication_events;
DROP POLICY IF EXISTS "Users can insert executive budget plan publication events" ON public.executive_budget_plan_publication_events;
DROP POLICY IF EXISTS "Users can update executive budget plan publication events" ON public.executive_budget_plan_publication_events;
DROP POLICY IF EXISTS "Users can delete executive budget plan publication events" ON public.executive_budget_plan_publication_events;

CREATE POLICY "Users can view executive budget plan publication events"
  ON public.executive_budget_plan_publication_events
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan publication events"
  ON public.executive_budget_plan_publication_events
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can update executive budget plan publication events"
  ON public.executive_budget_plan_publication_events
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan publication events"
  ON public.executive_budget_plan_publication_events
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_budget_plan_publication_events TO authenticated;
