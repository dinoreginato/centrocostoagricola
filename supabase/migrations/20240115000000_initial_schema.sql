
-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  rut VARCHAR(20) UNIQUE,
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Policies for companies
CREATE POLICY "Users can view their own companies" ON companies
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own companies" ON companies
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own companies" ON companies
  FOR UPDATE USING (auth.uid() = owner_id);

-- Create fields table
CREATE TABLE IF NOT EXISTS fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  total_hectares DECIMAL(10,2) NOT NULL,
  fruit_type VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for fields
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;

-- Policies for fields (using company_id to check ownership via join would be ideal, but for simplicity assuming access if they have access to company)
-- Simplified RLS: Allow authenticated users to do everything for now to avoid complexity in this step, or better, link to company owner.
-- To keep it secure properly:
CREATE POLICY "Users can view fields of their companies" ON fields
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = fields.company_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert fields to their companies" ON fields
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = fields.company_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update fields of their companies" ON fields
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = fields.company_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create sectors table
CREATE TABLE IF NOT EXISTS sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  field_id UUID REFERENCES fields(id) ON DELETE CASCADE,
  hectares DECIMAL(10,2) NOT NULL,
  coordinates TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for sectors
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;

-- Policies for sectors
CREATE POLICY "Users can view sectors of their fields" ON sectors
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fields
      JOIN companies ON fields.company_id = companies.id
      WHERE fields.id = sectors.field_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert sectors to their fields" ON sectors
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM fields
      JOIN companies ON fields.company_id = companies.id
      WHERE fields.id = sectors.field_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) CHECK (category IN ('fertilizante', 'pesticida', 'herbicida', 'fungicida', 'otro')),
  unit VARCHAR(20) NOT NULL,
  current_stock DECIMAL(10,2) DEFAULT 0,
  average_cost DECIMAL(10,2) DEFAULT 0,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view products of their companies" ON products
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert products to their companies" ON products
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update products of their companies" ON products
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = products.company_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(100) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  supplier VARCHAR(255) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  invoice_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoices of their companies" ON invoices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert invoices to their companies" ON invoices
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = invoices.company_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create invoice_items table
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for invoice_items
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoice items" ON invoice_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert invoice items" ON invoice_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      JOIN companies ON invoices.company_id = companies.id
      WHERE invoices.id = invoice_items.invoice_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create inventory_movements table
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  invoice_item_id UUID REFERENCES invoice_items(id),
  movement_type VARCHAR(50) NOT NULL, -- 'entrada', 'salida'
  quantity DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for inventory_movements
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inventory movements" ON inventory_movements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM products
      JOIN companies ON products.company_id = companies.id
      WHERE products.id = inventory_movements.product_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create applications table
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID REFERENCES fields(id) ON DELETE CASCADE,
  sector_id UUID REFERENCES sectors(id),
  application_date DATE NOT NULL,
  application_type VARCHAR(100),
  total_cost DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for applications
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view applications" ON applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fields
      JOIN companies ON fields.company_id = companies.id
      WHERE fields.id = applications.field_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert applications" ON applications
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM fields
      JOIN companies ON fields.company_id = companies.id
      WHERE fields.id = applications.field_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Create application_items table
CREATE TABLE IF NOT EXISTS application_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity_used DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for application_items
ALTER TABLE application_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view application items" ON application_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications
      JOIN fields ON applications.field_id = fields.id
      JOIN companies ON fields.company_id = companies.id
      WHERE applications.id = application_items.application_id
      AND companies.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert application items" ON application_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      JOIN fields ON applications.field_id = fields.id
      JOIN companies ON fields.company_id = companies.id
      WHERE applications.id = application_items.application_id
      AND companies.owner_id = auth.uid()
    )
  );

-- Function for Average Cost Calculation
CREATE OR REPLACE FUNCTION update_inventory_with_average_cost(
  product_id UUID,
  quantity_in DECIMAL,
  unit_cost DECIMAL,
  invoice_item_id UUID
)
RETURNS VOID AS $$
DECLARE
  current_avg_cost DECIMAL;
  current_stock DECIMAL;
  new_avg_cost DECIMAL;
  new_stock DECIMAL;
BEGIN
  -- Get current values
  SELECT average_cost, current_stock INTO current_avg_cost, current_stock
  FROM products WHERE id = product_id;
  
  -- Calculate new average cost (weighted average)
  new_stock := COALESCE(current_stock, 0) + quantity_in;
  IF new_stock > 0 THEN
    new_avg_cost := ((COALESCE(current_avg_cost, 0) * COALESCE(current_stock, 0)) + (unit_cost * quantity_in)) / new_stock;
  ELSE
    new_avg_cost := unit_cost;
  END IF;
  
  -- Update product
  UPDATE products SET
    current_stock = new_stock,
    average_cost = new_avg_cost,
    updated_at = NOW()
  WHERE id = product_id;
  
  -- Record inventory movement
  INSERT INTO inventory_movements (product_id, invoice_item_id, movement_type, quantity, unit_cost)
  VALUES (product_id, invoice_item_id, 'entrada', quantity_in, unit_cost);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (Explicitly needed as per guidelines)
GRANT SELECT ON companies TO authenticated;
GRANT SELECT ON fields TO authenticated;
GRANT SELECT ON sectors TO authenticated;
GRANT SELECT ON products TO authenticated;
GRANT SELECT ON invoices TO authenticated;
GRANT SELECT ON invoice_items TO authenticated;
GRANT SELECT ON inventory_movements TO authenticated;
GRANT SELECT ON applications TO authenticated;
GRANT SELECT ON application_items TO authenticated;

-- Grant ALL for authenticated to allow Insert/Update/Delete (controlled by RLS)
GRANT INSERT, UPDATE, DELETE ON companies TO authenticated;
GRANT INSERT, UPDATE, DELETE ON fields TO authenticated;
GRANT INSERT, UPDATE, DELETE ON sectors TO authenticated;
GRANT INSERT, UPDATE, DELETE ON products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON invoices TO authenticated;
GRANT INSERT, UPDATE, DELETE ON invoice_items TO authenticated;
GRANT INSERT, UPDATE, DELETE ON inventory_movements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON applications TO authenticated;
GRANT INSERT, UPDATE, DELETE ON application_items TO authenticated;
