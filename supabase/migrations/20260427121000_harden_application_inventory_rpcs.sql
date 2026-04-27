CREATE OR REPLACE FUNCTION public.get_company_applications(company_id_input uuid)
RETURNS TABLE (
  id uuid,
  application_date date,
  application_type text,
  total_cost numeric,
  water_liters_per_hectare numeric,
  field json,
  sector json,
  application_items json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_company_member(company_id_input) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT 
    a.id,
    a.application_date,
    a.application_type,
    a.total_cost,
    a.water_liters_per_hectare,
    json_build_object('name', f.name, 'company_id', f.company_id) as field,
    json_build_object('name', s.name, 'hectares', s.hectares) as sector,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'quantity_used', ai.quantity_used,
            'dose_per_hectare', ai.dose_per_hectare,
            'total_cost', ai.total_cost,
            'product', json_build_object('name', p.name, 'unit', p.unit)
          )
        )
        FROM public.application_items ai
        JOIN public.products p ON ai.product_id = p.id
        WHERE ai.application_id = a.id
      ),
      '[]'::json
    ) as application_items
  FROM public.applications a
  JOIN public.fields f ON a.field_id = f.id
  JOIN public.sectors s ON a.sector_id = s.id
  WHERE f.company_id = company_id_input
  ORDER BY a.application_date DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_applications(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_applications(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.create_application_inventory(
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
    v_product_company_id uuid;
    v_current_stock numeric;
    v_qty numeric;
BEGIN
    SELECT f.company_id INTO v_company_id FROM public.fields f WHERE f.id = p_field_id;
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Campo no encontrado';
    END IF;

    IF NOT public.is_admin_or_editor(v_company_id) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF p_sector_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.sectors s
      JOIN public.fields f2 ON s.field_id = f2.id
      WHERE s.id = p_sector_id
        AND (f2.id <> p_field_id OR f2.company_id <> v_company_id)
    ) THEN
      RAISE EXCEPTION 'Sector no pertenece al campo/empresa';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
      RAISE EXCEPTION 'Items inválidos';
    END IF;

    FOR new_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_qty := (new_item->>'quantity_used')::numeric;

      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad inválida';
      END IF;

      SELECT p.company_id, COALESCE(p.current_stock, 0)
      INTO v_product_company_id, v_current_stock
      FROM public.products p
      WHERE p.id = (new_item->>'product_id')::uuid;

      IF v_product_company_id IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado';
      END IF;

      IF v_product_company_id <> v_company_id THEN
        RAISE EXCEPTION 'Producto no pertenece a la empresa';
      END IF;

      IF v_current_stock < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente';
      END IF;
    END LOOP;

    INSERT INTO public.applications (
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
        v_qty := (new_item->>'quantity_used')::numeric;

        INSERT INTO public.application_items (
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
            v_qty,
            (new_item->>'dose_per_hectare')::numeric,
            (new_item->>'unit_cost')::numeric,
            (new_item->>'total_cost')::numeric,
            NULLIF((new_item->>'objective')::text, '')
        ) RETURNING id INTO v_app_item_id;

        UPDATE public.products
        SET current_stock = current_stock - v_qty
        WHERE id = (new_item->>'product_id')::uuid;

        INSERT INTO public.inventory_movements (
            product_id,
            movement_type,
            quantity,
            unit_cost,
            application_item_id
        ) VALUES (
            (new_item->>'product_id')::uuid,
            'salida',
            v_qty,
            (new_item->>'unit_cost')::numeric,
            v_app_item_id
        );
    END LOOP;

    IF p_create_fuel AND p_fuel_liters IS NOT NULL AND p_fuel_cost IS NOT NULL THEN
            INSERT INTO public.fuel_consumption (
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

REVOKE ALL ON FUNCTION public.create_application_inventory(
  uuid, uuid, date, text, numeric, numeric, jsonb, boolean, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_application_inventory(
  uuid, uuid, date, text, numeric, numeric, jsonb, boolean, numeric, numeric, text
) TO authenticated;


CREATE OR REPLACE FUNCTION public.update_application_inventory(
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
SET search_path = public
AS $$
DECLARE
    old_item RECORD;
    new_item jsonb;
    v_app_item_id uuid;
    v_company_id uuid;
    v_fuel_id uuid;
    v_product_company_id uuid;
    v_current_stock numeric;
    v_qty numeric;
BEGIN
    SELECT f.company_id INTO v_company_id
    FROM public.applications a
    JOIN public.fields f ON a.field_id = f.id
    WHERE a.id = p_application_id;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Aplicación no encontrada';
    END IF;

    IF NOT public.is_admin_or_editor(v_company_id) THEN
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
        AND (f3.company_id <> v_company_id OR f3.id <> p_field_id)
    ) THEN
      RAISE EXCEPTION 'Sector no pertenece al campo/empresa';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
      RAISE EXCEPTION 'Items inválidos';
    END IF;

    FOR old_item IN
      SELECT id, product_id, quantity_used
      FROM public.application_items
      WHERE application_id = p_application_id
    LOOP
        UPDATE public.products
        SET current_stock = current_stock + old_item.quantity_used
        WHERE id = old_item.product_id;

        DELETE FROM public.inventory_movements WHERE application_item_id = old_item.id;
    END LOOP;

    DELETE FROM public.application_items WHERE application_id = p_application_id;

    UPDATE public.applications
    SET 
        field_id = p_field_id,
        sector_id = p_sector_id,
        application_date = p_date,
        application_type = p_type,
        water_liters_per_hectare = p_water_rate,
        total_cost = p_total_cost
    WHERE id = p_application_id;

    FOR new_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_qty := (new_item->>'quantity_used')::numeric;

      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Cantidad inválida';
      END IF;

      SELECT p.company_id, COALESCE(p.current_stock, 0)
      INTO v_product_company_id, v_current_stock
      FROM public.products p
      WHERE p.id = (new_item->>'product_id')::uuid;

      IF v_product_company_id IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado';
      END IF;

      IF v_product_company_id <> v_company_id THEN
        RAISE EXCEPTION 'Producto no pertenece a la empresa';
      END IF;

      IF v_current_stock < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente';
      END IF;
    END LOOP;

    FOR new_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_qty := (new_item->>'quantity_used')::numeric;

        INSERT INTO public.application_items (
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
            v_qty,
            (new_item->>'dose_per_hectare')::numeric,
            (new_item->>'unit_cost')::numeric,
            (new_item->>'total_cost')::numeric,
            NULLIF((new_item->>'objective')::text, '')
        ) RETURNING id INTO v_app_item_id;

        UPDATE public.products
        SET current_stock = current_stock - v_qty
        WHERE id = (new_item->>'product_id')::uuid;

        INSERT INTO public.inventory_movements (
            product_id,
            movement_type,
            quantity,
            unit_cost,
            application_item_id
        ) VALUES (
            (new_item->>'product_id')::uuid,
            'salida',
            v_qty,
            (new_item->>'unit_cost')::numeric,
            v_app_item_id
        );
    END LOOP;

    IF p_create_fuel AND p_fuel_liters IS NOT NULL AND p_fuel_cost IS NOT NULL THEN
            SELECT id INTO v_fuel_id FROM public.fuel_consumption WHERE application_id = p_application_id LIMIT 1;

            IF v_fuel_id IS NOT NULL THEN
                UPDATE public.fuel_consumption
                SET
                    company_id = v_company_id,
                    sector_id = p_sector_id,
                    date = p_date,
                    activity = p_fuel_activity,
                    liters = p_fuel_liters,
                    estimated_price = p_fuel_cost
                WHERE id = v_fuel_id;
            ELSE
                INSERT INTO public.fuel_consumption (
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
    ELSE
        DELETE FROM public.fuel_consumption WHERE application_id = p_application_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_application_inventory(
  uuid, uuid, uuid, date, text, numeric, numeric, jsonb, boolean, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_application_inventory(
  uuid, uuid, uuid, date, text, numeric, numeric, jsonb, boolean, numeric, numeric, text
) TO authenticated;

