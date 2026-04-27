ALTER TABLE public.production_records
ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

UPDATE public.production_records pr
SET company_id = f.company_id
FROM public.sectors s
JOIN public.fields f ON s.field_id = f.id
WHERE pr.sector_id = s.id
  AND pr.company_id IS NULL;

