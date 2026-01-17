
-- Enable RLS on companies if not already
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if any (to be safe/clean, though IF EXISTS helps)
DROP POLICY IF EXISTS "Users can view their own companies" ON companies;
DROP POLICY IF EXISTS "Users can view companies they are members of" ON companies;

-- Create comprehensive policy
CREATE POLICY "Users can view companies they own or belong to" ON companies
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR
    id IN (
      SELECT company_id FROM company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update their companies" ON companies
  FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Owners can insert companies" ON companies
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- Note: Delete? usually owners only
CREATE POLICY "Owners can delete their companies" ON companies
  FOR DELETE
  USING (owner_id = auth.uid());
