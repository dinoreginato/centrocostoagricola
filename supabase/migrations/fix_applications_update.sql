-- Function to update an application safely handling inventory stock
-- 1. Restores stock from existing items
-- 2. Updates application details
-- 3. Replaces items with new ones and deducts new stock

CREATE OR REPLACE FUNCTION public.update_application_inventory(
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
SET search_path = public
AS $$
DECLARE
    old_item RECORD;
    new_item jsonb;
    v_app_item_id uuid;
    v_company_id uuid;
BEGIN
    SELECT f.company_id
    INTO v_company_id
    FROM public.applications a
    JOIN public.fields f ON a.field_id = f.id
    WHERE a.id = p_application_id;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Aplicación no encontrada';
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

    IF EXISTS (
        SELECT 1
        FROM public.fields f2
        WHERE f2.id = p_field_id
          AND f2.company_id <> v_company_id
    ) THEN
        RAISE EXCEPTION 'Campo no pertenece a la misma empresa';
    END IF;

    IF p_sector_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f3 ON s.field_id = f3.id
        WHERE s.id = p_sector_id
          AND f3.company_id <> v_company_id
    ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la misma empresa';
    END IF;

    -- 1. Restore stock for ALL existing items of this application
    FOR old_item IN SELECT id, product_id, quantity_used FROM application_items WHERE application_id = p_application_id LOOP
        -- Restore stock
        UPDATE products
        SET current_stock = current_stock + old_item.quantity_used
        WHERE id = old_item.product_id;
        
        -- Remove associated inventory movements (salida) linked to this item
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
        total_cost = p_total_cost
        -- removed updated_at as column might not exist
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
            -- Removed company_id as it might not exist in the table structure or is handled by default
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

REVOKE ALL ON FUNCTION public.update_application_inventory(uuid, uuid, uuid, date, text, numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_application_inventory(uuid, uuid, uuid, date, text, numeric, numeric, jsonb) TO authenticated;
