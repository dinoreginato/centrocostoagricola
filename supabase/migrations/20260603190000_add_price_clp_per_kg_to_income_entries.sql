-- Add CLP price per Kg for juice/pulp sales
ALTER TABLE public.income_entries
ADD COLUMN IF NOT EXISTS price_clp_per_kg NUMERIC DEFAULT 0;

