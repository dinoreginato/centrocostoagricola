ALTER TABLE public.sectors
  ADD COLUMN IF NOT EXISTS expected_production_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_price_per_kg numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sectors_expected_production_kg_nonnegative_check'
  ) THEN
    ALTER TABLE public.sectors
      ADD CONSTRAINT sectors_expected_production_kg_nonnegative_check
      CHECK (expected_production_kg >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sectors_expected_price_per_kg_nonnegative_check'
  ) THEN
    ALTER TABLE public.sectors
      ADD CONSTRAINT sectors_expected_price_per_kg_nonnegative_check
      CHECK (expected_price_per_kg >= 0);
  END IF;
END;
$$;
