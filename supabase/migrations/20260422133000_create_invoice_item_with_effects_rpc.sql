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
  p_general_costs jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_item_id uuid;
  v_company_id uuid;
  a jsonb;
BEGIN
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

  IF jsonb_array_length(p_general_costs) > 0 THEN
    SELECT company_id INTO v_company_id FROM invoices WHERE id = p_invoice_id;
  END IF;

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
  END IF;

  RETURN v_invoice_item_id;
END;
$$;

