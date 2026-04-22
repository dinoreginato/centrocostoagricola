CREATE OR REPLACE FUNCTION update_invoice_item_with_inventory(
  p_invoice_item_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_total_price numeric,
  p_category text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_product_id uuid;
  v_old_quantity numeric;
BEGIN
  SELECT product_id, quantity INTO v_old_product_id, v_old_quantity
  FROM invoice_items
  WHERE id = p_invoice_item_id;

  IF v_old_product_id IS NOT NULL AND v_old_quantity IS NOT NULL THEN
    PERFORM reverse_inventory_movement(v_old_product_id, v_old_quantity);
  END IF;

  UPDATE invoice_items
  SET
    product_id = p_product_id,
    quantity = p_quantity,
    unit_price = p_unit_price,
    total_price = p_total_price,
    category = p_category
  WHERE id = p_invoice_item_id;

  PERFORM update_inventory_with_average_cost(p_product_id, p_quantity, p_unit_price, p_invoice_item_id);
END;
$$;

