CREATE OR REPLACE FUNCTION public.create_invoice_item_with_effects(
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
  v_product_company_id uuid;
  a jsonb;
BEGIN
  SELECT i.company_id INTO v_company_id
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT p.company_id INTO v_product_company_id
    FROM public.products p
    WHERE p.id = p_product_id;

    IF v_product_company_id IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    IF v_product_company_id <> v_company_id THEN
      RAISE EXCEPTION 'Producto no pertenece a la compañía de la factura';
    END IF;
  END IF;

  INSERT INTO public.invoice_items (
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

  IF p_product_id IS NOT NULL THEN
    PERFORM public.update_inventory_with_average_cost(p_product_id, p_quantity, p_unit_price, v_invoice_item_id);
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(p_labor_assignments) LOOP
    INSERT INTO public.labor_assignments (
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
    INSERT INTO public.irrigation_assignments (
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
    INSERT INTO public.machinery_assignments (
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
      INSERT INTO public.general_costs (
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
      INSERT INTO public.fuel_assignments (
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


CREATE OR REPLACE FUNCTION public.update_invoice_item_with_effects(
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
  v_product_company_id uuid;
  a jsonb;
BEGIN
  SELECT i.company_id
  INTO v_company_id
  FROM public.invoice_items ii
  JOIN public.invoices i ON ii.invoice_id = i.id
  WHERE ii.id = p_invoice_item_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Ítem no encontrado';
  END IF;

  IF NOT public.is_admin_or_editor(v_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT p.company_id INTO v_product_company_id
    FROM public.products p
    WHERE p.id = p_product_id;

    IF v_product_company_id IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    IF v_product_company_id <> v_company_id THEN
      RAISE EXCEPTION 'Producto no pertenece a la compañía de la factura';
    END IF;
  END IF;

  IF p_recalc_inventory THEN
    SELECT ii.product_id, ii.quantity
    INTO v_old_product_id, v_old_quantity
    FROM public.invoice_items ii
    WHERE ii.id = p_invoice_item_id;

    IF v_old_product_id IS NOT NULL AND v_old_quantity IS NOT NULL THEN
      PERFORM public.reverse_inventory_movement(v_old_product_id, v_old_quantity);
    END IF;
  END IF;

  UPDATE public.invoice_items
  SET
    product_id = p_product_id,
    quantity = p_quantity,
    unit_price = p_unit_price,
    total_price = p_total_price,
    category = p_category
  WHERE id = p_invoice_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ítem no encontrado';
  END IF;

  IF p_recalc_inventory AND p_product_id IS NOT NULL THEN
    PERFORM public.update_inventory_with_average_cost(p_product_id, p_quantity, p_unit_price, p_invoice_item_id);
  END IF;

  IF p_replace_assignments THEN
    DELETE FROM public.labor_assignments WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM public.irrigation_assignments WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM public.machinery_assignments WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM public.general_costs WHERE invoice_item_id = p_invoice_item_id;
    DELETE FROM public.fuel_assignments WHERE invoice_item_id = p_invoice_item_id;

    FOR a IN SELECT * FROM jsonb_array_elements(p_labor_assignments) LOOP
      INSERT INTO public.labor_assignments (
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
      INSERT INTO public.irrigation_assignments (
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
      INSERT INTO public.machinery_assignments (
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
        INSERT INTO public.general_costs (
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
        INSERT INTO public.fuel_assignments (
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


CREATE OR REPLACE FUNCTION public.delete_invoice_items_with_effects(
  p_invoice_item_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_quantity numeric;
  v_company_id uuid;
  v_product_company_id uuid;
BEGIN
  IF p_invoice_item_ids IS NULL OR array_length(p_invoice_item_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY p_invoice_item_ids LOOP
    SELECT ii.product_id, ii.quantity, i.company_id
    INTO v_product_id, v_quantity, v_company_id
    FROM public.invoice_items ii
    JOIN public.invoices i ON ii.invoice_id = i.id
    WHERE ii.id = v_id;

    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'Ítem no encontrado';
    END IF;

    IF NOT public.is_admin_or_editor(v_company_id) THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;

    IF v_product_id IS NOT NULL THEN
      SELECT p.company_id INTO v_product_company_id
      FROM public.products p
      WHERE p.id = v_product_id;

      IF v_product_company_id IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado';
      END IF;

      IF v_product_company_id <> v_company_id THEN
        RAISE EXCEPTION 'Producto no pertenece a la compañía de la factura';
      END IF;
    END IF;

    IF v_product_id IS NOT NULL AND v_quantity IS NOT NULL THEN
      PERFORM public.reverse_inventory_movement(v_product_id, v_quantity);
    END IF;

    DELETE FROM public.fuel_assignments WHERE invoice_item_id = v_id;
    DELETE FROM public.irrigation_assignments WHERE invoice_item_id = v_id;
    DELETE FROM public.machinery_assignments WHERE invoice_item_id = v_id;
    DELETE FROM public.labor_assignments WHERE invoice_item_id = v_id;
    DELETE FROM public.general_costs WHERE invoice_item_id = v_id;

    DELETE FROM public.invoice_items WHERE id = v_id;
  END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION public.upsert_invoice_header(
  p_invoice_id uuid DEFAULT NULL,
  p_company_id uuid,
  p_invoice_number text,
  p_supplier text,
  p_supplier_rut text DEFAULT NULL,
  p_invoice_date date,
  p_due_date date DEFAULT NULL,
  p_status text DEFAULT 'Pendiente',
  p_notes text DEFAULT NULL,
  p_document_type text DEFAULT 'Factura',
  p_tax_percentage numeric DEFAULT 19,
  p_discount_amount numeric DEFAULT 0,
  p_exempt_amount numeric DEFAULT 0,
  p_special_tax_amount numeric DEFAULT 0,
  p_total_amount numeric DEFAULT 0,
  p_payment_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_tax numeric;
  v_supplier text;
  v_invoice_number text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id requerido';
  END IF;

  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_supplier := btrim(COALESCE(p_supplier, ''));
  v_invoice_number := btrim(COALESCE(p_invoice_number, ''));

  IF v_supplier = '' OR v_invoice_number = '' THEN
    RAISE EXCEPTION 'supplier e invoice_number requeridos';
  END IF;

  IF p_document_type ILIKE '%exenta%' THEN
    v_tax := 0;
  ELSE
    v_tax := COALESCE(p_tax_percentage, 19);
  END IF;

  IF p_invoice_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.company_id = p_company_id
      AND i.invoice_number = v_invoice_number
      AND lower(i.supplier) = lower(v_supplier)
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_INVOICE';
    END IF;

    INSERT INTO public.invoices (
      company_id,
      invoice_number,
      supplier,
      supplier_rut,
      invoice_date,
      due_date,
      status,
      notes,
      document_type,
      tax_percentage,
      discount_amount,
      exempt_amount,
      special_tax_amount,
      total_amount,
      payment_date,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      v_invoice_number,
      v_supplier,
      NULLIF(btrim(COALESCE(p_supplier_rut, '')), ''),
      p_invoice_date,
      p_due_date,
      COALESCE(p_status, 'Pendiente'),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      COALESCE(p_document_type, 'Factura'),
      v_tax,
      COALESCE(p_discount_amount, 0),
      COALESCE(p_exempt_amount, 0),
      COALESCE(p_special_tax_amount, 0),
      COALESCE(p_total_amount, 0),
      p_payment_date,
      now(),
      now()
    ) RETURNING id INTO v_invoice_id;

    RETURN v_invoice_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.company_id = p_company_id
    AND i.invoice_number = v_invoice_number
    AND lower(i.supplier) = lower(v_supplier)
    AND i.id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_INVOICE';
  END IF;

  UPDATE public.invoices
  SET
    invoice_number = v_invoice_number,
    supplier = v_supplier,
    supplier_rut = NULLIF(btrim(COALESCE(p_supplier_rut, '')), ''),
    invoice_date = p_invoice_date,
    due_date = p_due_date,
    status = COALESCE(p_status, status),
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    document_type = COALESCE(p_document_type, document_type),
    tax_percentage = v_tax,
    discount_amount = COALESCE(p_discount_amount, 0),
    exempt_amount = COALESCE(p_exempt_amount, 0),
    special_tax_amount = COALESCE(p_special_tax_amount, 0),
    total_amount = COALESCE(p_total_amount, 0),
    payment_date = p_payment_date,
    updated_at = now()
  WHERE id = p_invoice_id
  AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada o no pertenece a la compañía';
  END IF;

  RETURN p_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_item_with_effects(
  uuid, uuid, numeric, numeric, numeric, text, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_item_with_effects(
  uuid, uuid, numeric, numeric, numeric, text, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_invoice_item_with_effects(
  uuid, uuid, numeric, numeric, numeric, text, boolean, boolean, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_invoice_item_with_effects(
  uuid, uuid, numeric, numeric, numeric, text, boolean, boolean, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_invoice_items_with_effects(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_invoice_items_with_effects(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_invoice_header(
  uuid, uuid, text, text, text, date, date, text, text, text,
  numeric, numeric, numeric, numeric, numeric, date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_invoice_header(
  uuid, uuid, text, text, text, date, date, text, text, text,
  numeric, numeric, numeric, numeric, numeric, date
) TO authenticated;

