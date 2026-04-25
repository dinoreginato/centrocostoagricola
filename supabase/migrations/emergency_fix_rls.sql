-- Emergency Fix: Simplify RLS to absolute minimum to verify write access
-- We will rely on the application sending the correct company_id, which is safe enough for this context as company_id is verified by the app logic and subsequent reads.

DROP POLICY IF EXISTS "production_records_access_v2" ON production_records;
DROP POLICY IF EXISTS "production_records_company_policy" ON production_records;
DROP POLICY IF EXISTS "Users can view production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON production_records;
DROP POLICY IF EXISTS "policy_read_production_records" ON production_records;
DROP POLICY IF EXISTS "policy_write_production_records" ON production_records;
DROP POLICY IF EXISTS "production_records_open_access" ON production_records;

ALTER TABLE production_records ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

UPDATE production_records pr
SET company_id = f.company_id
FROM sectors s
JOIN fields f ON s.field_id = f.id
WHERE pr.sector_id = s.id
AND pr.company_id IS NULL;

CREATE POLICY "policy_read_production_records" ON production_records FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_production_records" ON production_records FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));
