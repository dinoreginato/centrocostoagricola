-- Create a secure function to check company membership bypassing RLS
CREATE OR REPLACE FUNCTION public.is_company_member(target_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (admin)
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM company_members 
    WHERE company_id = target_company_id 
    AND user_id = auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;

-- Drop previous policies
DROP POLICY IF EXISTS "production_records_company_policy" ON production_records;
DROP POLICY IF EXISTS "Users can view production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON production_records;

-- Create new policy using the secure function
CREATE POLICY "production_records_access_v2" ON production_records
  FOR ALL
  USING ( is_company_member(company_id) )
  WITH CHECK ( is_company_member(company_id) );
