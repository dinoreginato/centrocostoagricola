-- Add company_id to production_records to simplify RLS
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

-- Update existing records to have the correct company_id
UPDATE production_records pr
SET company_id = f.company_id
FROM sectors s
JOIN fields f ON s.field_id = f.id
WHERE pr.sector_id = s.id
AND pr.company_id IS NULL;

-- Drop complex policies
DROP POLICY IF EXISTS "Users can view production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON production_records;

-- Create simple, robust policy based on company_id
CREATE POLICY "production_records_company_policy" ON production_records
  FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM company_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_members WHERE user_id = auth.uid()
    )
  );
