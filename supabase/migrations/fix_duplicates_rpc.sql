-- Create a function to clean duplicate items in a specific invoice
CREATE OR REPLACE FUNCTION clean_invoice_duplicates(target_invoice_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    first_id UUID;
BEGIN
    -- Loop through each unique product/price combination in the invoice
    FOR r IN 
        SELECT product_id, unit_price, COUNT(*) as cnt
        FROM invoice_items 
        WHERE invoice_id = target_invoice_id
        GROUP BY product_id, unit_price
        HAVING COUNT(*) > 1
    LOOP
        -- Get the ID of the first occurrence (to keep)
        SELECT id INTO first_id
        FROM invoice_items
        WHERE invoice_id = target_invoice_id 
        AND product_id = r.product_id 
        AND unit_price = r.unit_price
        ORDER BY created_at ASC, id ASC
        LIMIT 1;

        -- Delete all other occurrences
        DELETE FROM invoice_items
        WHERE invoice_id = target_invoice_id 
        AND product_id = r.product_id 
        AND unit_price = r.unit_price
        AND id != first_id;
        
        -- Note: We are NOT reversing inventory here because the duplicates were likely
        -- created by a UI bug that re-inserted items without deleting old ones,
        -- so the stock might have been added multiple times OR the bug was in the display.
        -- If stock is corrupt, we recommend a full stock reset or manual adjustment.
        -- This function strictly fixes the INVOICE DISPLAY.
    END LOOP;
END;
$$;
