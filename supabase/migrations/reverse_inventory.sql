
CREATE OR REPLACE FUNCTION reverse_inventory_movement(
  target_product_id uuid,
  quantity_to_remove numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
