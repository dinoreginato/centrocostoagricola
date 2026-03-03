
-- Simplify Policies to Break Recursion ABSOLUTELY
-- We will use a simpler approach: 
-- 1. Create a MATERIALIZED VIEW or a separate table for membership cache if needed, OR
-- 2. Just use SECURITY DEFINER functions correctly (which we tried, but maybe RLS on company_members itself is the issue).
-- Let's try to remove RLS on company_members for SELECT, or make it very simple.

-- OPTION: Use a bypass function for everything.

-- 1. Function to check access (Security Definer - Bypass RLS)
CREATE OR REPLACE FUNCTION public.has_company_access(cmp_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM company_members 
    WHERE company_id = cmp_id 
    AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 
    FROM companies 
    WHERE id = cmp_id 
    AND owner_id = auth.uid()
  );
$$;

-- 2. Relax company_members RLS to avoid recursion
-- We need to be able to SELECT from company_members to check permissions.
-- If the policy for SELECT calls a function that SELECTs from company_members, we get recursion.
-- Solution: The policy for company_members should NOT query company_members if possible, 
-- OR we trust the SECURITY DEFINER function to handle it.
-- BUT: The security definer function 'get_auth_user_company_ids' queries company_members.
-- If RLS is enabled on company_members, that query triggers RLS -> Recursion.
-- FIX: Grants for the function owner (postgres/supabase_admin) usually bypass RLS, 
-- but 'security definer' runs as owner. Owner bypasses RLS? Yes, usually.
-- IF the owner is not a superuser, RLS might still apply.

-- LET'S TRY: Drop RLS on company_members for a moment and re-enable with a non-recursive policy.
-- A non-recursive policy for company_members:
-- Users can see their OWN membership rows.
-- Users can see rows for companies they own.
-- Users can see rows for companies where they are members (Recurisve step!).

-- STRATEGY: 
-- A. Split membership visibility.
-- Users can ALWAYS see their own rows in company_members.
-- user_id = auth.uid() -> Safe.

-- B. For seeing OTHER members:
-- You need to be a member of that company.
-- company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid()) -> RECURSION!

-- C. BREAK RECURSION using a lookup table or just trusting the owner check first.
-- Or better: Use `auth.uid()` directly.

-- PLAN:
-- 1. Allow users to see their own membership (No recursion).
-- 2. Allow owners to see all members of their companies (No recursion if checking companies table).
-- 3. Allow admins/members to see other members? This is the hard part.

-- Let's try this simplified set of policies.

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view members" ON public.company_members;
DROP POLICY IF EXISTS "Users can view members of their companies" ON public.company_members;
DROP POLICY IF EXISTS "Admins and Owners can manage members" ON public.company_members;
DROP POLICY IF EXISTS "Users can manage members" ON public.company_members;

-- Policy 1: I can see my own membership. (Base case, no recursion)
CREATE POLICY "View own membership" ON public.company_members
FOR SELECT USING (
  user_id = auth.uid()
);

-- Policy 2: I can see members of companies I own. (No recursion, checks companies table)
CREATE POLICY "View members of owned companies" ON public.company_members
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.companies 
    WHERE id = company_members.company_id 
    AND owner_id = auth.uid()
  )
);

-- Policy 3: I can see members of companies where I am a member. (The dangerous one)
-- To avoid recursion, we MUST use a SECURITY DEFINER function that does NOT check this policy.
-- The function `get_auth_user_company_ids` is SECURITY DEFINER.
-- It runs as the owner. The owner typically bypasses RLS.
-- So `SELECT company_id FROM company_members WHERE user_id = auth.uid()` inside that function
-- SHOULD NOT trigger this policy check for the `postgres` user.
-- HOWEVER, if it does, we are stuck.

-- Let's try to redefine the function to be explicitly safe.
CREATE OR REPLACE FUNCTION public.get_my_company_ids_safe()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- This query runs as the table owner. 
  -- Ensure the owner has BYPASSRLS privilege or is a superuser. 
  -- In Supabase, usually true.
  SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

CREATE POLICY "View members as co-member" ON public.company_members
FOR SELECT USING (
  company_id IN (SELECT public.get_my_company_ids_safe())
);

-- Manage Policy (Insert/Update/Delete)
CREATE POLICY "Manage members" ON public.company_members
FOR ALL USING (
  -- Owner
  EXISTS (
    SELECT 1 FROM public.companies 
    WHERE id = company_members.company_id 
    AND owner_id = auth.uid()
  )
  OR
  -- Admin (via safe function to avoid recursion if we checked role in same table)
  EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = company_members.company_id
    AND cm.user_id = auth.uid()
    AND cm.role = 'admin'
  )
);

-- NOW, UPDATE OTHER TABLES TO USE THE SAFE FUNCTION `has_company_access`

-- MACHINES
DROP POLICY IF EXISTS "Users can view machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines for their company" ON public.machines;

CREATE POLICY "Machine Access" ON public.machines
FOR ALL USING ( public.has_company_access(company_id) );

-- INCOME ENTRIES
DROP POLICY IF EXISTS "Users can view income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can insert income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can update income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can delete income entries for their company" ON public.income_entries;

CREATE POLICY "Income Access" ON public.income_entries
FOR ALL USING ( public.has_company_access(company_id) );

-- PRODUCTION RECORDS
DROP POLICY IF EXISTS "Users can view production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON public.production_records;

CREATE POLICY "Production Access" ON public.production_records
FOR ALL USING ( public.has_company_access(company_id) );

