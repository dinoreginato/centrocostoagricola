CREATE TABLE IF NOT EXISTS public.executive_budget_plan_verification_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.executive_budget_plan_versions(id) ON DELETE CASCADE,
  signoff_event_id uuid REFERENCES public.executive_budget_plan_publication_events(id) ON DELETE SET NULL,
  publication_event_id uuid REFERENCES public.executive_budget_plan_publication_events(id) ON DELETE SET NULL,
  receipt_id uuid REFERENCES public.executive_budget_plan_publication_receipts(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  version_kind text NOT NULL CHECK (version_kind IN ('base', 'revision', 'comite')),
  verification_signature text NOT NULL UNIQUE,
  folio_code text NOT NULL,
  verification_code text NOT NULL,
  folio_status text NOT NULL CHECK (folio_status IN ('emitido', 'publicado', 'acusado')),
  document_ref text,
  document_hash text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_verification_folios_company_season
  ON public.executive_budget_plan_verification_folios(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_verification_folios_version
  ON public.executive_budget_plan_verification_folios(version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_verification_folios_status
  ON public.executive_budget_plan_verification_folios(company_id, folio_status, created_at DESC);

ALTER TABLE public.executive_budget_plan_verification_folios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan verification folios" ON public.executive_budget_plan_verification_folios;
DROP POLICY IF EXISTS "Users can insert executive budget plan verification folios" ON public.executive_budget_plan_verification_folios;
DROP POLICY IF EXISTS "Users can update executive budget plan verification folios" ON public.executive_budget_plan_verification_folios;
DROP POLICY IF EXISTS "Users can delete executive budget plan verification folios" ON public.executive_budget_plan_verification_folios;

CREATE POLICY "Users can view executive budget plan verification folios"
  ON public.executive_budget_plan_verification_folios
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan verification folios"
  ON public.executive_budget_plan_verification_folios
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can update executive budget plan verification folios"
  ON public.executive_budget_plan_verification_folios
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan verification folios"
  ON public.executive_budget_plan_verification_folios
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_budget_plan_verification_folios TO authenticated;
