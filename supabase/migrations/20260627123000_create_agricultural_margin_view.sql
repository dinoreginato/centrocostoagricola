CREATE OR REPLACE VIEW public.v_agricultural_margin
WITH (security_invoker = true)
AS
WITH sector_meta AS (
  SELECT
    f.company_id,
    f.id AS field_id,
    f.name AS field_name,
    f.fruit_type,
    s.id AS sector_id,
    s.name AS sector_name,
    COALESCE(s.hectares, 0)::numeric AS hectares,
    COALESCE(s.budget, 0)::numeric AS budget_per_ha
  FROM public.fields f
  JOIN public.sectors s ON s.field_id = f.id
),
cost_base AS (
  SELECT
    m.company_id,
    m.field_id,
    m.sector_id,
    m.season,
    SUM(m.amount)::numeric AS total_cost
  FROM public.v_agricultural_cost_movements m
  WHERE m.season IS NOT NULL
    AND m.sector_id IS NOT NULL
  GROUP BY m.company_id, m.field_id, m.sector_id, m.season
),
income_base AS (
  SELECT
    ie.company_id,
    COALESCE(ie.field_id, s.field_id) AS field_id,
    ie.sector_id,
    COALESCE(NULLIF(ie.season, ''), public.agricultural_season_from_date(ie.date)) AS season,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta' THEN COALESCE(ie.quantity_kg, 0)
        ELSE 0
      END
    )::numeric AS kg_sent_export,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta' THEN COALESCE(ie.quantity_kg, 0) * GREATEST(LEAST(COALESCE(ie.export_percentage, 0), 100), 0) / 100
        ELSE 0
      END
    )::numeric AS kg_export,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta Jugo' THEN COALESCE(ie.quantity_kg, 0)
        ELSE 0
      END
    )::numeric AS kg_juice,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta' THEN
          COALESCE(
            NULLIF(ie.amount_usd, 0),
            (COALESCE(ie.quantity_kg, 0) * GREATEST(LEAST(COALESCE(ie.export_percentage, 0), 100), 0) / 100) * COALESCE(ie.price_per_kg, 0),
            0
          )
        ELSE 0
      END
    )::numeric AS income_usd_export,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta Jugo' THEN
          COALESCE(
            NULLIF(ie.amount_usd, 0),
            COALESCE(ie.quantity_kg, 0) * COALESCE(ie.price_per_kg, 0),
            0
          )
        ELSE 0
      END
    )::numeric AS income_usd_juice,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta' THEN COALESCE(ie.amount, 0)
        ELSE 0
      END
    )::numeric AS income_clp_export,
    SUM(
      CASE
        WHEN ie.category = 'Venta Fruta Jugo' THEN COALESCE(ie.amount, 0)
        ELSE 0
      END
    )::numeric AS income_clp_juice
  FROM public.income_entries ie
  LEFT JOIN public.sectors s ON s.id = ie.sector_id
  WHERE ie.sector_id IS NOT NULL
    AND COALESCE(NULLIF(ie.season, ''), public.agricultural_season_from_date(ie.date)) IS NOT NULL
    AND ie.category IN ('Venta Fruta', 'Venta Fruta Jugo')
  GROUP BY
    ie.company_id,
    COALESCE(ie.field_id, s.field_id),
    ie.sector_id,
    COALESCE(NULLIF(ie.season, ''), public.agricultural_season_from_date(ie.date))
),
production_base AS (
  SELECT
    pr.company_id,
    s.field_id,
    pr.sector_id,
    CONCAT(pr.season_year::int, '-', (pr.season_year::int + 1)) AS season,
    SUM(COALESCE(pr.kg_produced, 0))::numeric AS kg_produced_record
  FROM public.production_records pr
  JOIN public.sectors s ON s.id = pr.sector_id
  GROUP BY pr.company_id, s.field_id, pr.sector_id, CONCAT(pr.season_year::int, '-', (pr.season_year::int + 1))
),
season_scope AS (
  SELECT company_id, field_id, sector_id, season FROM cost_base
  UNION
  SELECT company_id, field_id, sector_id, season FROM income_base
  UNION
  SELECT company_id, field_id, sector_id, season FROM production_base
)
SELECT
  sm.company_id,
  sm.field_id,
  sm.field_name,
  sm.fruit_type,
  sm.sector_id,
  sm.sector_name,
  ss.season,
  sm.hectares,
  sm.budget_per_ha,
  (sm.hectares * sm.budget_per_ha)::numeric AS total_budget,
  COALESCE(cb.total_cost, 0)::numeric AS total_cost,
  COALESCE(ib.income_clp_export, 0)::numeric AS income_clp_export,
  COALESCE(ib.income_usd_export, 0)::numeric AS income_usd_export,
  COALESCE(ib.income_clp_juice, 0)::numeric AS income_clp_juice,
  COALESCE(ib.income_usd_juice, 0)::numeric AS income_usd_juice,
  (COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0))::numeric AS total_income_clp,
  (COALESCE(ib.income_usd_export, 0) + COALESCE(ib.income_usd_juice, 0))::numeric AS total_income_usd,
  COALESCE(ib.kg_sent_export, 0)::numeric AS kg_sent_export,
  COALESCE(ib.kg_export, 0)::numeric AS kg_export,
  COALESCE(ib.kg_juice, 0)::numeric AS kg_juice,
  (COALESCE(ib.kg_export, 0) + COALESCE(ib.kg_juice, 0))::numeric AS kg_sold,
  COALESCE(pb.kg_produced_record, COALESCE(ib.kg_sent_export, 0) + COALESCE(ib.kg_juice, 0), 0)::numeric AS kg_produced,
  (pb.kg_produced_record IS NOT NULL) AS has_production_record,
  ((COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0)) > 0) AS has_income_data,
  (COALESCE(cb.total_cost, 0) > 0) AS has_cost_data,
  CASE
    WHEN pb.kg_produced_record IS NOT NULL THEN 'production_records'
    WHEN (COALESCE(ib.kg_sent_export, 0) + COALESCE(ib.kg_juice, 0)) > 0 THEN 'income_entries'
    ELSE 'sin_produccion'
  END AS production_source,
  CASE
    WHEN COALESCE(ib.kg_export, 0) > 0 THEN COALESCE(ib.income_usd_export, 0) / NULLIF(ib.kg_export, 0)
    ELSE 0
  END::numeric AS price_export_usd_per_kg,
  CASE
    WHEN COALESCE(ib.kg_juice, 0) > 0 THEN COALESCE(ib.income_usd_juice, 0) / NULLIF(ib.kg_juice, 0)
    ELSE 0
  END::numeric AS price_juice_usd_per_kg,
  CASE
    WHEN (COALESCE(ib.kg_export, 0) + COALESCE(ib.kg_juice, 0)) > 0 THEN
      (COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0))
      / NULLIF(COALESCE(ib.kg_export, 0) + COALESCE(ib.kg_juice, 0), 0)
    ELSE 0
  END::numeric AS income_price_clp_per_kg,
  CASE
    WHEN (COALESCE(ib.kg_export, 0) + COALESCE(ib.kg_juice, 0)) > 0 THEN
      (COALESCE(ib.income_usd_export, 0) + COALESCE(ib.income_usd_juice, 0))
      / NULLIF(COALESCE(ib.kg_export, 0) + COALESCE(ib.kg_juice, 0), 0)
    ELSE 0
  END::numeric AS income_price_usd_per_kg,
  CASE
    WHEN sm.hectares > 0 THEN COALESCE(cb.total_cost, 0) / NULLIF(sm.hectares, 0)
    ELSE 0
  END::numeric AS cost_per_ha,
  CASE
    WHEN COALESCE(pb.kg_produced_record, COALESCE(ib.kg_sent_export, 0) + COALESCE(ib.kg_juice, 0), 0) > 0 THEN
      COALESCE(cb.total_cost, 0) / NULLIF(COALESCE(pb.kg_produced_record, COALESCE(ib.kg_sent_export, 0) + COALESCE(ib.kg_juice, 0), 0), 0)
    ELSE 0
  END::numeric AS cost_per_kg,
  ((COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0)) - COALESCE(cb.total_cost, 0))::numeric AS profit_clp,
  CASE
    WHEN sm.hectares > 0 THEN
      ((COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0)) - COALESCE(cb.total_cost, 0))
      / NULLIF(sm.hectares, 0)
    ELSE 0
  END::numeric AS profit_per_ha,
  CASE
    WHEN (COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0)) > 0 THEN
      (((COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0)) - COALESCE(cb.total_cost, 0))
      / NULLIF((COALESCE(ib.income_clp_export, 0) + COALESCE(ib.income_clp_juice, 0)), 0)) * 100
    ELSE 0
  END::numeric AS margin_pct
FROM season_scope ss
JOIN sector_meta sm
  ON sm.company_id = ss.company_id
 AND sm.field_id = ss.field_id
 AND sm.sector_id = ss.sector_id
LEFT JOIN cost_base cb
  ON cb.company_id = ss.company_id
 AND cb.field_id = ss.field_id
 AND cb.sector_id = ss.sector_id
 AND cb.season = ss.season
LEFT JOIN income_base ib
  ON ib.company_id = ss.company_id
 AND ib.field_id = ss.field_id
 AND ib.sector_id = ss.sector_id
 AND ib.season = ss.season
LEFT JOIN production_base pb
  ON pb.company_id = ss.company_id
 AND pb.field_id = ss.field_id
 AND pb.sector_id = ss.sector_id
 AND pb.season = ss.season;
