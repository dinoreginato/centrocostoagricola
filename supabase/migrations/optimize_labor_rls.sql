-- Optimize RLS for labor_assignments by leveraging existing RLS on invoice_items
-- This avoids complex joins and potential RLS recursion or context issues

-- Drop previous policies and functions
DROP POLICY IF EXISTS "Users can view labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can insert labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can update labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can delete labor assignments for their company" ON labor_assignments;
DROP FUNCTION IF EXISTS check_labor_assignment_access;

-- Create a unified policy that relies on the visibility of the parent invoice_item
-- Since invoice_items has its own RLS ensuring users only see their company's items,
-- we can just check if the user can see the referenced invoice_item.

CREATE POLICY "Labor assignments access via invoice_item" ON labor_assignments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM invoice_items 
      WHERE id = labor_assignments.invoice_item_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoice_items 
      WHERE id = labor_assignments.invoice_item_id
    )
  );
