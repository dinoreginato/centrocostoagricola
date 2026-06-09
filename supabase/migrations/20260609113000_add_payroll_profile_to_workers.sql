ALTER TABLE public.workers
ADD COLUMN IF NOT EXISTS birth_date date,
ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'unspecified',
ADD COLUMN IF NOT EXISTS is_pensioner boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS pension_type text,
ADD COLUMN IF NOT EXISTS voluntary_afp_after_legal_age boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS art69_exempt boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workers_gender_check'
  ) THEN
    ALTER TABLE public.workers
    ADD CONSTRAINT workers_gender_check
    CHECK (gender IN ('male', 'female', 'unspecified'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workers_pension_type_check'
  ) THEN
    ALTER TABLE public.workers
    ADD CONSTRAINT workers_pension_type_check
    CHECK (pension_type IS NULL OR pension_type IN ('old_age', 'disability_total', 'disability_partial', 'other'));
  END IF;
END;
$$;
