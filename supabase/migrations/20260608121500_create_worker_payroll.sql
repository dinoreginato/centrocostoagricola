CREATE TABLE IF NOT EXISTS public.worker_payroll_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  worker_id uuid NOT NULL REFERENCES public.workers(id),
  month date NOT NULL,
  field_id uuid REFERENCES public.fields(id),
  sector_id uuid REFERENCES public.sectors(id),
  gross_imponible numeric NOT NULL DEFAULT 0,
  contract_type text NOT NULL DEFAULT 'indefinite',
  afp_name text,
  afp_commission_rate numeric NOT NULL DEFAULT 0,
  health_type text NOT NULL DEFAULT 'fonasa',
  health_rate numeric NOT NULL DEFAULT 7,
  health_plan_amount numeric NOT NULL DEFAULT 0,
  mutual_rate numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'worker_payroll_runs_contract_type_check'
  ) THEN
    ALTER TABLE public.worker_payroll_runs
    ADD CONSTRAINT worker_payroll_runs_contract_type_check
    CHECK (contract_type IN ('indefinite', 'fixed_term', 'work'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'worker_payroll_runs_health_type_check'
  ) THEN
    ALTER TABLE public.worker_payroll_runs
    ADD CONSTRAINT worker_payroll_runs_health_type_check
    CHECK (health_type IN ('fonasa', 'isapre'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_payroll_runs_unique
ON public.worker_payroll_runs (company_id, worker_id, month, sector_id);

ALTER TABLE public.worker_payroll_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_worker_payroll_runs" ON public.worker_payroll_runs;
DROP POLICY IF EXISTS "policy_write_worker_payroll_runs" ON public.worker_payroll_runs;

CREATE POLICY "policy_read_worker_payroll_runs" ON public.worker_payroll_runs FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_worker_payroll_runs" ON public.worker_payroll_runs FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

CREATE TABLE IF NOT EXISTS public.worker_payroll_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.worker_payroll_runs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  payer text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  rate numeric NOT NULL DEFAULT 0,
  base_amount numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'worker_payroll_items_payer_check'
  ) THEN
    ALTER TABLE public.worker_payroll_items
    ADD CONSTRAINT worker_payroll_items_payer_check
    CHECK (payer IN ('worker', 'employer'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_worker_payroll_items_run_id
ON public.worker_payroll_items (run_id);

ALTER TABLE public.worker_payroll_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_worker_payroll_items" ON public.worker_payroll_items;
DROP POLICY IF EXISTS "policy_write_worker_payroll_items" ON public.worker_payroll_items;

CREATE POLICY "policy_read_worker_payroll_items" ON public.worker_payroll_items FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_worker_payroll_items" ON public.worker_payroll_items FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

