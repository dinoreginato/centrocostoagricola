CREATE TABLE IF NOT EXISTS public.executive_budget_plan_publication_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  publication_event_id uuid NOT NULL REFERENCES public.executive_budget_plan_publication_events(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.executive_budget_plan_versions(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  receipt_type text NOT NULL CHECK (receipt_type IN ('acuse', 'lectura')),
  recipient_label text NOT NULL,
  responsible_label text NOT NULL,
  responsible_role text NOT NULL CHECK (responsible_role IN ('gerencia_agricola', 'control_gestion', 'gerencia_general', 'comite')),
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_publication_receipts_company_season
  ON public.executive_budget_plan_publication_receipts(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_publication_receipts_publication
  ON public.executive_budget_plan_publication_receipts(publication_event_id, created_at DESC);

ALTER TABLE public.executive_budget_plan_publication_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan publication receipts" ON public.executive_budget_plan_publication_receipts;
DROP POLICY IF EXISTS "Users can insert executive budget plan publication receipts" ON public.executive_budget_plan_publication_receipts;
DROP POLICY IF EXISTS "Users can update executive budget plan publication receipts" ON public.executive_budget_plan_publication_receipts;
DROP POLICY IF EXISTS "Users can delete executive budget plan publication receipts" ON public.executive_budget_plan_publication_receipts;

CREATE POLICY "Users can view executive budget plan publication receipts"
  ON public.executive_budget_plan_publication_receipts
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan publication receipts"
  ON public.executive_budget_plan_publication_receipts
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can update executive budget plan publication receipts"
  ON public.executive_budget_plan_publication_receipts
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan publication receipts"
  ON public.executive_budget_plan_publication_receipts
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_budget_plan_publication_receipts TO authenticated;
