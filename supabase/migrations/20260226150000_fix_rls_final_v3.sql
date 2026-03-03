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

-- 6. Reset policies for EXPENSES
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view expenses of their companies" ON expenses;
DROP POLICY IF EXISTS "Users can insert expenses to their companies" ON expenses;
DROP POLICY IF EXISTS "Users can update expenses of their companies" ON expenses;
DROP POLICY IF EXISTS "Users can delete expenses of their companies" ON expenses;

CREATE POLICY "Access expenses"
ON expenses
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 7. Reset policies for LABOR_COSTS
ALTER TABLE labor_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view labor costs of their companies" ON labor_costs;
DROP POLICY IF EXISTS "Users can insert labor costs to their companies" ON labor_costs;
DROP POLICY IF EXISTS "Users can update labor costs of their companies" ON labor_costs;
DROP POLICY IF EXISTS "Users can delete labor costs of their companies" ON labor_costs;

CREATE POLICY "Access labor_costs"
ON labor_costs
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 8. Reset policies for FUEL_LOGS
ALTER TABLE fuel_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view fuel logs of their companies" ON fuel_logs;
DROP POLICY IF EXISTS "Users can insert fuel logs to their companies" ON fuel_logs;
DROP POLICY IF EXISTS "Users can update fuel logs of their companies" ON fuel_logs;
DROP POLICY IF EXISTS "Users can delete fuel logs of their companies" ON fuel_logs;

CREATE POLICY "Access fuel_logs"
ON fuel_logs
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 9. Reset policies for MAINTENANCE_LOGS
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view maintenance logs of their companies" ON maintenance_logs;
DROP POLICY IF EXISTS "Users can insert maintenance logs to their companies" ON maintenance_logs;
DROP POLICY IF EXISTS "Users can update maintenance logs of their companies" ON maintenance_logs;
DROP POLICY IF EXISTS "Users can delete maintenance logs of their companies" ON maintenance_logs;

CREATE POLICY "Access maintenance_logs"
ON maintenance_logs
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);

-- 10. Reset policies for SECTORS
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view sectors of their companies" ON sectors;
DROP POLICY IF EXISTS "Users can insert sectors to their companies" ON sectors;
DROP POLICY IF EXISTS "Users can update sectors of their companies" ON sectors;
DROP POLICY IF EXISTS "Users can delete sectors of their companies" ON sectors;

CREATE POLICY "Access sectors"
ON sectors
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);
