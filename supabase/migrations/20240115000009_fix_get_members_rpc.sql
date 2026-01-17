
-- Drop existing function to rebuild it correctly
DROP FUNCTION IF EXISTS get_company_members;

-- Create a secure function to get company members with their emails
-- We need to access auth.users which is restricted, so we use SECURITY DEFINER
CREATE OR REPLACE FUNCTION get_company_members(company_id_input uuid)
RETURNS TABLE (
  member_id uuid,
  user_id uuid,
  email text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the requesting user is allowed to see members (Owner or Admin of the company)
  IF NOT EXISTS (
    SELECT 1 FROM companies WHERE id = company_id_input AND owner_id = auth.uid()
    UNION
    SELECT 1 FROM company_members WHERE company_id = company_id_input AND user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    cm.id as member_id,
    cm.user_id,
    au.email::text,
    cm.role,
    cm.created_at
  FROM company_members cm
  JOIN auth.users au ON cm.user_id = au.id
  WHERE cm.company_id = company_id_input;
END;
$$;
