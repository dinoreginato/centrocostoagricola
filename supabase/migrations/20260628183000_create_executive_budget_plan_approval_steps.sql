CREATE TABLE IF NOT EXISTS public.executive_budget_plan_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.executive_budget_plan_versions(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  version_kind text NOT NULL CHECK (version_kind IN ('base', 'revision', 'comite')),
  approval_role text NOT NULL CHECK (approval_role IN ('gerencia_agricola', 'control_gestion', 'gerencia_general', 'comite')),
  step_order integer NOT NULL CHECK (step_order BETWEEN 1 AND 4),
  approval_status text NOT NULL DEFAULT 'pendiente' CHECK (approval_status IN ('pendiente', 'aprobada', 'observada', 'congelada')),
  responsible_label text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_budget_plan_approval_steps_version_role_key UNIQUE (version_id, approval_role)
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_approval_steps_company_season
  ON public.executive_budget_plan_approval_steps(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_approval_steps_version_order
  ON public.executive_budget_plan_approval_steps(version_id, step_order);

ALTER TABLE public.executive_budget_plan_approval_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan approval steps" ON public.executive_budget_plan_approval_steps;
DROP POLICY IF EXISTS "Users can insert executive budget plan approval steps" ON public.executive_budget_plan_approval_steps;
DROP POLICY IF EXISTS "Users can update executive budget plan approval steps" ON public.executive_budget_plan_approval_steps;
DROP POLICY IF EXISTS "Users can delete executive budget plan approval steps" ON public.executive_budget_plan_approval_steps;

CREATE POLICY "Users can view executive budget plan approval steps"
  ON public.executive_budget_plan_approval_steps
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan approval steps"
  ON public.executive_budget_plan_approval_steps
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can update executive budget plan approval steps"
  ON public.executive_budget_plan_approval_steps
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan approval steps"
  ON public.executive_budget_plan_approval_steps
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_budget_plan_approval_steps TO authenticated;
