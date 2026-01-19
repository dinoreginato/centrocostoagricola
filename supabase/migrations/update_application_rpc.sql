-- Function to update an application safely handling inventory stock
-- 1. Restores stock from existing items
-- 2. Updates application details
-- 3. Replaces items with new ones and deducts new stock

CREATE OR REPLACE FUNCTION update_application_inventory(
    p_application_id uuid,
    p_field_id uuid,
    p_sector_id uuid,
    p_date date,
    p_type text,
    p_water_rate numeric,
    p_total_cost numeric,
    p_items jsonb -- Array of objects: {product_id, quantity_used, dose_per_hectare, unit_cost, total_cost}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    old_item RECORD;
    new_item jsonb;
    v_product_stock numeric;
    v_app_item_id uuid;
BEGIN
    -- 1. Restore stock for ALL existing items of this application
    FOR old_item IN SELECT id, product_id, quantity_used FROM application_items WHERE application_id = p_application_id LOOP
        UPDATE products
        SET current_stock = current_stock + old_item.quantity_used
        WHERE id = old_item.product_id;
        
        -- Remove associated inventory movements (salida)
        DELETE FROM inventory_movements WHERE application_item_id = old_item.id;
    END LOOP;

    -- 2. Delete existing items (we will recreate them to handle changes easily)
    DELETE FROM application_items WHERE application_id = p_application_id;

    -- 3. Update Application Header
    UPDATE applications
    SET 
        field_id = p_field_id,
        sector_id = p_sector_id,
        application_date = p_date,
        application_type = p_type,
        water_liters_per_hectare = p_water_rate,
        total_cost = p_total_cost,
        updated_at = now()
    WHERE id = p_application_id;

    -- 4. Insert New Items and Deduct Stock
    FOR new_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        -- Insert Application Item
        INSERT INTO application_items (
            application_id,
            product_id,
            quantity_used,
            dose_per_hectare,
            unit_cost,
            total_cost
        ) VALUES (
            p_application_id,
            (new_item->>'product_id')::uuid,
            (new_item->>'quantity_used')::numeric,
            (new_item->>'dose_per_hectare')::numeric,
            (new_item->>'unit_cost')::numeric,
            (new_item->>'total_cost')::numeric
        ) RETURNING id INTO v_app_item_id;

        -- Deduct Stock
        UPDATE products
        SET current_stock = current_stock - (new_item->>'quantity_used')::numeric
        WHERE id = (new_item->>'product_id')::uuid;

        -- Record Inventory Movement
        INSERT INTO inventory_movements (
            product_id,
            movement_type,
            quantity,
            unit_cost,
            application_item_id
        ) VALUES (
            (new_item->>'product_id')::uuid,
            'salida',
            (new_item->>'quantity_used')::numeric,
            (new_item->>'unit_cost')::numeric,
            v_app_item_id
        );
    END LOOP;
END;
$$;
