-- Fix get_company_members RPC to allow owners to see members
-- The previous check might be failing if the UNION logic is strict or if RLS interferes.
-- We simplify the check: If you are the owner OR an existing member, you can see the list.

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
  -- Security Check:
  -- 1. User is the OWNER of the company
  -- 2. OR User is a MEMBER of the company (any role, so everyone can see who is in the team)
  
  IF NOT EXISTS (
    SELECT 1 FROM companies WHERE id = company_id_input AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM company_members WHERE company_id = company_id_input AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    cm.id as member_id,
    cm.user_id,
    au.email::text,
    cm.role::text,
    cm.created_at
  FROM company_members cm
  JOIN auth.users au ON cm.user_id = au.id
  WHERE cm.company_id = company_id_input
  ORDER BY cm.created_at DESC;
END;
$$;
