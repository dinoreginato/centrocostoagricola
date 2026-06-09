ALTER TABLE public.worker_payroll_runs
ADD COLUMN IF NOT EXISTS worker_birth_date date,
ADD COLUMN IF NOT EXISTS worker_gender text NOT NULL DEFAULT 'unspecified',
ADD COLUMN IF NOT EXISTS worker_is_pensioner boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS worker_pension_type text,
ADD COLUMN IF NOT EXISTS worker_art69_exempt boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS worker_voluntary_afp boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'worker_payroll_runs_worker_gender_check'
  ) THEN
    ALTER TABLE public.worker_payroll_runs
    ADD CONSTRAINT worker_payroll_runs_worker_gender_check
    CHECK (worker_gender IN ('male', 'female', 'unspecified'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'worker_payroll_runs_worker_pension_type_check'
  ) THEN
    ALTER TABLE public.worker_payroll_runs
    ADD CONSTRAINT worker_payroll_runs_worker_pension_type_check
    CHECK (worker_pension_type IS NULL OR worker_pension_type IN ('old_age', 'disability_total', 'disability_partial', 'other'));
  END IF;
END;
$$;
