-- Fix RLS policies for production_records to prevent recursion and handle multiple companies correctly

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON production_records;

-- Helper function to check access to sector (similar to what we did for labor assignments but for sectors)
CREATE OR REPLACE FUNCTION check_sector_access(target_sector_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM sectors s
    JOIN fields f ON s.field_id = f.id
    JOIN company_members cm ON f.company_id = cm.company_id
    WHERE s.id = target_sector_id
    AND cm.user_id = auth.uid()
  );
END;
$$;

-- Re-create policies using the secure function

-- SELECT
CREATE POLICY "Users can view production records for their company" ON production_records
  FOR SELECT USING (
    check_sector_access(sector_id)
  );

-- INSERT
CREATE POLICY "Users can insert production records for their company" ON production_records
  FOR INSERT WITH CHECK (
    check_sector_access(sector_id)
  );

-- UPDATE
CREATE POLICY "Users can update production records for their company" ON production_records
  FOR UPDATE USING (
    check_sector_access(sector_id)
  );

-- DELETE
CREATE POLICY "Users can delete production records for their company" ON production_records
  FOR DELETE USING (
    check_sector_access(sector_id)
  );
