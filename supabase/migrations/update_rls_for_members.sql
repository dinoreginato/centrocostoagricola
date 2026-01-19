-- Fix RLS policies to allow company members to access data tables
-- Previously, only owners could access data. Now we extend this to members.

-- 1. Helper function to check if user has access to a company (Owner or Member)
-- We reuse get_auth_user_company_ids() which returns company IDs the user belongs to.
-- If it doesn't exist, we recreate it safely.

CREATE OR REPLACE FUNCTION get_auth_user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

-- Helper to check if user is editor or admin
CREATE OR REPLACE FUNCTION is_editor_or_admin(cmp_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members 
    WHERE company_id = cmp_id 
    AND user_id = auth.uid() 
    AND role IN ('admin', 'editor')
  ) OR EXISTS (
    SELECT 1 FROM companies 
    WHERE id = cmp_id 
    AND owner_id = auth.uid()
  );
$$;

-- Helper to check if user is member (any role) or owner
CREATE OR REPLACE FUNCTION has_company_access(cmp_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members 
    WHERE company_id = cmp_id 
    AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM companies 
    WHERE id = cmp_id 
    AND owner_id = auth.uid()
  );
$$;


-- ==========================================
-- FIELDS
-- ==========================================
DROP POLICY IF EXISTS "Users can view fields of their companies" ON fields;
DROP POLICY IF EXISTS "Users can insert fields to their companies" ON fields;
DROP POLICY IF EXISTS "Users can update fields of their companies" ON fields;

CREATE POLICY "Users can view fields" ON fields
  FOR SELECT USING (has_company_access(company_id));

CREATE POLICY "Admins/Editors can insert fields" ON fields
  FOR INSERT WITH CHECK (is_editor_or_admin(company_id));

CREATE POLICY "Admins/Editors can update fields" ON fields
  FOR UPDATE USING (is_editor_or_admin(company_id));

CREATE POLICY "Admins/Editors can delete fields" ON fields
  FOR DELETE USING (is_editor_or_admin(company_id));


-- ==========================================
-- SECTORS
-- ==========================================
DROP POLICY IF EXISTS "Users can view sectors of their fields" ON sectors;
DROP POLICY IF EXISTS "Users can insert sectors to their fields" ON sectors;

CREATE POLICY "Users can view sectors" ON sectors
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = sectors.field_id AND has_company_access(fields.company_id))
  );

CREATE POLICY "Admins/Editors can insert sectors" ON sectors
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = sectors.field_id AND is_editor_or_admin(fields.company_id))
  );

CREATE POLICY "Admins/Editors can update sectors" ON sectors
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = sectors.field_id AND is_editor_or_admin(fields.company_id))
  );

CREATE POLICY "Admins/Editors can delete sectors" ON sectors
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = sectors.field_id AND is_editor_or_admin(fields.company_id))
  );


-- ==========================================
-- PRODUCTS
-- ==========================================
DROP POLICY IF EXISTS "Users can view products of their companies" ON products;
DROP POLICY IF EXISTS "Users can insert products to their companies" ON products;
DROP POLICY IF EXISTS "Users can update products of their companies" ON products;

CREATE POLICY "Users can view products" ON products
  FOR SELECT USING (has_company_access(company_id));

CREATE POLICY "Admins/Editors can insert products" ON products
  FOR INSERT WITH CHECK (is_editor_or_admin(company_id));

CREATE POLICY "Admins/Editors can update products" ON products
  FOR UPDATE USING (is_editor_or_admin(company_id));

CREATE POLICY "Admins/Editors can delete products" ON products
  FOR DELETE USING (is_editor_or_admin(company_id));


-- ==========================================
-- INVOICES
-- ==========================================
DROP POLICY IF EXISTS "Users can view invoices of their companies" ON invoices;
DROP POLICY IF EXISTS "Users can insert invoices to their companies" ON invoices;

CREATE POLICY "Users can view invoices" ON invoices
  FOR SELECT USING (has_company_access(company_id));

