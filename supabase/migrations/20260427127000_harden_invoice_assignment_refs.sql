ALTER TABLE public.labor_assignments
ADD COLUMN IF NOT EXISTS worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL;

ALTER TABLE public.irrigation_assignments
ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.machinery_assignments
ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL;

ALTER TABLE public.machinery_assignments
ADD COLUMN IF NOT EXISTS notes text;

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
  v_sector_id uuid;
  v_machine_id uuid;
  v_worker_id uuid;
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
    v_sector_id := (a->>'sector_id')::uuid;
    v_worker_id := NULLIF((a->>'worker_id')::text, '')::uuid;

    IF NOT EXISTS (
      SELECT 1
      FROM public.sectors s
      JOIN public.fields f ON s.field_id = f.id
      WHERE s.id = v_sector_id
        AND f.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
    END IF;

    IF v_worker_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.workers w
      WHERE w.id = v_worker_id
        AND w.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Trabajador no pertenece a la compañía de la factura';
    END IF;

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
      v_sector_id,
      (a->>'assigned_amount')::numeric,
      (a->>'assigned_date')::date,
      (a->>'labor_type')::text,
      v_worker_id,
      NULLIF((a->>'notes')::text, '')
    );
  END LOOP;

  FOR a IN SELECT * FROM jsonb_array_elements(p_irrigation_assignments) LOOP
    v_sector_id := (a->>'sector_id')::uuid;

    IF NOT EXISTS (
      SELECT 1
      FROM public.sectors s
      JOIN public.fields f ON s.field_id = f.id
      WHERE s.id = v_sector_id
        AND f.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
    END IF;

    INSERT INTO public.irrigation_assignments (
      invoice_item_id,
      sector_id,
      assigned_amount,
      assigned_date,
      notes
    ) VALUES (
      v_invoice_item_id,
      v_sector_id,
      (a->>'assigned_amount')::numeric,
      (a->>'assigned_date')::date,
      NULLIF((a->>'notes')::text, '')
    );
  END LOOP;

  FOR a IN SELECT * FROM jsonb_array_elements(p_machinery_assignments) LOOP
    v_sector_id := NULLIF((a->>'sector_id')::text, '')::uuid;
    v_machine_id := NULLIF((a->>'machine_id')::text, '')::uuid;

    IF v_sector_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.sectors s
      JOIN public.fields f ON s.field_id = f.id
      WHERE s.id = v_sector_id
        AND f.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
    END IF;

    IF v_machine_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = v_machine_id
        AND m.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Máquina no pertenece a la compañía de la factura';
    END IF;

    INSERT INTO public.machinery_assignments (
      invoice_item_id,
      sector_id,
      machine_id,
      assigned_amount,
      assigned_date,
      notes
    ) VALUES (
      v_invoice_item_id,
      v_sector_id,
      v_machine_id,
      (a->>'assigned_amount')::numeric,
      (a->>'assigned_date')::date,
      NULLIF((a->>'notes')::text, '')
    );
  END LOOP;

  IF v_company_id IS NOT NULL THEN
    FOR a IN SELECT * FROM jsonb_array_elements(p_general_costs) LOOP
      v_sector_id := (a->>'sector_id')::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

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
        v_sector_id,
        (a->>'amount')::numeric,
        (a->>'date')::date,
        (a->>'category')::text,
        (a->>'description')::text
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_fuel_assignments) LOOP
      v_sector_id := (a->>'sector_id')::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

      INSERT INTO public.fuel_assignments (
        invoice_item_id,
        sector_id,
        assigned_amount,
        assigned_date
      ) VALUES (
        v_invoice_item_id,
        v_sector_id,
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
  v_sector_id uuid;
  v_machine_id uuid;
  v_worker_id uuid;
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
      v_sector_id := (a->>'sector_id')::uuid;
      v_worker_id := NULLIF((a->>'worker_id')::text, '')::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

      IF v_worker_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.workers w
        WHERE w.id = v_worker_id
          AND w.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Trabajador no pertenece a la compañía de la factura';
      END IF;

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
        v_sector_id,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date,
        (a->>'labor_type')::text,
        v_worker_id,
        NULLIF((a->>'notes')::text, '')
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_irrigation_assignments) LOOP
      v_sector_id := (a->>'sector_id')::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

      INSERT INTO public.irrigation_assignments (
        invoice_item_id,
        sector_id,
        assigned_amount,
        assigned_date,
        notes
      ) VALUES (
        p_invoice_item_id,
        v_sector_id,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date,
        NULLIF((a->>'notes')::text, '')
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_machinery_assignments) LOOP
      v_sector_id := NULLIF((a->>'sector_id')::text, '')::uuid;
      v_machine_id := NULLIF((a->>'machine_id')::text, '')::uuid;

      IF v_sector_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

      IF v_machine_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.machines m
        WHERE m.id = v_machine_id
          AND m.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Máquina no pertenece a la compañía de la factura';
      END IF;

      INSERT INTO public.machinery_assignments (
        invoice_item_id,
        sector_id,
        machine_id,
        assigned_amount,
        assigned_date,
        notes
      ) VALUES (
        p_invoice_item_id,
        v_sector_id,
        v_machine_id,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date,
        NULLIF((a->>'notes')::text, '')
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_general_costs) LOOP
      v_sector_id := (a->>'sector_id')::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

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
        v_sector_id,
        (a->>'amount')::numeric,
        (a->>'date')::date,
        (a->>'category')::text,
        (a->>'description')::text
      );
    END LOOP;

    FOR a IN SELECT * FROM jsonb_array_elements(p_fuel_assignments) LOOP
      v_sector_id := (a->>'sector_id')::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.sectors s
        JOIN public.fields f ON s.field_id = f.id
        WHERE s.id = v_sector_id
          AND f.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Sector no pertenece a la compañía de la factura';
      END IF;

      INSERT INTO public.fuel_assignments (
        invoice_item_id,
        sector_id,
        assigned_amount,
        assigned_date
      ) VALUES (
        p_invoice_item_id,
        v_sector_id,
        (a->>'assigned_amount')::numeric,
        (a->>'assigned_date')::date
      );
    END LOOP;
  END IF;
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

