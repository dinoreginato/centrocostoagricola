CREATE TABLE IF NOT EXISTS public.executive_budget_plan_publication_receipt_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  publication_event_id uuid NOT NULL REFERENCES public.executive_budget_plan_publication_events(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.executive_budget_plan_versions(id) ON DELETE CASCADE,
  processed_receipt_id uuid REFERENCES public.executive_budget_plan_publication_receipts(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  season text NOT NULL,
  receipt_type text NOT NULL CHECK (receipt_type IN ('acuse', 'lectura')),
  confirmation_source text NOT NULL CHECK (confirmation_source IN ('correo', 'whatsapp', 'drive', 'portal')),
  integration_mode text NOT NULL CHECK (integration_mode IN ('webhook', 'polling', 'importador')),
  sync_status text NOT NULL DEFAULT 'pendiente' CHECK (sync_status IN ('pendiente', 'procesada', 'error')),
  recipient_label text NOT NULL,
  provider_label text,
  external_reference text,
  evidence_url text,
  integration_signature text NOT NULL UNIQUE,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_budget_receipt_integrations_company_season
  ON public.executive_budget_plan_publication_receipt_integrations(company_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_receipt_integrations_sync_status
  ON public.executive_budget_plan_publication_receipt_integrations(company_id, sync_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_receipt_integrations_version
  ON public.executive_budget_plan_publication_receipt_integrations(version_id, created_at DESC);

ALTER TABLE public.executive_budget_plan_publication_receipt_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive budget plan receipt integrations" ON public.executive_budget_plan_publication_receipt_integrations;
DROP POLICY IF EXISTS "Users can insert executive budget plan receipt integrations" ON public.executive_budget_plan_publication_receipt_integrations;
DROP POLICY IF EXISTS "Users can update executive budget plan receipt integrations" ON public.executive_budget_plan_publication_receipt_integrations;
DROP POLICY IF EXISTS "Users can delete executive budget plan receipt integrations" ON public.executive_budget_plan_publication_receipt_integrations;

CREATE POLICY "Users can view executive budget plan receipt integrations"
  ON public.executive_budget_plan_publication_receipt_integrations
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive budget plan receipt integrations"
  ON public.executive_budget_plan_publication_receipt_integrations
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can update executive budget plan receipt integrations"
  ON public.executive_budget_plan_publication_receipt_integrations
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive budget plan receipt integrations"
  ON public.executive_budget_plan_publication_receipt_integrations
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_budget_plan_publication_receipt_integrations TO authenticated;
