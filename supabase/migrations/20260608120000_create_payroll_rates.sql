CREATE TABLE IF NOT EXISTS public.payroll_rates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  payer text NOT NULL,
  value numeric NOT NULL,
  effective_from date NOT NULL,
  source_url text,
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payroll_rates_kind_check'
  ) THEN
    ALTER TABLE public.payroll_rates
    ADD CONSTRAINT payroll_rates_kind_check
    CHECK (kind IN ('rate', 'cap_uf', 'amount'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payroll_rates_payer_check'
  ) THEN
    ALTER TABLE public.payroll_rates
    ADD CONSTRAINT payroll_rates_payer_check
    CHECK (payer IN ('worker', 'employer', 'system'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_rates_unique
ON public.payroll_rates (company_id, code, effective_from);

ALTER TABLE public.payroll_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_payroll_rates" ON public.payroll_rates;
DROP POLICY IF EXISTS "policy_write_payroll_rates" ON public.payroll_rates;

CREATE POLICY "policy_read_payroll_rates" ON public.payroll_rates FOR SELECT
USING (
  company_id IS NULL
  OR public.is_company_member(company_id)
);

CREATE POLICY "policy_write_payroll_rates" ON public.payroll_rates FOR ALL
USING (
  (company_id IS NULL AND public.is_system_admin())
  OR (company_id IS NOT NULL AND public.is_admin_or_editor(company_id))
)
WITH CHECK (
  (company_id IS NULL AND public.is_system_admin())
  OR (company_id IS NOT NULL AND public.is_admin_or_editor(company_id))
);

CREATE TABLE IF NOT EXISTS public.payroll_rate_proposals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payroll_rate_proposals_status_check'
  ) THEN
    ALTER TABLE public.payroll_rate_proposals
    ADD CONSTRAINT payroll_rate_proposals_status_check
    CHECK (status IN ('proposed', 'applied', 'dismissed'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payroll_rate_proposals_company_effective_from
ON public.payroll_rate_proposals (company_id, effective_from);

ALTER TABLE public.payroll_rate_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_payroll_rate_proposals" ON public.payroll_rate_proposals;
DROP POLICY IF EXISTS "policy_write_payroll_rate_proposals" ON public.payroll_rate_proposals;

CREATE POLICY "policy_read_payroll_rate_proposals" ON public.payroll_rate_proposals FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_payroll_rate_proposals" ON public.payroll_rate_proposals FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

