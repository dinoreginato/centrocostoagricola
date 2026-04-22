CREATE OR REPLACE FUNCTION delete_invoice_items_with_effects(
  p_invoice_item_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_quantity numeric;
BEGIN
  IF p_invoice_item_ids IS NULL OR array_length(p_invoice_item_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY p_invoice_item_ids LOOP
    SELECT product_id, quantity
    INTO v_product_id, v_quantity
    FROM invoice_items
    WHERE id = v_id;

    IF v_product_id IS NOT NULL AND v_quantity IS NOT NULL THEN
      PERFORM reverse_inventory_movement(v_product_id, v_quantity);
    END IF;

    DELETE FROM fuel_assignments WHERE invoice_item_id = v_id;
    DELETE FROM irrigation_assignments WHERE invoice_item_id = v_id;
    DELETE FROM machinery_assignments WHERE invoice_item_id = v_id;
    DELETE FROM labor_assignments WHERE invoice_item_id = v_id;
    DELETE FROM general_costs WHERE invoice_item_id = v_id;

    DELETE FROM invoice_items WHERE id = v_id;
  END LOOP;
END;
$$;

