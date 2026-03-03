
-- 1. Drop everything related to the recursive policies first to start clean
DROP POLICY IF EXISTS "Users can view members" ON public.company_members;
DROP POLICY IF EXISTS "Users can view members of their companies" ON public.company_members;
DROP POLICY IF EXISTS "Admins and Owners can manage members" ON public.company_members;
DROP POLICY IF EXISTS "View own membership" ON public.company_members;
DROP POLICY IF EXISTS "View members of owned companies" ON public.company_members;
DROP POLICY IF EXISTS "View members as co-member" ON public.company_members;
DROP POLICY IF EXISTS "Manage members" ON public.company_members;

-- 2. Create a truly safe function to get my companies
-- This function runs as the owner (postgres) and BYPASSES RLS on company_members
CREATE OR REPLACE FUNCTION public.get_my_company_ids_safe()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

-- 3. Create a safe function to check access to a specific company
CREATE OR REPLACE FUNCTION public.has_company_access(cmp_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    -- Check if I am a member (using the safe bypass query)
    SELECT 1 
    FROM company_members 
    WHERE company_id = cmp_id 
    AND user_id = auth.uid()
  ) OR EXISTS (
    -- Check if I am the owner (direct check on companies table)
    SELECT 1 
    FROM companies 
    WHERE id = cmp_id 
    AND owner_id = auth.uid()
  );
$$;

-- 4. Define Company Members Policies (The source of recursion)
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- A. I can see my own membership row (Safe)
CREATE POLICY "View self" ON public.company_members
FOR SELECT USING (
  user_id = auth.uid()
);

-- B. I can see members if I am the OWNER of the company (Safe, checks companies table)
CREATE POLICY "Owner views members" ON public.company_members
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = company_members.company_id
    AND owner_id = auth.uid()
  )
);

-- C. I can see members if I am an ADMIN of the company
-- This is where recursion usually happens. We will use the SAFE function.
-- Since the safe function runs with SECURITY DEFINER, it won't trigger this policy recursively.
CREATE POLICY "Admin views members" ON public.company_members
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM company_members cm
    WHERE cm.company_id = company_members.company_id
    AND cm.user_id = auth.uid()
    AND cm.role = 'admin'
  )
);
-- Wait! The above policy queries company_members. 
-- Even with Security Definer elsewhere, a direct SELECT in the policy MIGHT be recursive if not careful.
-- BUT: The policy filters the rows *being accessed*. 
-- The subquery `SELECT 1 FROM company_members cm ...` *also* triggers RLS.
-- This IS the recursion.
-- FIX: We MUST use a SECURITY DEFINER function for the condition itself.

CREATE OR REPLACE FUNCTION public.is_company_admin_safe(cmp_id uuid)
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
    AND role = 'admin'
  );
$$;

-- Now use the function in the policy
DROP POLICY IF EXISTS "Admin views members" ON public.company_members;
CREATE POLICY "Admin views members" ON public.company_members
FOR SELECT USING (
  public.is_company_admin_safe(company_id)
);

-- Manage Policy (Insert/Update/Delete)
CREATE POLICY "Manage members" ON public.company_members
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.companies 
    WHERE id = company_members.company_id 
    AND owner_id = auth.uid()
  )
  OR
  public.is_company_admin_safe(company_id)
);

-- 5. Update Policies for Other Tables (Machines, Income, etc.) using the unified safe check
-- MACHINES
DROP POLICY IF EXISTS "Users can view machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Machine Access" ON public.machines;

CREATE POLICY "Machine Access" ON public.machines
FOR ALL USING ( public.has_company_access(company_id) );

-- INCOME ENTRIES
DROP POLICY IF EXISTS "Users can view income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can insert income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can update income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can delete income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Income Access" ON public.income_entries;

CREATE POLICY "Income Access" ON public.income_entries
FOR ALL USING ( public.has_company_access(company_id) );

-- PRODUCTION RECORDS
DROP POLICY IF EXISTS "Users can view production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Production Access" ON public.production_records;

CREATE POLICY "Production Access" ON public.production_records
FOR ALL USING ( public.has_company_access(company_id) );
