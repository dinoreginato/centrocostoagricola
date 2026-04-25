CREATE OR REPLACE FUNCTION public.get_fuel_stats(
  p_company_id uuid,
  p_type text
)
RETURNS TABLE (avg_price numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT
    CASE
      WHEN COALESCE(SUM(ii.quantity), 0) > 0 THEN SUM(ii.unit_price * ii.quantity) / SUM(ii.quantity)
      ELSE NULL
    END
  INTO v_avg
  FROM public.invoice_items ii
  JOIN public.invoices i ON ii.invoice_id = i.id
  LEFT JOIN public.products p ON ii.product_id = p.id
  WHERE i.company_id = p_company_id
    AND (
      lower(COALESCE(ii.category, '')) LIKE '%petroleo%' OR
      lower(COALESCE(ii.category, '')) LIKE '%combustible%' OR
      lower(COALESCE(p.name, '')) LIKE '%' || lower(COALESCE(p_type, '')) || '%' OR
      lower(COALESCE(p.category, '')) LIKE '%' || lower(COALESCE(p_type, '')) || '%'
    );

  RETURN QUERY SELECT v_avg;
END;
$$;

REVOKE ALL ON FUNCTION public.get_fuel_stats(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fuel_stats(uuid, text) TO authenticated;

