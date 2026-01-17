
-- Function to get company members with emails
CREATE OR REPLACE FUNCTION get_company_members(company_id_input UUID)
RETURNS TABLE (
  member_id UUID,
  user_id UUID,
  email VARCHAR,
  role VARCHAR,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM companies WHERE id = company_id_input AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM company_members WHERE company_id = company_id_input AND user_id = auth.uid() AND role = 'admin'
  ) THEN
    -- Optional: Allow regular members to see the list? Let's allow admins/owners only for now, or everyone?
    -- Let's check if the user is at least a member
    IF NOT EXISTS (
      SELECT 1 FROM company_members WHERE company_id = company_id_input AND user_id = auth.uid()
    ) THEN
        RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT 
    cm.id as member_id,
    cm.user_id,
    au.email::VARCHAR,
    cm.role,
    cm.created_at
  FROM company_members cm
  JOIN auth.users au ON cm.user_id = au.id
  WHERE cm.company_id = company_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
