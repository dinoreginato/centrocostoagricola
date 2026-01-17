
-- Enable RLS on company_members
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see members of companies they belong to
CREATE POLICY "Users can view members of their companies" ON company_members
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM company_members WHERE user_id = auth.uid()
    )
    OR
    company_id IN (
      SELECT id FROM companies WHERE owner_id = auth.uid()
    )
  );

-- Policy: Admins and Owners can manage members
CREATE POLICY "Admins and Owners can manage members" ON company_members
  FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM company_members 
      WHERE user_id = auth.uid() 
      AND company_id = company_members.company_id 
      AND role = 'admin'
    )
  );

-- Function to get user ID by email (Security Definer - Use with caution)
CREATE OR REPLACE FUNCTION get_user_id_by_email(email_input TEXT)
RETURNS UUID AS $$
DECLARE
  found_id UUID;
BEGIN
  SELECT id INTO found_id FROM auth.users WHERE email = email_input;
  RETURN found_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
