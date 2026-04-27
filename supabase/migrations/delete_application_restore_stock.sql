-- Function to delete an application and restore the stock of used products
CREATE OR REPLACE FUNCTION public.delete_application_and_restore_stock(target_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    item RECORD;
    v_company_id uuid;
BEGIN
    SELECT f.company_id
    INTO v_company_id
    FROM public.applications a
    JOIN public.fields f ON a.field_id = f.id
    WHERE a.id = target_application_id;

    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'Aplicación no encontrada';
    END IF;

    IF NOT public.is_admin_or_editor(v_company_id) THEN
      RAISE EXCEPTION 'No autorizado';
    END IF;

    -- Loop through items of the application to restore stock
    FOR item IN SELECT id, product_id, quantity_used FROM public.application_items WHERE application_id = target_application_id LOOP
        UPDATE public.products
        SET current_stock = current_stock + item.quantity_used,
            updated_at = now()
        WHERE id = item.product_id;

        DELETE FROM public.inventory_movements
        WHERE application_item_id = item.id;
    END LOOP;

    -- Delete the application (Cascade constraints should handle application_items, but we delete to be safe/explicit if needed)
    -- Assuming ON DELETE CASCADE is set on foreign keys, deleting parent is enough. 
    -- If not, we delete items first.
    DELETE FROM public.application_items WHERE application_id = target_application_id;
    DELETE FROM public.applications WHERE id = target_application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_application_and_restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_application_and_restore_stock(uuid) TO authenticated;
