-- Function to delete ABSOLUTELY ALL applications and restore stock
-- Use with caution!

CREATE OR REPLACE FUNCTION force_clean_all_applications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    app_record RECORD;
    item_record RECORD;
BEGIN
    -- 1. Loop through ALL applications
    FOR app_record IN SELECT id FROM applications LOOP
        
        -- 2. Restore stock
        FOR item_record IN SELECT product_id, quantity_used FROM application_items WHERE application_id = app_record.id LOOP
            UPDATE products
            SET current_stock = current_stock + item_record.quantity_used,
                updated_at = now()
            WHERE id = item_record.product_id;
        END LOOP;

        -- 3. Delete linked inventory movements
        DELETE FROM inventory_movements 
        WHERE application_item_id IN (SELECT id FROM application_items WHERE application_id = app_record.id);

    END LOOP;

    -- 4. Delete ALL applications (cascade deletes items)
    DELETE FROM applications;

END;
$$;
