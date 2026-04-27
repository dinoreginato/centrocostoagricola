
CREATE OR REPLACE FUNCTION public.reverse_inventory_movement(
  target_product_id uuid,
  quantity_to_remove numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id
  INTO v_company_id
  FROM public.products
  WHERE id = target_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company_id AND c.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = v_company_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('admin', 'editor')
    )
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Decrease stock
  -- We do not adjust average cost on removal, usually cost is established on entry.
  -- Removing stock keeps the same unit cost for remaining items.
  UPDATE products
  SET 
    current_stock = current_stock - quantity_to_remove,
    updated_at = now()
  WHERE id = target_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_inventory_movement(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_movement(uuid, numeric) TO authenticated;
