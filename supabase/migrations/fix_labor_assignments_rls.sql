-- Fix RLS policies for labor_assignments to support users with multiple companies correctly

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can insert labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can update labor assignments for their company" ON labor_assignments;
DROP POLICY IF EXISTS "Users can delete labor assignments for their company" ON labor_assignments;

-- Re-create policies with corrected logic

-- SELECT: User can view if they are a member of the company that owns the invoice_item
CREATE POLICY "Users can view labor assignments for their company" ON labor_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND EXISTS (
        SELECT 1 FROM company_members cm 
        WHERE cm.user_id = auth.uid() 
        AND cm.company_id = i.company_id
      )
    )
  );

-- INSERT: User can insert if they are a member of the company that owns the invoice_item
CREATE POLICY "Users can insert labor assignments for their company" ON labor_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND EXISTS (
        SELECT 1 FROM company_members cm 
        WHERE cm.user_id = auth.uid() 
        AND cm.company_id = i.company_id
      )
    )
  );

-- UPDATE: User can update if they are a member of the company that owns the invoice_item
CREATE POLICY "Users can update labor assignments for their company" ON labor_assignments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND EXISTS (
        SELECT 1 FROM company_members cm 
        WHERE cm.user_id = auth.uid() 
        AND cm.company_id = i.company_id
      )
    )
  );

-- DELETE: User can delete if they are a member of the company that owns the invoice_item
CREATE POLICY "Users can delete labor assignments for their company" ON labor_assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND EXISTS (
        SELECT 1 FROM company_members cm 
        WHERE cm.user_id = auth.uid() 
        AND cm.company_id = i.company_id
      )
    )
  );
