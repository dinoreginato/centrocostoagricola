CREATE OR REPLACE FUNCTION create_application_inventory(
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
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_item jsonb;
    v_app_id uuid;
    v_app_item_id uuid;
    v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM fields WHERE id = p_field_id;
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Campo no encontrado';
    END IF;

    IF NOT public.is_admin_or_editor(v_company_id) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    INSERT INTO applications (
        field_id,
        sector_id,
        application_date,
        application_type,
        water_liters_per_hectare,
        total_cost
    ) VALUES (
        p_field_id,
        p_sector_id,
        p_date,
        p_type,
        p_water_rate,
        p_total_cost
    ) RETURNING id INTO v_app_id;

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
            v_app_id,
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
            INSERT INTO fuel_consumption (
                company_id,
                date,
                activity,
                liters,
                estimated_price,
                sector_id,
                application_id
            ) VALUES (
                v_company_id,
                p_date,
                p_fuel_activity,
                p_fuel_liters,
                p_fuel_cost,
                p_sector_id,
                v_app_id
            );
    END IF;

    RETURN v_app_id;
END;
$$;
