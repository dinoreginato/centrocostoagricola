
-- Add price_per_kg column to income_entries
ALTER TABLE public.income_entries
ADD COLUMN IF NOT EXISTS price_per_kg NUMERIC DEFAULT 0;
