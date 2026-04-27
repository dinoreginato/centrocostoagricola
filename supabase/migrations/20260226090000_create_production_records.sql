CREATE TABLE IF NOT EXISTS public.production_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  kg_produced numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(sector_id, season_year)
);

ALTER TABLE public.production_records
ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.production_records
ADD COLUMN IF NOT EXISTS sector_id uuid REFERENCES public.sectors(id) ON DELETE CASCADE;

