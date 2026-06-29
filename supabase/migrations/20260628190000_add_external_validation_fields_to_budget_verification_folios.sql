ALTER TABLE public.executive_budget_plan_verification_folios
ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pendiente'
  CHECK (validation_status IN ('pendiente', 'listo', 'documento_incompleto'));

ALTER TABLE public.executive_budget_plan_verification_folios
ADD COLUMN IF NOT EXISTS external_validation_code text;

ALTER TABLE public.executive_budget_plan_verification_folios
ADD COLUMN IF NOT EXISTS verification_url text;

ALTER TABLE public.executive_budget_plan_verification_folios
ADD COLUMN IF NOT EXISTS qr_payload text;

CREATE INDEX IF NOT EXISTS idx_exec_budget_verification_folios_validation_status
  ON public.executive_budget_plan_verification_folios(company_id, validation_status, created_at DESC);
