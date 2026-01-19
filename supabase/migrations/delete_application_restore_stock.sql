-- Function to delete an application and restore the stock of used products
CREATE OR REPLACE FUNCTION delete_application_and_restore_stock(target_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item RECORD;
BEGIN
    -- Loop through items of the application to restore stock
    FOR item IN SELECT product_id, quantity_used FROM application_items WHERE application_id = target_application_id LOOP
        UPDATE products
        SET current_stock = current_stock + item.quantity_used,
            updated_at = now()
        WHERE id = item.product_id;
    END LOOP;

    -- Delete the application (Cascade constraints should handle application_items, but we delete to be safe/explicit if needed)
    -- Assuming ON DELETE CASCADE is set on foreign keys, deleting parent is enough. 
    -- If not, we delete items first.
    DELETE FROM application_items WHERE application_id = target_application_id;
    DELETE FROM applications WHERE id = target_application_id;
END;
$$;
