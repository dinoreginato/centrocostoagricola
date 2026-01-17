
-- Update Invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pendiente';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT 'Factura';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_percentage DECIMAL(5,2) DEFAULT 19.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exempt_amount DECIMAL(10,2) DEFAULT 0;

-- Update Invoice Items table to include category
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS category VARCHAR(100);

-- Create Company Members table for RBAC
CREATE TABLE IF NOT EXISTS company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES auth.users(id),
  role VARCHAR(50) CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON company_members TO authenticated;
