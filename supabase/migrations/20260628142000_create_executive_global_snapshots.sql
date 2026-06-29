CREATE TABLE IF NOT EXISTS public.executive_global_ranking_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  ranking_signature text NOT NULL,
  selected_company_rank integer,
  total_companies integer NOT NULL DEFAULT 0,
  leader_company_name text,
  average_score numeric NOT NULL DEFAULT 0,
  average_closure_pct numeric NOT NULL DEFAULT 0,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.executive_global_preventive_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  preventive_signature text NOT NULL,
  total_recommendations integer NOT NULL DEFAULT 0,
  top_severity text CHECK (top_severity IN ('media', 'alta')),
  top_stage_key text CHECK (top_stage_key IN ('recognition', 'communication', 'closure')),
  top_owner_label text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_global_ranking_snapshots_company_created
  ON public.executive_global_ranking_snapshots(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_ranking_snapshots_company_season
  ON public.executive_global_ranking_snapshots(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_preventive_snapshots_company_created
  ON public.executive_global_preventive_snapshots(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_preventive_snapshots_company_season
  ON public.executive_global_preventive_snapshots(company_id, season, created_at DESC);

ALTER TABLE public.executive_global_ranking_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_global_preventive_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive global ranking snapshots" ON public.executive_global_ranking_snapshots;
DROP POLICY IF EXISTS "Users can insert executive global ranking snapshots" ON public.executive_global_ranking_snapshots;
DROP POLICY IF EXISTS "Users can delete executive global ranking snapshots" ON public.executive_global_ranking_snapshots;
DROP POLICY IF EXISTS "Users can view executive global preventive snapshots" ON public.executive_global_preventive_snapshots;
DROP POLICY IF EXISTS "Users can insert executive global preventive snapshots" ON public.executive_global_preventive_snapshots;
DROP POLICY IF EXISTS "Users can delete executive global preventive snapshots" ON public.executive_global_preventive_snapshots;

CREATE POLICY "Users can view executive global ranking snapshots"
  ON public.executive_global_ranking_snapshots
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive global ranking snapshots"
  ON public.executive_global_ranking_snapshots
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive global ranking snapshots"
  ON public.executive_global_ranking_snapshots
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can view executive global preventive snapshots"
  ON public.executive_global_preventive_snapshots
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive global preventive snapshots"
  ON public.executive_global_preventive_snapshots
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive global preventive snapshots"
  ON public.executive_global_preventive_snapshots
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_global_ranking_snapshots TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.executive_global_preventive_snapshots TO authenticated;
