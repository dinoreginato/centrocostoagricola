-- Optimize RLS for applications to avoid potential recursion or permission issues with joined tables.
-- We use a SECURITY DEFINER function to check access via the field -> company link without triggering RLS on fields table.

-- 1. Helper function to check application access via field_id
CREATE OR REPLACE FUNCTION can_access_field_data(target_field_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  target_company_id uuid;
BEGIN
  -- Get company_id from fields table directly (bypassing RLS due to SECURITY DEFINER)
  SELECT company_id INTO target_company_id 
  FROM fields 
  WHERE id = target_field_id;
  
  -- Check if user has access to this company
  -- We use the previously defined safe function
  RETURN has_company_access(target_company_id);
END;
$$;

-- 2. Update Applications Policy
DROP POLICY IF EXISTS "Users can view applications" ON applications;

CREATE POLICY "Users can view applications" ON applications
  FOR SELECT USING (
    can_access_field_data(field_id)
  );

-- 3. Update Application Items Policy
DROP POLICY IF EXISTS "Users can view application items" ON application_items;

CREATE POLICY "Users can view application items" ON application_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications 
      WHERE applications.id = application_items.application_id 
      AND can_access_field_data(applications.field_id)
    )
  );
