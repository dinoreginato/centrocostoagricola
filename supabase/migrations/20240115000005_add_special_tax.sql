
-- Add Special Tax column to Invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS special_tax_amount DECIMAL(10,2) DEFAULT 0;
