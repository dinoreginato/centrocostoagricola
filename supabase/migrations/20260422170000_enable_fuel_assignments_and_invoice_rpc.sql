ALTER TABLE fuel_assignments DROP CONSTRAINT IF EXISTS fuel_assignments_assigned_amount_check;

CREATE OR REPLACE FUNCTION create_invoice_item_with_effects(
  p_invoice_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_total_price numeric,
  p_category text,
  p_labor_assignments jsonb DEFAULT '[]'::jsonb,
  p_irrigation_assignments jsonb DEFAULT '[]'::jsonb,
  p_machinery_assignments jsonb DEFAULT '[]'::jsonb,
  p_general_costs jsonb DEFAULT '[]'::jsonb,
  p_fuel_assignments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_item_id uuid;
  v_company_id uuid;
  a jsonb;
BEGIN
  SELECT company_id INTO v_company_id FROM invoices WHERE id = p_invoice_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  INSERT INTO invoice_items (
    invoice_id,
    product_id,
    quantity,
    unit_price,
    total_price,
    category
  ) VALUES (
    p_invoice_id,
    p_product_id,
    p_quantity,
    p_unit_price,
    p_total_price,
    p_category
  ) RETURNING id INTO v_invoice_item_id;

  PERFORM update_inventory_with_average_cost(p_product_id, p_quantity, p_unit_price, v_invoice_item_id);

  FOR a IN SELECT * FROM jsonb_array_elements(p_labor_assignments) LOOP
    INSERT INTO labor_assignments (
      invoice_item_id,
      sector_id,
      assigned_amount,
      assigned_date,
      labor_type,
      worker_id,
      notes
    ) VALUES (
      v_invoice_item_id,
      (a->>'sector_id')::uuid,
      (a->>'assigned_amount')::numeric,
      (a->>'assigned_date')::date,
      (a->>'labor_type')::text,
      NULLIF((a->>'worker_id')::text, '')::uuid,
      NULLIF((a->>'notes')::text, '')
    );
  END LOOP;

  FOR a IN SELECT * FROM jsonb_array_elements(p_irrigation_assignments) LOOP
    INSERT INTO irrigation_assignments (
      invoice_item_id,
      sector_id,
      assigned_amount,
      assigned_date,
      notes
    ) VALUES (
      v_invoice_item_id,
      (a->>'sector_id')::uuid,
      (a->>'assigned_amount')::numeric,
      (a->>'assigned_date')::date,
      NULLIF((a->>'notes')::text, '')
    );
  END LOOP;

  FOR a IN SELECT * FROM jsonb_array_elements(p_machinery_assignments) LOOP
    INSERT INTO machinery_assignments (
      invoice_item_id,
      sector_id,
      machine_id,
      assigned_amount,
      assigned_date,
      notes
    ) VALUES (
      v_invoice_item_id,
      NULLIF((a->>'sector_id')::text, '')::uuid,
      NULLIF((a->>'machine_id')::text, '')::uuid,
      (a->>'assigned_amount')::numeric,
      (a->>'assigned_date')::date,
      NULLIF((a->>'notes')::text, '')
    );
  END LOOP;

  IF v_company_id IS NOT NULL THEN
    FOR a IN SELECT * FROM jsonb_array_elements(p_general_costs) LOOP
      INSERT INTO general_costs (
        company_id,
        invoice_item_id,
        sector_id,
        amount,
        date,
        category,
        description
      ) VALUES (
        v_company_id,
        v_invoice_item_id,
        (a->>'sector_id')::uuid,
        (a->>'amount')::numeric,
        (a->>'date')::date,
        (a->>'category')::text,
        (a->>'description')::text
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_fuel_assignments) LOOP
      INSERT INTO fuel_assignments (
        invoice_item_id,
        sector_id,
        assigned_amount,
        assigned_date
      ) VALUES (
        v_invoice_item_id,
        (a->>'sector_id')::uuid,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date
      );
    END LOOP;
  END IF;

  RETURN v_invoice_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_invoice_item_with_effects(
  p_invoice_item_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_total_price numeric,
  p_category text,
  p_recalc_inventory boolean DEFAULT true,
  p_replace_assignments boolean DEFAULT false,
  p_labor_assignments jsonb DEFAULT '[]'::jsonb,
  p_irrigation_assignments jsonb DEFAULT '[]'::jsonb,
  p_machinery_assignments jsonb DEFAULT '[]'::jsonb,
  p_general_costs jsonb DEFAULT '[]'::jsonb,
  p_fuel_assignments jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_product_id uuid;
  v_old_quantity numeric;
  v_company_id uuid;
  a jsonb;
BEGIN
  SELECT i.company_id
  INTO v_company_id
  FROM invoice_items ii
  JOIN invoices i ON ii.invoice_id = i.id
  WHERE ii.id = p_invoice_item_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Ítem no encontrado';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_recalc_inventory THEN
    SELECT product_id, quantity INTO v_old_product_id, v_old_quantity
    FROM invoice_items
    WHERE id = p_invoice_item_id;

    IF v_old_product_id IS NOT NULL AND v_old_quantity IS NOT NULL THEN
      PERFORM reverse_inventory_movement(v_old_product_id, v_old_quantity);
    END IF;
  END IF;

  UPDATE invoice_items
  SET
    product_id = p_product_id,
    quantity = p_quantity,
    unit_price = p_unit_price,
    total_price = p_total_price,
    category = p_category
  WHERE id = p_invoice_item_id;

  IF p_recalc_inventory THEN
    PERFORM update_inventory_with_average_cost(p_product_id, p_quantity, p_unit_price, p_invoice_item_id);
  END IF;

  IF p_replace_assignments THEN
    DELETE FROM labor_assignments WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM irrigation_assignments WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM machinery_assignments WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM general_costs WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM fuel_assignments WHERE invoice_item_id = p_invoice_item_id;

    FOR a IN SELECT * FROM jsonb_array_elements(p_labor_assignments) LOOP
      INSERT INTO labor_assignments (
        invoice_item_id,
        sector_id,
        assigned_amount,
        assigned_date,
        labor_type,
        worker_id,
        notes
      ) VALUES (
        p_invoice_item_id,
        (a->>'sector_id')::uuid,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date,
        (a->>'labor_type')::text,
        NULLIF((a->>'worker_id')::text, '')::uuid,
        NULLIF((a->>'notes')::text, '')
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_irrigation_assignments) LOOP
      INSERT INTO irrigation_assignments (
        invoice_item_id,
        sector_id,
        assigned_amount,
        assigned_date,
        notes
      ) VALUES (
        p_invoice_item_id,
        (a->>'sector_id')::uuid,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date,
        NULLIF((a->>'notes')::text, '')
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_machinery_assignments) LOOP
      INSERT INTO machinery_assignments (
        invoice_item_id,
        sector_id,
        machine_id,
        assigned_amount,
        assigned_date,
        notes
      ) VALUES (
        p_invoice_item_id,
        NULLIF((a->>'sector_id')::text, '')::uuid,
        NULLIF((a->>'machine_id')::text, '')::uuid,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date,
        NULLIF((a->>'notes')::text, '')
      );
    END LOOP;

    IF v_company_id IS NOT NULL THEN
      FOR a IN SELECT * FROM jsonb_array_elements(p_general_costs) LOOP
        INSERT INTO general_costs (
          company_id,
          invoice_item_id,
          sector_id,
          amount,
          date,
          category,
          description
        ) VALUES (
          v_company_id,
          p_invoice_item_id,
          (a->>'sector_id')::uuid,
          (a->>'amount')::numeric,
          (a->>'date')::date,
          (a->>'category')::text,
          (a->>'description')::text
        );
      END LOOP;

      FOR a IN SELECT * FROM jsonb_array_elements(p_fuel_assignments) LOOP
        INSERT INTO fuel_assignments (
          invoice_item_id,
          sector_id,
          assigned_amount,
          assigned_date
        ) VALUES (
          p_invoice_item_id,
          (a->>'sector_id')::uuid,
          (a->>'assigned_amount')::numeric,
          (a->>'assigned_date')::date
        );
      END LOOP;
    END IF;
  END IF;
END;
$$;
