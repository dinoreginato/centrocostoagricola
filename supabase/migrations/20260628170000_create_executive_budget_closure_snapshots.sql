CREATE TABLE IF NOT EXISTS public.executive_budget_closure_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  closure_signature text NOT NULL,
  budget_status text NOT NULL CHECK (budget_status IN ('completo', 'parcial', 'fragil')),
  total_budget numeric NOT NULL DEFAULT 0,
  total_actual_cost numeric NOT NULL DEFAULT 0,
  budget_execution_pct numeric NOT NULL DEFAULT 0,
  coverage_pct numeric NOT NULL DEFAULT 0,
  sectors_with_budget integer NOT NULL DEFAULT 0,
  total_sectors integer NOT NULL DEFAULT 0,
  mixed_fields_count integer NOT NULL DEFAULT 0,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_closure_snapshots_company_created
  ON public.executive_budget_closure_snapshots(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_closure_snapshots_company_season
  ON public.executive_budget_closure_snapshots(company_id, season, created_at DESC);

ALTER TABLE public.executive_budget_closure_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget closure snapshots" ON public.executive_budget_closure_snapshots;
DROP POLICY IF EXISTS "Users can insert executive budget closure snapshots" ON public.executive_budget_closure_snapshots;
DROP POLICY IF EXISTS "Users can delete executive budget closure snapshots" ON public.executive_budget_closure_snapshots;

CREATE POLICY "Users can view executive budget closure snapshots"
  ON public.executive_budget_closure_snapshots
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget closure snapshots"
  ON public.executive_budget_closure_snapshots
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget closure snapshots"
  ON public.executive_budget_closure_snapshots
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_budget_closure_snapshots TO authenticated;
