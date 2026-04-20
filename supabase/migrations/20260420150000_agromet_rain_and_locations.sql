ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS longitude numeric;

ALTER TABLE public.sectors ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE public.sectors ADD COLUMN IF NOT EXISTS longitude numeric;

ALTER TABLE public.rain_logs ADD COLUMN IF NOT EXISTS field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL;
ALTER TABLE public.rain_logs ADD COLUMN IF NOT EXISTS sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL;
ALTER TABLE public.rain_logs ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.rain_logs ADD COLUMN IF NOT EXISTS station_id text;
ALTER TABLE public.rain_logs ADD COLUMN IF NOT EXISTS station_name text;

CREATE INDEX IF NOT EXISTS idx_rain_logs_company_date ON public.rain_logs(company_id, date);
CREATE INDEX IF NOT EXISTS idx_rain_logs_company_field_date ON public.rain_logs(company_id, field_id, date);
CREATE INDEX IF NOT EXISTS idx_rain_logs_company_sector_date ON public.rain_logs(company_id, sector_id, date);

