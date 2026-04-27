CREATE OR REPLACE FUNCTION public.get_inventory_stock_audit(p_company_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  product_unit text,
  current_stock numeric,
  expected_stock numeric,
  diff numeric,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT public.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  WITH ins AS (
    SELECT ii.product_id, SUM(ii.quantity)::numeric AS in_qty
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE i.company_id = p_company_id
      AND COALESCE(i.status, '') <> 'Anulada'
    GROUP BY ii.product_id
  ),
  outs AS (
    SELECT ai.product_id, SUM(ai.quantity_used)::numeric AS out_qty
    FROM public.application_items ai
    JOIN public.applications a ON a.id = ai.application_id
    LEFT JOIN public.fields f ON f.id = a.field_id
    LEFT JOIN public.sectors s ON s.id = a.sector_id
    LEFT JOIN public.fields f2 ON f2.id = s.field_id
    WHERE COALESCE(f.company_id, f2.company_id) = p_company_id
    GROUP BY ai.product_id
  ),
  man AS (
    SELECT im.product_id,
           SUM(CASE WHEN im.movement_type = 'entrada' THEN im.quantity ELSE -im.quantity END)::numeric AS man_qty
    FROM public.inventory_movements im
    JOIN public.products p2 ON p2.id = im.product_id
    WHERE im.manual = true
      AND p2.company_id = p_company_id
    GROUP BY im.product_id
  )
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.unit AS product_unit,
    p.current_stock::numeric AS current_stock,
    (COALESCE(ins.in_qty, 0) - COALESCE(outs.out_qty, 0) + COALESCE(man.man_qty, 0)) AS expected_stock,
    (p.current_stock::numeric - (COALESCE(ins.in_qty, 0) - COALESCE(outs.out_qty, 0) + COALESCE(man.man_qty, 0))) AS diff,
    p.updated_at
  FROM public.products p
  LEFT JOIN ins ON ins.product_id = p.id
  LEFT JOIN outs ON outs.product_id = p.id
  LEFT JOIN man ON man.product_id = p.id
  WHERE p.company_id = p_company_id
    AND p.category <> 'Archivado'
  ORDER BY ABS(p.current_stock::numeric - (COALESCE(ins.in_qty, 0) - COALESCE(outs.out_qty, 0) + COALESCE(man.man_qty, 0))) DESC,
           p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_stock_audit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inventory_stock_audit(uuid) TO authenticated;

