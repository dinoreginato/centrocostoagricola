CREATE OR REPLACE FUNCTION public.agricultural_season_from_date(p_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_date IS NULL THEN NULL
    WHEN EXTRACT(MONTH FROM p_date) >= 5
      THEN CONCAT(EXTRACT(YEAR FROM p_date)::int, '-', (EXTRACT(YEAR FROM p_date)::int + 1))
    ELSE CONCAT((EXTRACT(YEAR FROM p_date)::int - 1), '-', EXTRACT(YEAR FROM p_date)::int)
  END
$$;

CREATE OR REPLACE VIEW public.v_agricultural_cost_movements
WITH (security_invoker = true)
AS
WITH sector_meta AS (
  SELECT
    s.id AS sector_id,
    s.name AS sector_name,
    s.hectares AS sector_hectares,
    s.field_id,
    f.name AS field_name,
    f.company_id
  FROM public.sectors s
  JOIN public.fields f ON f.id = s.field_id
),
worker_manual_coverage AS (
  SELECT
    wc.company_id,
    wc.sector_id,
    wc.date,
    CASE
      WHEN lower(coalesce(wc.labor_type, wc.description, '')) LIKE '%cosecha%' THEN 'Cosecha'
      WHEN lower(coalesce(wc.labor_type, wc.description, '')) LIKE '%poda%' THEN 'Poda'
      WHEN lower(coalesce(wc.labor_type, wc.description, '')) LIKE '%raleo%' THEN 'Raleo'
      ELSE 'Otros'
    END AS labor_subcategory,
    SUM(wc.amount) AS total_amount
  FROM public.worker_costs wc
  WHERE NOT (
    coalesce(wc.description, '') LIKE 'Previsión %'
    OR coalesce(wc.description, '') LIKE 'Sueldo Imponible %'
    OR coalesce(wc.description, '') LIKE 'Sueldo base %'
    OR coalesce(wc.description, '') LIKE 'Bono imponible %'
    OR coalesce(wc.description, '') LIKE 'Bonos imponibles %'
    OR coalesce(wc.description, '') LIKE 'Gratificación legal %'
    OR coalesce(wc.description, '') LIKE 'No imponible %'
    OR coalesce(wc.description, '') LIKE 'No imponibles %'
  )
  GROUP BY 1, 2, 3, 4
),
fuel_consumption_coverage AS (
  SELECT DISTINCT
    fc.company_id,
    fc.sector_id,
    date_trunc('month', fc.date::timestamp)::date AS month_date
  FROM public.fuel_consumption fc
  WHERE coalesce(fc.liters, 0) <> 0
     OR coalesce(fc.estimated_price, 0) <> 0
),
applications_base AS (
  SELECT
    'applications'::text AS source_type,
    a.id AS source_id,
    a.company_id,
    sm.field_id,
    sm.field_name,
    a.sector_id,
    sm.sector_name,
    a.application_date::date AS movement_date,
    public.agricultural_season_from_date(a.application_date::date) AS season,
    'Aplicaciones'::text AS category,
    NULL::text AS subcategory,
    coalesce(a.total_cost, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    'applications'::text AS origin_type,
    a.id AS origin_id,
    NULL::uuid AS invoice_item_id,
    NULL::uuid AS worker_id,
    NULL::uuid AS machine_id,
    NULL::uuid AS application_id,
    NULL::text AS notes
  FROM public.applications a
  LEFT JOIN sector_meta sm ON sm.sector_id = a.sector_id
),
labor_assignments_base AS (
  SELECT
    'labor_assignments'::text AS source_type,
    la.id AS source_id,
    sm.company_id,
    sm.field_id,
    sm.field_name,
    la.sector_id,
    sm.sector_name,
    la.assigned_date::date AS movement_date,
    public.agricultural_season_from_date(la.assigned_date::date) AS season,
    'Labores'::text AS category,
    CASE
      WHEN lower(coalesce(la.labor_type, '')) LIKE '%cosecha%' THEN 'Cosecha'
      WHEN lower(coalesce(la.labor_type, '')) LIKE '%poda%' THEN 'Poda'
      WHEN lower(coalesce(la.labor_type, '')) LIKE '%raleo%' THEN 'Raleo'
      ELSE 'Otros'
    END AS subcategory,
    coalesce(la.assigned_amount, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    'invoice_assignment'::text AS origin_type,
    la.id AS origin_id,
    la.invoice_item_id,
    la.worker_id,
    NULL::uuid AS machine_id,
    NULL::uuid AS application_id,
    la.notes
  FROM public.labor_assignments la
  JOIN sector_meta sm ON sm.sector_id = la.sector_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM worker_manual_coverage wmc
    WHERE wmc.company_id = sm.company_id
      AND wmc.sector_id = la.sector_id
      AND wmc.date = la.assigned_date
      AND wmc.labor_subcategory = CASE
        WHEN lower(coalesce(la.labor_type, '')) LIKE '%cosecha%' THEN 'Cosecha'
        WHEN lower(coalesce(la.labor_type, '')) LIKE '%poda%' THEN 'Poda'
        WHEN lower(coalesce(la.labor_type, '')) LIKE '%raleo%' THEN 'Raleo'
        ELSE 'Otros'
      END
      AND abs(wmc.total_amount - coalesce(la.assigned_amount, 0)::numeric) <= greatest(1000::numeric, abs(coalesce(la.assigned_amount, 0)::numeric) * 0.03)
  )
),
worker_costs_base AS (
  SELECT
    'worker_costs'::text AS source_type,
    wc.id AS source_id,
    wc.company_id,
    sm.field_id,
    sm.field_name,
    wc.sector_id,
    sm.sector_name,
    wc.date::date AS movement_date,
    public.agricultural_season_from_date(wc.date::date) AS season,
    'Trabajadores'::text AS category,
    CASE
      WHEN wc.description LIKE 'Previsión %' THEN 'Prevision'
      WHEN wc.description LIKE 'Sueldo Imponible %'
        OR wc.description LIKE 'Sueldo base %'
        OR wc.description LIKE 'Bono imponible %'
        OR wc.description LIKE 'Bonos imponibles %'
        OR wc.description LIKE 'Gratificación legal %'
        OR wc.description LIKE 'No imponible %'
        OR wc.description LIKE 'No imponibles %' THEN 'Remuneracion'
      WHEN lower(coalesce(wc.labor_type, wc.description, '')) LIKE '%cosecha%' THEN 'Manual - Cosecha'
      WHEN lower(coalesce(wc.labor_type, wc.description, '')) LIKE '%poda%' THEN 'Manual - Poda'
      WHEN lower(coalesce(wc.labor_type, wc.description, '')) LIKE '%raleo%' THEN 'Manual - Raleo'
      ELSE 'Manual - Otros'
    END AS subcategory,
    coalesce(wc.amount, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    'worker_cost'::text AS origin_type,
    wc.id AS origin_id,
    NULL::uuid AS invoice_item_id,
    wc.worker_id,
    NULL::uuid AS machine_id,
    NULL::uuid AS application_id,
    wc.description AS notes
  FROM public.worker_costs wc
  LEFT JOIN sector_meta sm ON sm.sector_id = wc.sector_id
),
fuel_assignments_base AS (
  SELECT
    'fuel_assignments'::text AS source_type,
    fa.id AS source_id,
    sm.company_id,
    sm.field_id,
    sm.field_name,
    fa.sector_id,
    sm.sector_name,
    fa.assigned_date::date AS movement_date,
    public.agricultural_season_from_date(fa.assigned_date::date) AS season,
    'Combustible'::text AS category,
    'Diesel'::text AS subcategory,
    coalesce(fa.assigned_amount, 0)::numeric AS amount,
    true AS is_official,
    true AS is_fallback,
    'invoice_assignment'::text AS origin_type,
    fa.id AS origin_id,
    fa.invoice_item_id,
    NULL::uuid AS worker_id,
    NULL::uuid AS machine_id,
    NULL::uuid AS application_id,
    NULL::text AS notes
  FROM public.fuel_assignments fa
  JOIN sector_meta sm ON sm.sector_id = fa.sector_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM fuel_consumption_coverage fcc
    WHERE fcc.company_id = sm.company_id
      AND fcc.sector_id = fa.sector_id
      AND fcc.month_date = date_trunc('month', fa.assigned_date::timestamp)::date
  )
),
fuel_consumption_base AS (
  SELECT
    'fuel_consumption'::text AS source_type,
    fc.id AS source_id,
    fc.company_id,
    sm.field_id,
    sm.field_name,
    fc.sector_id,
    sm.sector_name,
    fc.date::date AS movement_date,
    public.agricultural_season_from_date(fc.date::date) AS season,
    'Combustible'::text AS category,
    CASE
      WHEN lower(coalesce(fc.activity, '')) LIKE '%gasolina%' OR lower(coalesce(fc.activity, '')) LIKE '%bencina%' THEN 'Gasolina'
      ELSE 'Diesel'
    END AS subcategory,
    coalesce(fc.estimated_price, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    CASE WHEN fc.application_id IS NOT NULL THEN 'application_fuel' ELSE 'fuel_log' END::text AS origin_type,
    fc.id AS origin_id,
    NULL::uuid AS invoice_item_id,
    NULL::uuid AS worker_id,
    fc.machine_id,
    fc.application_id,
    fc.activity AS notes
  FROM public.fuel_consumption fc
  LEFT JOIN sector_meta sm ON sm.sector_id = fc.sector_id
),
machinery_base AS (
  SELECT
    'machinery_assignments'::text AS source_type,
    ma.id AS source_id,
    sm.company_id,
    sm.field_id,
    sm.field_name,
    ma.sector_id,
    sm.sector_name,
    ma.assigned_date::date AS movement_date,
    public.agricultural_season_from_date(ma.assigned_date::date) AS season,
    'Maquinaria'::text AS category,
    NULL::text AS subcategory,
    coalesce(ma.assigned_amount, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    'invoice_assignment'::text AS origin_type,
    ma.id AS origin_id,
    ma.invoice_item_id,
    NULL::uuid AS worker_id,
    ma.machine_id,
    NULL::uuid AS application_id,
    ma.notes
  FROM public.machinery_assignments ma
  LEFT JOIN sector_meta sm ON sm.sector_id = ma.sector_id
),
irrigation_base AS (
  SELECT
    'irrigation_assignments'::text AS source_type,
    ia.id AS source_id,
    sm.company_id,
    sm.field_id,
    sm.field_name,
    ia.sector_id,
    sm.sector_name,
    ia.assigned_date::date AS movement_date,
    public.agricultural_season_from_date(ia.assigned_date::date) AS season,
    'Riego'::text AS category,
    NULL::text AS subcategory,
    coalesce(ia.assigned_amount, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    'invoice_assignment'::text AS origin_type,
    ia.id AS origin_id,
    ia.invoice_item_id,
    NULL::uuid AS worker_id,
    NULL::uuid AS machine_id,
    NULL::uuid AS application_id,
    ia.notes
  FROM public.irrigation_assignments ia
  JOIN sector_meta sm ON sm.sector_id = ia.sector_id
),
general_costs_base AS (
  SELECT
    'general_costs'::text AS source_type,
    gc.id AS source_id,
    gc.company_id,
    sm.field_id,
    sm.field_name,
    gc.sector_id,
    sm.sector_name,
    gc.date::date AS movement_date,
    public.agricultural_season_from_date(gc.date::date) AS season,
    'Generales'::text AS category,
    nullif(gc.category, '')::text AS subcategory,
    coalesce(gc.amount, 0)::numeric AS amount,
    true AS is_official,
    false AS is_fallback,
    CASE WHEN gc.invoice_item_id IS NOT NULL THEN 'invoice_general_cost' ELSE 'manual_general_cost' END::text AS origin_type,
    gc.id AS origin_id,
    gc.invoice_item_id,
    NULL::uuid AS worker_id,
    NULL::uuid AS machine_id,
    NULL::uuid AS application_id,
    gc.description AS notes
  FROM public.general_costs gc
  JOIN sector_meta sm ON sm.sector_id = gc.sector_id
)
SELECT * FROM applications_base
UNION ALL
SELECT * FROM labor_assignments_base
UNION ALL
SELECT * FROM worker_costs_base
UNION ALL
SELECT * FROM fuel_assignments_base
UNION ALL
SELECT * FROM fuel_consumption_base
UNION ALL
SELECT * FROM machinery_base
UNION ALL
SELECT * FROM irrigation_base
UNION ALL
SELECT * FROM general_costs_base;

REVOKE ALL ON FUNCTION public.agricultural_season_from_date(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agricultural_season_from_date(date) TO authenticated;

REVOKE ALL ON TABLE public.v_agricultural_cost_movements FROM PUBLIC;
GRANT SELECT ON TABLE public.v_agricultural_cost_movements TO authenticated;
