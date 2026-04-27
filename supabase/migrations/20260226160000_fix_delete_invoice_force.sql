
CREATE OR REPLACE FUNCTION public.delete_invoice_force(target_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_ids uuid[];
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.invoices WHERE id = target_invoice_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
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

  SELECT array_agg(id)
  INTO v_item_ids
  FROM public.invoice_items
  WHERE invoice_id = target_invoice_id;

  IF to_regclass('public.machinery_assignments') IS NOT NULL THEN
    DELETE FROM public.machinery_assignments
    WHERE invoice_item_id = ANY(COALESCE(v_item_ids, ARRAY[]::uuid[]));
  END IF;

  IF to_regclass('public.labor_assignments') IS NOT NULL THEN
    DELETE FROM public.labor_assignments
    WHERE invoice_item_id = ANY(COALESCE(v_item_ids, ARRAY[]::uuid[]));
  END IF;

  IF to_regclass('public.irrigation_assignments') IS NOT NULL THEN
    DELETE FROM public.irrigation_assignments
    WHERE invoice_item_id = ANY(COALESCE(v_item_ids, ARRAY[]::uuid[]));
  END IF;

  IF to_regclass('public.fuel_assignments') IS NOT NULL THEN
    DELETE FROM public.fuel_assignments
    WHERE invoice_item_id = ANY(COALESCE(v_item_ids, ARRAY[]::uuid[]));
  END IF;

  -- 2. Delete associated general costs distributions
  IF to_regclass('public.general_costs') IS NOT NULL THEN
      DELETE FROM public.general_costs 
      WHERE invoice_item_id = ANY(COALESCE(v_item_ids, ARRAY[]::uuid[]));
  END IF;

  -- 3. Delete invoice items
  IF to_regprocedure('public.delete_invoice_items_with_effects(uuid[])') IS NOT NULL AND v_item_ids IS NOT NULL THEN
    PERFORM public.delete_invoice_items_with_effects(v_item_ids);
  ELSE
    DELETE FROM public.invoice_items WHERE invoice_id = target_invoice_id;
  END IF;

  -- 4. Delete the invoice itself
  DELETE FROM public.invoices WHERE id = target_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_invoice_force(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_invoice_force(uuid) TO authenticated;
