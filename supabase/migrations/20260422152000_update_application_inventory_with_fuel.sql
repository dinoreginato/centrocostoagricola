DROP FUNCTION IF EXISTS update_application_inventory(uuid, uuid, uuid, date, text, numeric, numeric, jsonb);

CREATE OR REPLACE FUNCTION update_application_inventory(
    p_application_id uuid,
    p_field_id uuid,
    p_sector_id uuid,
    p_date date,
    p_type text,
    p_water_rate numeric,
    p_total_cost numeric,
    p_items jsonb,
    p_create_fuel boolean DEFAULT false,
    p_fuel_liters numeric DEFAULT NULL,
    p_fuel_cost numeric DEFAULT NULL,
    p_fuel_activity text DEFAULT 'Aplicación (Automática)'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    old_item RECORD;
    new_item jsonb;
    v_app_item_id uuid;
    v_company_id uuid;
    v_fuel_id uuid;
BEGIN
    FOR old_item IN SELECT id, product_id, quantity_used FROM application_items WHERE application_id = p_application_id LOOP
        UPDATE products
        SET current_stock = current_stock + old_item.quantity_used
        WHERE id = old_item.product_id;

        DELETE FROM inventory_movements WHERE application_item_id = old_item.id;
    END LOOP;

    DELETE FROM application_items WHERE application_id = p_application_id;

    UPDATE applications
    SET 
        field_id = p_field_id,
        sector_id = p_sector_id,
        application_date = p_date,
        application_type = p_type,
        water_liters_per_hectare = p_water_rate,
        total_cost = p_total_cost
    WHERE id = p_application_id;

    FOR new_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO application_items (
            application_id,
            product_id,
            quantity_used,
            dose_per_hectare,
            unit_cost,
            total_cost,
            objective
        ) VALUES (
            p_application_id,
            (new_item->>'product_id')::uuid,
            (new_item->>'quantity_used')::numeric,
            (new_item->>'dose_per_hectare')::numeric,
            (new_item->>'unit_cost')::numeric,
            (new_item->>'total_cost')::numeric,
            NULLIF((new_item->>'objective')::text, '')
        ) RETURNING id INTO v_app_item_id;

        UPDATE products
        SET current_stock = current_stock - (new_item->>'quantity_used')::numeric
        WHERE id = (new_item->>'product_id')::uuid;

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

    IF p_create_fuel AND p_fuel_liters IS NOT NULL AND p_fuel_cost IS NOT NULL THEN
        SELECT company_id INTO v_company_id FROM fields WHERE id = p_field_id;

        IF v_company_id IS NOT NULL THEN
            SELECT id INTO v_fuel_id FROM fuel_consumption WHERE application_id = p_application_id LIMIT 1;

            IF v_fuel_id IS NOT NULL THEN
                UPDATE fuel_consumption
                SET
                    company_id = v_company_id,
                    sector_id = p_sector_id,
                    date = p_date,
                    activity = p_fuel_activity,
                    liters = p_fuel_liters,
                    estimated_price = p_fuel_cost
                WHERE id = v_fuel_id;
            ELSE
                INSERT INTO fuel_consumption (
                    company_id,
                    sector_id,
                    date,
                    activity,
                    liters,
                    estimated_price,
                    application_id
                ) VALUES (
                    v_company_id,
                    p_sector_id,
                    p_date,
                    p_fuel_activity,
                    p_fuel_liters,
                    p_fuel_cost,
                    p_application_id
                );
            END IF;
        END IF;
    ELSE
        DELETE FROM fuel_consumption WHERE application_id = p_application_id;
    END IF;
END;
$$;

