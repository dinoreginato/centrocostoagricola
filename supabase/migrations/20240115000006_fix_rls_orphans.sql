
-- Relax RLS to allow viewing and claiming orphan companies (owner_id IS NULL)
DROP POLICY IF EXISTS "Users can view companies they own or belong to" ON companies;
DROP POLICY IF EXISTS "Owners can update their companies" ON companies;

CREATE POLICY "Users can view companies they own or belong to or orphans" ON companies
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR
    owner_id IS NULL
    OR
    id IN (
      SELECT company_id FROM company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and Claimers can update companies" ON companies
  FOR UPDATE
  USING (
    owner_id = auth.uid() 
    OR 
    owner_id IS NULL
  )
  WITH CHECK (
    owner_id = auth.uid()
  );
