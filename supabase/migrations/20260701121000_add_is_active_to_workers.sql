ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_workers_company_active
  ON public.workers(company_id, is_active);
