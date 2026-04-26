-- Function to delete ALL applications for a company and restore stock
-- Note: In a real multi-tenant app, we should pass company_id. 
-- But here we assume we want to delete all visible applications for simplicity or filtered by company logic if needed.
-- For now, let's make it accept a company_id to be safe.

CREATE OR REPLACE FUNCTION public.delete_all_applications_restore_stock(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    app_record RECORD;
    item_record RECORD;
BEGIN
    IF NOT public.is_admin_or_editor(target_company_id) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;
    -- 1. Loop through all applications for the target company (via fields)
    FOR app_record IN 
        SELECT a.id 
        FROM applications a
        JOIN fields f ON a.field_id = f.id
        WHERE f.company_id = target_company_id
    LOOP
        -- 2. For each application, restore stock for its items
        FOR item_record IN SELECT product_id, quantity_used FROM application_items WHERE application_id = app_record.id LOOP
            UPDATE products
            SET current_stock = current_stock + item_record.quantity_used,
                updated_at = now()
            WHERE id = item_record.product_id;
        END LOOP;

        -- 3. Delete inventory movements related to this application (if linked)
        -- (If cascade is set on application_items, this might happen automatically, but inventory_movements 
        -- might not be cascaded if they are just linked. We should delete 'salida' movements linked to these items)
        -- We added 'application_item_id' column recently. If populated, we can delete by it.
        DELETE FROM inventory_movements 
        WHERE application_item_id IN (SELECT id FROM application_items WHERE application_id = app_record.id);

    END LOOP;

    -- 4. Delete all applications for the company
    -- We need to delete them. The items will cascade delete.
    DELETE FROM applications 
    WHERE id IN (
        SELECT a.id 
        FROM applications a
        JOIN fields f ON a.field_id = f.id
        WHERE f.company_id = target_company_id
    );

END;
$$;

REVOKE ALL ON FUNCTION public.delete_all_applications_restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_all_applications_restore_stock(uuid) TO authenticated;
