CREATE TABLE IF NOT EXISTS public.executive_budget_plan_publication_divergences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.executive_budget_plan_versions(id) ON DELETE CASCADE,
  signoff_event_id uuid REFERENCES public.executive_budget_plan_publication_events(id) ON DELETE SET NULL,
  publication_event_id uuid REFERENCES public.executive_budget_plan_publication_events(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  divergence_signature text NOT NULL UNIQUE,
  divergence_status text NOT NULL CHECK (divergence_status IN ('alineado', 'documento_faltante', 'referencia_distinta', 'hash_distinto', 'hash_y_referencia_distintos')),
  signed_document_ref text,
  signed_document_hash text,
  published_document_ref text,
  published_document_hash text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_publication_divergences_company_season
  ON public.executive_budget_plan_publication_divergences(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_plan_publication_divergences_version
  ON public.executive_budget_plan_publication_divergences(version_id, created_at DESC);

ALTER TABLE public.executive_budget_plan_publication_divergences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan publication divergences" ON public.executive_budget_plan_publication_divergences;
DROP POLICY IF EXISTS "Users can insert executive budget plan publication divergences" ON public.executive_budget_plan_publication_divergences;
DROP POLICY IF EXISTS "Users can update executive budget plan publication divergences" ON public.executive_budget_plan_publication_divergences;
DROP POLICY IF EXISTS "Users can delete executive budget plan publication divergences" ON public.executive_budget_plan_publication_divergences;

CREATE POLICY "Users can view executive budget plan publication divergences"
  ON public.executive_budget_plan_publication_divergences
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan publication divergences"
  ON public.executive_budget_plan_publication_divergences
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can update executive budget plan publication divergences"
  ON public.executive_budget_plan_publication_divergences
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan publication divergences"
  ON public.executive_budget_plan_publication_divergences
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_budget_plan_publication_divergences TO authenticated;
