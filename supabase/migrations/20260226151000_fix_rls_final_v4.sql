-- Function to get accessible company IDs (SECURITY DEFINER to break recursion)
CREATE OR REPLACE FUNCTION get_accessible_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    -- Companies owned by the user
    SELECT id FROM companies WHERE owner_id = auth.uid()
    UNION
    -- Companies where the user is a member
    SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

-- Revoke execution from public just in case, then grant to authenticated
REVOKE EXECUTE ON FUNCTION get_accessible_company_ids() FROM public;
GRANT EXECUTE ON FUNCTION get_accessible_company_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION get_accessible_company_ids() TO service_role;

-- 1. Reset policies for COMPANIES
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own companies" ON companies;
DROP POLICY IF EXISTS "Users can insert their own companies" ON companies;
DROP POLICY IF EXISTS "Users can update their own companies" ON companies;
DROP POLICY IF EXISTS "Users can delete their own companies" ON companies;
DROP POLICY IF EXISTS "Users can view companies they own" ON companies;
DROP POLICY IF EXISTS "Users can view companies they are members of" ON companies;
DROP POLICY IF EXISTS "Enable read access for owners and members" ON companies;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON companies;
DROP POLICY IF EXISTS "Enable update for owners and members" ON companies;
DROP POLICY IF EXISTS "Enable delete for owners" ON companies;
DROP POLICY IF EXISTS "Access companies" ON companies;

CREATE POLICY "Access companies"
ON companies
FOR ALL
TO authenticated
USING (
    id IN (SELECT get_accessible_company_ids())
    OR
    (owner_id = auth.uid()) -- Allow creating new companies
)
WITH CHECK (
    id IN (SELECT get_accessible_company_ids())
    OR
    (owner_id = auth.uid())
);

-- 2. Reset policies for COMPANY_MEMBERS
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view members of their companies" ON company_members;
DROP POLICY IF EXISTS "Owners can manage members" ON company_members;
DROP POLICY IF EXISTS "View members" ON company_members;
DROP POLICY IF EXISTS "Manage members" ON company_members;
DROP POLICY IF EXISTS "Access company_members" ON company_members;

CREATE POLICY "Access company_members"
ON company_members
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 3. Reset policies for MACHINES
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view machines of their companies" ON machines;
DROP POLICY IF EXISTS "Users can insert machines to their companies" ON machines;
DROP POLICY IF EXISTS "Users can update machines of their companies" ON machines;
DROP POLICY IF EXISTS "Users can delete machines of their companies" ON machines;
DROP POLICY IF EXISTS "View machines" ON machines;
DROP POLICY IF EXISTS "Manage machines" ON machines;
DROP POLICY IF EXISTS "Enable all access for company members" ON machines;
DROP POLICY IF EXISTS "Access machines" ON machines;

CREATE POLICY "Access machines"
ON machines
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 4. Reset policies for INCOME_ENTRIES
ALTER TABLE income_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view income entries of their companies" ON income_entries;
DROP POLICY IF EXISTS "Users can insert income entries to their companies" ON income_entries;
DROP POLICY IF EXISTS "Users can update income entries of their companies" ON income_entries;
DROP POLICY IF EXISTS "Users can delete income entries of their companies" ON income_entries;
DROP POLICY IF EXISTS "View income_entries" ON income_entries;
DROP POLICY IF EXISTS "Manage income_entries" ON income_entries;
DROP POLICY IF EXISTS "Enable all access for company members" ON income_entries;
DROP POLICY IF EXISTS "Access income_entries" ON income_entries;

CREATE POLICY "Access income_entries"
ON income_entries
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 5. Reset policies for PRODUCTION_RECORDS
ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view production records of their companies" ON production_records;
DROP POLICY IF EXISTS "Users can insert production records to their companies" ON production_records;
DROP POLICY IF EXISTS "Users can update production records of their companies" ON production_records;
DROP POLICY IF EXISTS "Users can delete production records of their companies" ON production_records;
DROP POLICY IF EXISTS "Access production_records" ON production_records;

CREATE POLICY "Access production_records"
ON production_records
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 6. Reset policies for INVOICES (instead of expenses)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view invoices of their companies" ON invoices;
DROP POLICY IF EXISTS "Users can insert invoices to their companies" ON invoices;
DROP POLICY IF EXISTS "Users can update invoices of their companies" ON invoices;
DROP POLICY IF EXISTS "Users can delete invoices of their companies" ON invoices;
DROP POLICY IF EXISTS "Access invoices" ON invoices;

CREATE POLICY "Access invoices"
ON invoices
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 7. Reset policies for WORKER_COSTS (instead of labor_costs)
ALTER TABLE worker_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view worker costs of their companies" ON worker_costs;
DROP POLICY IF EXISTS "Users can insert worker costs to their companies" ON worker_costs;
DROP POLICY IF EXISTS "Users can update worker costs of their companies" ON worker_costs;
DROP POLICY IF EXISTS "Users can delete worker costs of their companies" ON worker_costs;
DROP POLICY IF EXISTS "Access worker_costs" ON worker_costs;

CREATE POLICY "Access worker_costs"
ON worker_costs
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 8. Reset policies for FUEL_CONSUMPTION (instead of fuel_logs)
ALTER TABLE fuel_consumption ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view fuel consumption of their companies" ON fuel_consumption;
DROP POLICY IF EXISTS "Users can insert fuel consumption to their companies" ON fuel_consumption;
DROP POLICY IF EXISTS "Users can update fuel consumption of their companies" ON fuel_consumption;
DROP POLICY IF EXISTS "Users can delete fuel consumption of their companies" ON fuel_consumption;
DROP POLICY IF EXISTS "Access fuel_consumption" ON fuel_consumption;

CREATE POLICY "Access fuel_consumption"
ON fuel_consumption
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 9. Reset policies for WORKERS
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view workers of their companies" ON workers;
DROP POLICY IF EXISTS "Users can insert workers to their companies" ON workers;
DROP POLICY IF EXISTS "Users can update workers of their companies" ON workers;
DROP POLICY IF EXISTS "Users can delete workers of their companies" ON workers;
DROP POLICY IF EXISTS "Access workers" ON workers;

CREATE POLICY "Access workers"
ON workers
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 10. Reset policies for FIELDS
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view fields of their companies" ON fields;
DROP POLICY IF EXISTS "Users can insert fields to their companies" ON fields;
DROP POLICY IF EXISTS "Users can update fields of their companies" ON fields;
DROP POLICY IF EXISTS "Users can delete fields of their companies" ON fields;
DROP POLICY IF EXISTS "Access fields" ON fields;

CREATE POLICY "Access fields"
ON fields
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 11. Reset policies for PRODUCTS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view products of their companies" ON products;
DROP POLICY IF EXISTS "Users can insert products to their companies" ON products;
DROP POLICY IF EXISTS "Users can update products of their companies" ON products;
DROP POLICY IF EXISTS "Users can delete products of their companies" ON products;
DROP POLICY IF EXISTS "Access products" ON products;

CREATE POLICY "Access products"
ON products
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);
