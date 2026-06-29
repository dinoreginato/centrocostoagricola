ALTER TABLE public.executive_budget_plan_publication_receipts
ADD COLUMN IF NOT EXISTS confirmation_source text NOT NULL DEFAULT 'manual'
  CHECK (confirmation_source IN ('manual', 'correo', 'whatsapp', 'drive', 'portal'));

ALTER TABLE public.executive_budget_plan_publication_receipts
ADD COLUMN IF NOT EXISTS integration_provider text;

ALTER TABLE public.executive_budget_plan_publication_receipts
ADD COLUMN IF NOT EXISTS external_reference text;

ALTER TABLE public.executive_budget_plan_publication_receipts
ADD COLUMN IF NOT EXISTS evidence_url text;

ALTER TABLE public.executive_budget_plan_publication_receipts
ADD COLUMN IF NOT EXISTS auto_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE public.executive_budget_plan_publication_receipts
ADD COLUMN IF NOT EXISTS confirmation_origin_label text;

CREATE INDEX IF NOT EXISTS idx_exec_budget_publication_receipts_source
  ON public.executive_budget_plan_publication_receipts(company_id, confirmation_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_budget_publication_receipts_auto_confirmed
  ON public.executive_budget_plan_publication_receipts(company_id, auto_confirmed, created_at DESC);
