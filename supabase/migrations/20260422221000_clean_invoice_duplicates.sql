CREATE OR REPLACE FUNCTION public.clean_invoice_duplicates(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  first_id uuid;
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR r IN
    SELECT product_id, unit_price, COUNT(*) AS cnt
    FROM public.invoice_items
    WHERE invoice_id = p_invoice_id
    GROUP BY product_id, unit_price
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO first_id
    FROM public.invoice_items
    WHERE invoice_id = p_invoice_id
      AND product_id = r.product_id
      AND unit_price = r.unit_price
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    DELETE FROM public.invoice_items
    WHERE invoice_id = p_invoice_id
      AND product_id = r.product_id
      AND unit_price = r.unit_price
      AND id <> first_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.clean_invoice_duplicates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clean_invoice_duplicates(uuid) TO authenticated;

