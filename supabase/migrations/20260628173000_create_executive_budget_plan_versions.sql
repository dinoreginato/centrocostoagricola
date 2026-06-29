CREATE TABLE IF NOT EXISTS public.executive_budget_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  version_kind text NOT NULL CHECK (version_kind IN ('base', 'revision', 'comite')),
  version_signature text NOT NULL,
  total_budget numeric NOT NULL DEFAULT 0,
  coverage_pct numeric NOT NULL DEFAULT 0,
  execution_pct numeric NOT NULL DEFAULT 0,
  budget_status text NOT NULL CHECK (budget_status IN ('completo', 'parcial', 'fragil')),
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_versions_company_created
  ON public.executive_budget_plan_versions(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_versions_company_season
  ON public.executive_budget_plan_versions(company_id, season, created_at DESC);

ALTER TABLE public.executive_budget_plan_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan versions" ON public.executive_budget_plan_versions;
DROP POLICY IF EXISTS "Users can insert executive budget plan versions" ON public.executive_budget_plan_versions;
DROP POLICY IF EXISTS "Users can delete executive budget plan versions" ON public.executive_budget_plan_versions;

CREATE POLICY "Users can view executive budget plan versions"
  ON public.executive_budget_plan_versions
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan versions"
  ON public.executive_budget_plan_versions
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan versions"
  ON public.executive_budget_plan_versions
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_budget_plan_versions TO authenticated;
