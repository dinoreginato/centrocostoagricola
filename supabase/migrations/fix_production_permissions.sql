-- Grant necessary permissions to authenticated users for the function and table
GRANT EXECUTE ON FUNCTION check_sector_access(uuid) TO authenticated;
GRANT ALL ON TABLE production_records TO authenticated;

-- Ensure RLS is enabled
ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;

-- Re-apply policies just to be sure
DROP POLICY IF EXISTS "Users can view production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON production_records;

CREATE POLICY "Users can view production records for their company" ON production_records
  FOR SELECT USING (check_sector_access(sector_id));

CREATE POLICY "Users can insert production records for their company" ON production_records
  FOR INSERT WITH CHECK (check_sector_access(sector_id));

CREATE POLICY "Users can update production records for their company" ON production_records
  FOR UPDATE USING (check_sector_access(sector_id));

CREATE POLICY "Users can delete production records for their company" ON production_records
  FOR DELETE USING (check_sector_access(sector_id));
