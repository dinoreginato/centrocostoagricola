
-- Drop the function first to ensure clean slate
DROP FUNCTION IF EXISTS update_inventory_with_average_cost(uuid, numeric, numeric, uuid);

CREATE OR REPLACE FUNCTION update_inventory_with_average_cost(
  product_id uuid,
  quantity_in numeric,
  unit_cost numeric,
  invoice_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_stock_val numeric;
  current_avg_cost_val numeric;
  new_stock numeric;
  new_avg_cost numeric;
BEGIN
  -- Get current product state
  SELECT current_stock, average_cost
  INTO current_stock_val, current_avg_cost_val
  FROM products
  WHERE id = product_id;

  -- Handle nulls
  IF current_stock_val IS NULL THEN
    current_stock_val := 0;
  END IF;
  
  IF current_avg_cost_val IS NULL THEN
    current_avg_cost_val := 0;
  END IF;

  -- Calculate new values
  new_stock := current_stock_val + quantity_in;
  
  IF new_stock > 0 THEN
    new_avg_cost := ((current_stock_val * current_avg_cost_val) + (quantity_in * unit_cost)) / new_stock;
  ELSE
    new_avg_cost := 0;
  END IF;

  -- Update product
  UPDATE products
  SET 
    current_stock = new_stock,
    average_cost = new_avg_cost,
    updated_at = now()
  WHERE id = product_id;
END;
$$;
