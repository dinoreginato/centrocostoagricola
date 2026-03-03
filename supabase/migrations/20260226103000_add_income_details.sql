
-- Add quantity_kg and amount_usd to income_entries
ALTER TABLE public.income_entries
ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS amount_usd NUMERIC DEFAULT 0;
