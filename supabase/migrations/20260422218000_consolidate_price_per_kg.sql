ALTER TABLE public.income_entries
ADD COLUMN IF NOT EXISTS price_per_kg numeric DEFAULT 0;

ALTER TABLE public.production_records
ADD COLUMN IF NOT EXISTS price_per_kg numeric DEFAULT 0;

