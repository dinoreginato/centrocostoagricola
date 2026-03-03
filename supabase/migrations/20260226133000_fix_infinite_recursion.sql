
-- 1. Helper function to get company IDs where the user is a member (Security Definer to break recursion)
CREATE OR REPLACE FUNCTION public.get_auth_user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

-- 2. Helper function to check if user is owner of a company (Security Definer)
CREATE OR REPLACE FUNCTION public.is_company_owner(cmp_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM companies 
    WHERE id = cmp_id 
    AND owner_id = auth.uid()
  );
$$;

-- 3. Fix Company Members Policies
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view members" ON public.company_members;
DROP POLICY IF EXISTS "Users can view members of their companies" ON public.company_members;
DROP POLICY IF EXISTS "Admins and Owners can manage members" ON public.company_members;

-- View policy: Can view if I am a member OR if I own the company
CREATE POLICY "Users can view members" ON public.company_members
  FOR SELECT
  USING (
    -- I am a member (using safe function)
    company_id IN (SELECT public.get_auth_user_company_ids())
    OR
    -- I am the owner (using safe function)
    public.is_company_owner(company_id)
  );

-- Manage policy: Can manage if I own the company OR I am an admin member
CREATE POLICY "Admins and Owners can manage members" ON public.company_members
  FOR ALL
  USING (
    public.is_company_owner(company_id)
    OR
    EXISTS (
      SELECT 1 FROM public.company_members 
      WHERE company_id = public.company_members.company_id 
      AND user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- 4. Fix Companies Policies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view companies" ON public.companies;
DROP POLICY IF EXISTS "Users can view companies they own or belong to or orphans" ON public.companies;

CREATE POLICY "Users can view companies" ON public.companies
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR
    id IN (SELECT public.get_auth_user_company_ids())
  );

-- 5. Fix Machines Policies (Re-apply to be sure)
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines for their company" ON public.machines;

CREATE POLICY "Users can view machines for their company" ON public.machines FOR SELECT USING (
  company_id IN (SELECT public.get_auth_user_company_ids()) OR
  public.is_company_owner(company_id)
);
CREATE POLICY "Users can insert machines for their company" ON public.machines FOR INSERT WITH CHECK (
  company_id IN (SELECT public.get_auth_user_company_ids()) OR
  public.is_company_owner(company_id)
);
CREATE POLICY "Users can update machines for their company" ON public.machines FOR UPDATE USING (
  company_id IN (SELECT public.get_auth_user_company_ids()) OR
  public.is_company_owner(company_id)
);
CREATE POLICY "Users can delete machines for their company" ON public.machines FOR DELETE USING (
  company_id IN (SELECT public.get_auth_user_company_ids()) OR
  public.is_company_owner(company_id)
);
