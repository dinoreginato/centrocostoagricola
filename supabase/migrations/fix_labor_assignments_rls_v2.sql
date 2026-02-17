-- Create a helper function to check access securely for labor assignments
-- This avoids RLS recursion issues by running as SECURITY DEFINER (system privileges)
CREATE OR REPLACE FUNCTION check_labor_assignment_access(target_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if the invoice item belongs to a company where the current user is a member
  RETURN EXISTS (
    SELECT 1
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    JOIN company_members cm ON i.company_id = cm.company_id
    WHERE ii.id = target_item_id
    AND cm.user_id = auth.uid()
  );
END;
$$;

-- Drop existing policies to be clean
DROP POLICY IF EXISTS "Users can view labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can insert labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can update labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can delete labor assignments for their company" ON labor_assignments;

-- Re-create policies using the secure function

-- SELECT
CREATE POLICY "Users can view labor assignments for their company" ON labor_assignments
  FOR SELECT USING (
    check_labor_assignment_access(invoice_item_id)
  );

-- INSERT
CREATE POLICY "Users can insert labor assignments for their company" ON labor_assignments
  FOR INSERT WITH CHECK (
    check_labor_assignment_access(invoice_item_id)
  );

-- UPDATE
CREATE POLICY "Users can update labor assignments for their company" ON labor_assignments
  FOR UPDATE USING (
    check_labor_assignment_access(invoice_item_id)
  );

-- DELETE
CREATE POLICY "Users can delete labor assignments for their company" ON labor_assignments
  FOR DELETE USING (
    check_labor_assignment_access(invoice_item_id)
  );
