-- Create table for assigning labor costs to sectors
CREATE TABLE labor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES sectors(id) ON DELETE CASCADE,
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE labor_assignments ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view labor assignments for their company" ON labor_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND i.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );

CREATE POLICY "Users can insert labor assignments for their company" ON labor_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND i.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );

CREATE POLICY "Users can update labor assignments for their company" ON labor_assignments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND i.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );

CREATE POLICY "Users can delete labor assignments for their company" ON labor_assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.id = labor_assignments.invoice_item_id
      AND i.company_id = (SELECT company_id FROM company_members WHERE user_id = auth.uid() LIMIT 1)
    )
  );
