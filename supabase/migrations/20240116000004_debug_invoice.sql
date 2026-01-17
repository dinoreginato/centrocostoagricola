
-- Check for duplicates of the specific invoice
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id, invoice_number, created_at FROM invoices WHERE invoice_number LIKE '%6311449%' LOOP
        RAISE NOTICE 'Found Invoice: ID=%, Number=%, Created=%', r.id, r.invoice_number, r.created_at;
    END LOOP;
END $$;
