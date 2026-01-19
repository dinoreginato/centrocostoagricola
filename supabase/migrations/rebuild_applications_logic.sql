-- Rebuild Applications Fetching Logic (V2)
-- Using LEFT JOINs and simplified structure to guarantee data visibility and avoid RLS issues.

CREATE OR REPLACE FUNCTION get_company_applications_v2(p_company_id uuid)
RETURNS TABLE (
  id uuid,
  application_date date,
  application_type text,
  total_cost numeric,
  water_liters_per_hectare numeric,
  field_id uuid,
  field_name text,
  sector_id uuid,
  sector_name text,
  sector_hectares numeric,
  items json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.application_date,
    a.application_type,
    COALESCE(a.total_cost, 0),
    COALESCE(a.water_liters_per_hectare, 0),
    f.id as field_id,
    COALESCE(f.name, 'Campo Eliminado'),
    s.id as sector_id,
    COALESCE(s.name, 'Sector Eliminado'),
    COALESCE(s.hectares, 0),
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'product_id', ai.product_id,
            'product_name', p.name,
            'quantity_used', ai.quantity_used,
            'dose_per_hectare', ai.dose_per_hectare,
            'unit', p.unit,
            'unit_cost', ai.unit_cost,
            'total_cost', ai.total_cost
          )
        )
        FROM application_items ai
        LEFT JOIN products p ON ai.product_id = p.id
        WHERE ai.application_id = a.id
      ),
      '[]'::json
    ) as items
  FROM applications a
  LEFT JOIN fields f ON a.field_id = f.id
  LEFT JOIN sectors s ON a.sector_id = s.id
  WHERE f.company_id = p_company_id
  ORDER BY a.application_date DESC;
END;
$$;
