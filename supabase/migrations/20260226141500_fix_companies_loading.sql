
-- 1. DROP ALL EXISTING POLICIES TO START FRESH
DROP POLICY IF EXISTS "Users can view members" ON public.company_members;
DROP POLICY IF EXISTS "Users can view members of their companies" ON public.company_members;
DROP POLICY IF EXISTS "Admins and Owners can manage members" ON public.company_members;
DROP POLICY IF EXISTS "View own membership" ON public.company_members;
DROP POLICY IF EXISTS "View members of owned companies" ON public.company_members;
DROP POLICY IF EXISTS "View members as co-member" ON public.company_members;
DROP POLICY IF EXISTS "Manage members" ON public.company_members;
DROP POLICY IF EXISTS "Member View Own" ON public.company_members;
DROP POLICY IF EXISTS "Member View Company" ON public.company_members;
DROP POLICY IF EXISTS "Member Manage" ON public.company_members;
DROP POLICY IF EXISTS "Admin views members" ON public.company_members;
DROP POLICY IF EXISTS "Owner views members" ON public.company_members;
DROP POLICY IF EXISTS "View self" ON public.company_members;

DROP POLICY IF EXISTS "Users can view companies" ON public.companies;
DROP POLICY IF EXISTS "Users can view companies they own or belong to or orphans" ON public.companies;
DROP POLICY IF EXISTS "Companies Policy" ON public.companies;
DROP POLICY IF EXISTS "Companies Access" ON public.companies;
DROP POLICY IF EXISTS "Companies Insert" ON public.companies;
DROP POLICY IF EXISTS "Companies Manage" ON public.companies;
DROP POLICY IF EXISTS "Companies Delete" ON public.companies;
DROP POLICY IF EXISTS "Users can view own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can insert own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can update own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can delete own companies" ON public.companies;

-- 2. CREATE TRUSTED FUNCTION (SECURITY DEFINER)
-- This function is the SOURCE OF TRUTH. It bypasses RLS to get the list of companies a user belongs to.
CREATE OR REPLACE FUNCTION public.get_my_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

-- 3. COMPANIES POLICIES
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Companies_Select" ON public.companies
FOR SELECT USING (
  owner_id = auth.uid() OR
  id IN (SELECT public.get_my_company_ids())
);

CREATE POLICY "Companies_Insert" ON public.companies
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

CREATE POLICY "Companies_Update" ON public.companies
FOR UPDATE USING (
  owner_id = auth.uid()
);

CREATE POLICY "Companies_Delete" ON public.companies
FOR DELETE USING (
  owner_id = auth.uid()
);

-- 4. COMPANY_MEMBERS POLICIES
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Simple: I can see my own membership.
CREATE POLICY "Members_View_Self" ON public.company_members
FOR SELECT USING (
  user_id = auth.uid()
);

-- Advanced: I can see members of companies I belong to (using the trusted function to avoid recursion).
CREATE POLICY "Members_View_CoMembers" ON public.company_members
FOR SELECT USING (
  company_id IN (SELECT public.get_my_company_ids())
);

-- Owner/Admin Management
-- We'll allow members to insert/update for now if they are part of the company, 
-- relying on frontend or triggers for role checks to simplify RLS.
-- Or strictly: Owner can do anything.
CREATE POLICY "Members_Manage_Owner" ON public.company_members
FOR ALL USING (
  EXISTS (SELECT 1 FROM companies WHERE id = company_members.company_id AND owner_id = auth.uid())
);

-- 5. OTHER TABLES (Machines, Income, etc.)
-- They just need to check if the company_id is in the user's list.

-- MACHINES
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Machine Access" ON public.machines;
DROP POLICY IF EXISTS "Users can view machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines for their company" ON public.machines;

CREATE POLICY "Machines_Access" ON public.machines
FOR ALL USING (
  company_id IN (SELECT public.get_my_company_ids()) OR
  EXISTS (SELECT 1 FROM companies WHERE id = machines.company_id AND owner_id = auth.uid())
);

-- INCOME ENTRIES
ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Income Access" ON public.income_entries;
DROP POLICY IF EXISTS "Users can view income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can insert income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can update income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can delete income entries for their company" ON public.income_entries;

CREATE POLICY "Income_Access" ON public.income_entries
FOR ALL USING (
  company_id IN (SELECT public.get_my_company_ids()) OR
  EXISTS (SELECT 1 FROM companies WHERE id = income_entries.company_id AND owner_id = auth.uid())
);

-- PRODUCTION RECORDS
ALTER TABLE public.production_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Production Access" ON public.production_records;
DROP POLICY IF EXISTS "Users can view production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON public.production_records;

CREATE POLICY "Production_Access" ON public.production_records
FOR ALL USING (
  company_id IN (SELECT public.get_my_company_ids()) OR
  EXISTS (SELECT 1 FROM companies WHERE id = production_records.company_id AND owner_id = auth.uid())
);

-- 6. GRANT PERMISSIONS
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
