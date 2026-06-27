CREATE OR REPLACE VIEW public.v_agricultural_cost_reconciliation
WITH (security_invoker = true)
AS
SELECT
  m.company_id,
  m.field_id,
  m.field_name,
  m.sector_id,
  m.sector_name,
  m.movement_date,
  m.season,
  m.category,
  m.subcategory,
  m.amount,
  m.source_type,
  m.source_id,
  m.origin_type,
  m.origin_id,
  m.invoice_item_id,
  m.worker_id,
  m.machine_id,
  m.application_id,
  m.notes,
  m.is_official,
  m.is_fallback,
  CASE
    WHEN m.is_fallback THEN 'respaldo'
    WHEN m.origin_type LIKE 'invoice_%' THEN 'distribucion'
    WHEN m.origin_type IN ('worker_cost', 'fuel_log', 'application_fuel', 'applications', 'manual_general_cost') THEN 'oficial'
    ELSE 'oficial'
  END AS cost_role,
  CASE
    WHEN m.source_type = 'fuel_assignments' THEN 'Contable'
    WHEN m.source_type IN ('labor_assignments', 'machinery_assignments', 'irrigation_assignments') THEN 'Distribucion'
    WHEN m.source_type IN ('worker_costs', 'general_costs') THEN 'Manual'
    WHEN m.source_type IN ('fuel_consumption', 'applications') THEN 'Operacional'
    ELSE 'Otro'
  END AS source_layer,
  CASE
    WHEN m.sector_id IS NOT NULL AND m.field_id IS NOT NULL AND m.season IS NOT NULL AND coalesce(m.amount, 0) > 0 THEN true
    ELSE false
  END AS has_full_traceability,
  CASE
    WHEN m.sector_id IS NULL THEN 'Sin sector'
    WHEN m.field_id IS NULL THEN 'Sin campo'
    WHEN m.season IS NULL THEN 'Sin temporada'
    WHEN coalesce(m.amount, 0) = 0 THEN 'Monto cero'
    WHEN m.is_fallback THEN 'Respaldo contable'
    WHEN m.source_type = 'general_costs' AND m.invoice_item_id IS NULL THEN 'Costo manual'
    WHEN m.source_type = 'worker_costs' AND m.worker_id IS NULL THEN 'Costo trabajador sin trabajador'
    ELSE 'Trazable'
  END AS audit_status,
  CASE
    WHEN m.sector_id IS NULL OR m.field_id IS NULL OR m.season IS NULL THEN 'alta'
    WHEN coalesce(m.amount, 0) = 0 THEN 'alta'
    WHEN m.is_fallback THEN 'media'
    WHEN m.source_type = 'general_costs' AND m.invoice_item_id IS NULL THEN 'media'
    WHEN m.source_type = 'worker_costs' AND m.worker_id IS NULL THEN 'media'
    ELSE 'baja'
  END AS review_priority,
  concat_ws(
    '::',
    m.company_id::text,
    coalesce(m.season, 'sin-temporada'),
    coalesce(m.field_id::text, 'sin-campo'),
    coalesce(m.sector_id::text, 'sin-sector'),
    coalesce(m.category, 'sin-categoria'),
    coalesce(m.subcategory, 'sin-subcategoria'),
    coalesce(m.movement_date::text, 'sin-fecha')
  ) AS reconciliation_key
FROM public.v_agricultural_cost_movements m;

CREATE OR REPLACE VIEW public.v_agricultural_cost_reconciliation_summary
WITH (security_invoker = true)
AS
SELECT
  company_id,
  season,
  category,
  source_layer,
  cost_role,
  audit_status,
  review_priority,
  COUNT(*) AS movement_count,
  SUM(amount) AS total_amount,
  SUM(CASE WHEN has_full_traceability THEN amount ELSE 0 END) AS traceable_amount,
  SUM(CASE WHEN NOT has_full_traceability THEN amount ELSE 0 END) AS non_traceable_amount
FROM public.v_agricultural_cost_reconciliation
GROUP BY
  company_id,
  season,
  category,
  source_layer,
  cost_role,
  audit_status,
  review_priority;

REVOKE ALL ON TABLE public.v_agricultural_cost_reconciliation FROM PUBLIC;
GRANT SELECT ON TABLE public.v_agricultural_cost_reconciliation TO authenticated;

REVOKE ALL ON TABLE public.v_agricultural_cost_reconciliation_summary FROM PUBLIC;
GRANT SELECT ON TABLE public.v_agricultural_cost_reconciliation_summary TO authenticated;
