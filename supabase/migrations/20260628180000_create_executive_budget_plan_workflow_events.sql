CREATE TABLE IF NOT EXISTS public.executive_budget_plan_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_id uuid REFERENCES public.executive_budget_plan_versions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  version_kind text NOT NULL CHECK (version_kind IN ('base', 'revision', 'comite')),
  action_type text NOT NULL CHECK (action_type IN ('publicada', 'observada', 'freeze_comite')),
  responsible_label text NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_workflow_company_created
  ON public.executive_budget_plan_workflow_events(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_workflow_company_season
  ON public.executive_budget_plan_workflow_events(company_id, season, created_at DESC);

ALTER TABLE public.executive_budget_plan_workflow_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan workflow events" ON public.executive_budget_plan_workflow_events;
DROP POLICY IF EXISTS "Users can insert executive budget plan workflow events" ON public.executive_budget_plan_workflow_events;
DROP POLICY IF EXISTS "Users can delete executive budget plan workflow events" ON public.executive_budget_plan_workflow_events;

CREATE POLICY "Users can view executive budget plan workflow events"
  ON public.executive_budget_plan_workflow_events
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan workflow events"
  ON public.executive_budget_plan_workflow_events
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan workflow events"
  ON public.executive_budget_plan_workflow_events
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_budget_plan_workflow_events TO authenticated;
