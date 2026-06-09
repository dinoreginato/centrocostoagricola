ALTER TABLE public.worker_payroll_runs
ADD COLUMN IF NOT EXISTS ccaf_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS ccaf_name text;