CREATE POLICY "Admins/Editors can insert invoices" ON invoices
  FOR INSERT WITH CHECK (is_editor_or_admin(company_id));

CREATE POLICY "Admins/Editors can update invoices" ON invoices
  FOR UPDATE USING (is_editor_or_admin(company_id));

CREATE POLICY "Admins/Editors can delete invoices" ON invoices
  FOR DELETE USING (is_editor_or_admin(company_id));


-- ==========================================
-- INVOICE ITEMS
-- ==========================================
DROP POLICY IF EXISTS "Users can view invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Users can insert invoice items" ON invoice_items;

CREATE POLICY "Users can view invoice items" ON invoice_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_items.invoice_id AND has_company_access(invoices.company_id))
  );

CREATE POLICY "Admins/Editors can insert invoice items" ON invoice_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_items.invoice_id AND is_editor_or_admin(invoices.company_id))
  );

CREATE POLICY "Admins/Editors can update invoice items" ON invoice_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_items.invoice_id AND is_editor_or_admin(invoices.company_id))
  );

CREATE POLICY "Admins/Editors can delete invoice items" ON invoice_items
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_items.invoice_id AND is_editor_or_admin(invoices.company_id))
  );


-- ==========================================
-- INVENTORY MOVEMENTS
-- ==========================================
DROP POLICY IF EXISTS "Users can view inventory movements" ON inventory_movements;

CREATE POLICY "Users can view inventory movements" ON inventory_movements
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM products WHERE products.id = inventory_movements.product_id AND has_company_access(products.company_id))
  );

CREATE POLICY "Admins/Editors can insert inventory movements" ON inventory_movements
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM products WHERE products.id = inventory_movements.product_id AND is_editor_or_admin(products.company_id))
  );

CREATE POLICY "Admins/Editors can update inventory movements" ON inventory_movements
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM products WHERE products.id = inventory_movements.product_id AND is_editor_or_admin(products.company_id))
  );

CREATE POLICY "Admins/Editors can delete inventory movements" ON inventory_movements
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM products WHERE products.id = inventory_movements.product_id AND is_editor_or_admin(products.company_id))
  );


-- ==========================================
-- APPLICATIONS
-- ==========================================
DROP POLICY IF EXISTS "Users can view applications" ON applications;
DROP POLICY IF EXISTS "Users can insert applications" ON applications;

CREATE POLICY "Users can view applications" ON applications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = applications.field_id AND has_company_access(fields.company_id))
  );

CREATE POLICY "Admins/Editors can insert applications" ON applications
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = applications.field_id AND is_editor_or_admin(fields.company_id))
  );

CREATE POLICY "Admins/Editors can update applications" ON applications
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = applications.field_id AND is_editor_or_admin(fields.company_id))
  );

CREATE POLICY "Admins/Editors can delete applications" ON applications
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM fields WHERE fields.id = applications.field_id AND is_editor_or_admin(fields.company_id))
  );


-- ==========================================
-- APPLICATION ITEMS
-- ==========================================
DROP POLICY IF EXISTS "Users can view application items" ON application_items;
DROP POLICY IF EXISTS "Users can insert application items" ON application_items;

CREATE POLICY "Users can view application items" ON application_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications 
      JOIN fields ON applications.field_id = fields.id
      WHERE applications.id = application_items.application_id 
      AND has_company_access(fields.company_id)
    )
  );

CREATE POLICY "Admins/Editors can insert application items" ON application_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications 
      JOIN fields ON applications.field_id = fields.id
      WHERE applications.id = application_items.application_id 
      AND is_editor_or_admin(fields.company_id)
    )
  );

CREATE POLICY "Admins/Editors can update application items" ON application_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM applications 
      JOIN fields ON applications.field_id = fields.id
      WHERE applications.id = application_items.application_id 
      AND is_editor_or_admin(fields.company_id)
    )
  );

CREATE POLICY "Admins/Editors can delete application items" ON application_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM applications 
      JOIN fields ON applications.field_id = fields.id
      WHERE applications.id = application_items.application_id 
      AND is_editor_or_admin(fields.company_id)
    )
  );
