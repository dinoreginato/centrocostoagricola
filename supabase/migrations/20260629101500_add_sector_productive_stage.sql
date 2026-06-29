ALTER TABLE public.sectors
  ADD COLUMN IF NOT EXISTS productive_stage text NOT NULL DEFAULT 'productivo'
    CHECK (productive_stage IN ('productivo', 'en_formacion', 'renovacion', 'arranque')),
  ADD COLUMN IF NOT EXISTS production_expected_from_season text,
  ADD COLUMN IF NOT EXISTS non_productive_reason text
    CHECK (non_productive_reason IN ('plantacion_nueva', 'replante', 'recuperacion', 'otro')),
  ADD COLUMN IF NOT EXISTS establishment_notes text;

CREATE INDEX IF NOT EXISTS idx_sectors_productive_stage
  ON public.sectors(productive_stage);

CREATE INDEX IF NOT EXISTS idx_sectors_production_expected_season
  ON public.sectors(production_expected_from_season);
