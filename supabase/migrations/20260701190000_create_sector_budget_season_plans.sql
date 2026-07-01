CREATE TABLE IF NOT EXISTS public.sector_budget_season_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  season text NOT NULL,
  budget_cost_clp_per_ha numeric NOT NULL DEFAULT 0,
  budget_cost_usd_per_ha numeric NOT NULL DEFAULT 0,
  expected_production_kg numeric NOT NULL DEFAULT 0,
  expected_sale_price_clp_per_kg numeric NOT NULL DEFAULT 0,
  expected_sale_price_usd_per_kg numeric NOT NULL DEFAULT 0,
  exchange_rate_reference numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sector_budget_season_plans_sector_season_key UNIQUE (sector_id, season),
  CONSTRAINT sector_budget_season_plans_budget_cost_clp_nonnegative CHECK (budget_cost_clp_per_ha >= 0),
  CONSTRAINT sector_budget_season_plans_budget_cost_usd_nonnegative CHECK (budget_cost_usd_per_ha >= 0),
  CONSTRAINT sector_budget_season_plans_expected_production_nonnegative CHECK (expected_production_kg >= 0),
  CONSTRAINT sector_budget_season_plans_sale_price_clp_nonnegative CHECK (expected_sale_price_clp_per_kg >= 0),
  CONSTRAINT sector_budget_season_plans_sale_price_usd_nonnegative CHECK (expected_sale_price_usd_per_kg >= 0),
  CONSTRAINT sector_budget_season_plans_exchange_rate_nonnegative CHECK (exchange_rate_reference >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sector_budget_season_plans_sector
  ON public.sector_budget_season_plans(sector_id);

CREATE INDEX IF NOT EXISTS idx_sector_budget_season_plans_season
  ON public.sector_budget_season_plans(season);

CREATE OR REPLACE FUNCTION public.set_sector_budget_season_plans_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sector_budget_season_plans_updated_at
  ON public.sector_budget_season_plans;

CREATE TRIGGER trg_sector_budget_season_plans_updated_at
BEFORE UPDATE ON public.sector_budget_season_plans
FOR EACH ROW
EXECUTE FUNCTION public.set_sector_budget_season_plans_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sector_budget_season_plans TO authenticated;
