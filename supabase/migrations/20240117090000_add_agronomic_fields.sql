ALTER TABLE public.applications
ADD COLUMN IF NOT EXISTS water_liters_per_hectare numeric DEFAULT 0;

ALTER TABLE public.application_items
ADD COLUMN IF NOT EXISTS dose_per_hectare numeric DEFAULT 0;

