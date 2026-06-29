UPDATE public.sectors
SET budget = 0
WHERE budget IS NULL;

ALTER TABLE public.sectors
ALTER COLUMN budget SET DEFAULT 0;

ALTER TABLE public.sectors
ALTER COLUMN budget SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sectors_budget_nonnegative_check'
  ) THEN
    ALTER TABLE public.sectors
    ADD CONSTRAINT sectors_budget_nonnegative_check
    CHECK (budget >= 0);
  END IF;
END $$;
