
-- 1. Helper function to get company IDs where the user is a member
-- SECURITY DEFINER ensures this runs without triggering RLS on company_members again
CREATE OR REPLACE FUNCTION get_auth_user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid();
$$;

-- 2. Helper function to check if user is admin of a company
CREATE OR REPLACE FUNCTION is_company_admin(cmp_id uuid)
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

-- 3. Fix Companies Policy
DROP POLICY IF EXISTS "Users can view companies they own or belong to or orphans" ON companies;
DROP POLICY IF EXISTS "Users can view companies" ON companies; -- In case of name conflict

CREATE POLICY "Users can view companies" ON companies
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR
    owner_id IS NULL
    OR
    id IN (SELECT get_auth_user_company_ids())
  );

-- 4. Fix Company Members Policies
DROP POLICY IF EXISTS "Users can view members of their companies" ON company_members;
DROP POLICY IF EXISTS "Admins and Owners can manage members" ON company_members;

-- View policy: Can view if I am a member OR if I own the company
CREATE POLICY "Users can view members" ON company_members
  FOR SELECT
  USING (
    -- I am a member of this company (uses function to avoid recursion)
    company_id IN (SELECT get_auth_user_company_ids())
    OR
    -- I own this company (checking companies table is safe-ish now, but let's be careful)
    -- Ideally we should also avoid querying companies table if possible, but owner_id check is fast.
    -- However, querying companies triggers its RLS. 
    -- Companies RLS uses get_auth_user_company_ids (safe).
    -- So this direction is safe: members_policy -> companies -> companies_policy -> safe_function -> members_raw
    company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
  );

-- Manage policy: Can manage if I own the company OR I am an admin member
CREATE POLICY "Admins and Owners can manage members" ON company_members
  FOR ALL
  USING (
    company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
    OR
    is_company_admin(company_id)
  );
