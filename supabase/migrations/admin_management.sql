-- Admin Management Utilities

-- 1. Check if user is the specific system admin (Dino)
-- In a real app we'd have a roles table, but for now we hardcode the email logic or just use this function.
-- NOTE: We can't access auth.users email directly in a simple check easily without security definer.

CREATE OR REPLACE FUNCTION is_system_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email text;
BEGIN
  SELECT email INTO current_email FROM auth.users WHERE id = auth.uid();
  -- Replace with the actual admin email(s)
  RETURN current_email = 'dino.reginato@gmail.com';
END;
$$;

-- 2. Function to get ALL companies (for System Admin only)
CREATE OR REPLACE FUNCTION get_all_companies_admin()
RETURNS TABLE (
  id uuid,
  name text,
  owner_email text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_system_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    c.id,
    c.name::text,
    u.email::text as owner_email,
    c.created_at
  FROM companies c
  LEFT JOIN auth.users u ON c.owner_id = u.id
  ORDER BY c.created_at DESC;
END;
$$;

-- 3. Function to delete ANY company (for System Admin only)
CREATE OR REPLACE FUNCTION delete_company_admin(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_system_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Delete dependencies (Cascade usually handles this, but being explicit is safer if cascade is missing)
  -- Assuming ON DELETE CASCADE is set on foreign keys as per schema.
  DELETE FROM companies WHERE id = target_company_id;
END;
$$;
