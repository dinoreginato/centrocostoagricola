
-- Re-apply INSERT policy to be absolutely sure
DROP POLICY IF EXISTS "Owners can insert companies" ON companies;

CREATE POLICY "Owners can insert companies" ON companies
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());
