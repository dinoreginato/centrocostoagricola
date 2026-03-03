
-- 1. Add objective column to application_items
ALTER TABLE application_items 
ADD COLUMN IF NOT EXISTS objective TEXT;

-- 2. Update the RPC function to handle the new objective field in UPDATE
CREATE OR REPLACE FUNCTION update_application_inventory(
    p_application_id uuid,
    p_field_id uuid,
    p_sector_id uuid,
    p_date date,
    p_type text,
    p_water_rate numeric,
    p_total_cost numeric,
    p_items jsonb -- Array of objects: {product_id, quantity_used, dose_per_hectare, unit_cost, total_cost, objective}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    old_item RECORD;
    new_item jsonb;
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
            total_cost,
            objective
        ) VALUES (
            p_application_id,
            (new_item->>'product_id')::uuid,
            (new_item->>'quantity_used')::numeric,
            (new_item->>'dose_per_hectare')::numeric,
            (new_item->>'unit_cost')::numeric,
            (new_item->>'total_cost')::numeric,
            (new_item->>'objective')::text
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

-- 3. Update get_company_applications_v2 to include objective in result
CREATE OR REPLACE FUNCTION get_company_applications_v2(p_company_id uuid)
RETURNS TABLE (
  id uuid,
  application_date date,
  application_type text,
  total_cost numeric,
  water_liters_per_hectare numeric,
  field_id uuid,
  field_name text,
  sector_id uuid,
  sector_name text,
  sector_hectares numeric,
  items json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.application_date,
    a.application_type::text,
    COALESCE(a.total_cost, 0)::numeric,
    COALESCE(a.water_liters_per_hectare, 0)::numeric,
    f.id as field_id,
    COALESCE(f.name, 'Campo Eliminado')::text as field_name,
    s.id as sector_id,
    COALESCE(s.name, 'Sector Eliminado')::text as sector_name,
    COALESCE(s.hectares, 0)::numeric as sector_hectares,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'product_id', ai.product_id,
            'product_name', p.name,
            'quantity_used', ai.quantity_used,
            'dose_per_hectare', ai.dose_per_hectare,
            'unit', p.unit,
            'unit_cost', ai.unit_cost,
            'total_cost', ai.total_cost,
            'objective', ai.objective
          )
        )
        FROM application_items ai
        LEFT JOIN products p ON ai.product_id = p.id
        WHERE ai.application_id = a.id
      ),
      '[]'::json
    ) as items
  FROM applications a
  LEFT JOIN fields f ON a.field_id = f.id
  LEFT JOIN sectors s ON a.sector_id = s.id
  WHERE f.company_id = p_company_id
  ORDER BY a.application_date DESC;
END;
$$;
