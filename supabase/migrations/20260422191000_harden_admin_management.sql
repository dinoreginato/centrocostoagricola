CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email text;
BEGIN
  SELECT email INTO current_email FROM auth.users WHERE id = auth.uid();

  RETURN EXISTS (
    SELECT 1
    FROM public.system_admin_emails sae
    WHERE lower(sae.email) = lower(current_email)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_system_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_all_companies_admin()
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
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    c.id,
    c.name::text,
    u.email::text as owner_email,
    c.created_at
  FROM public.companies c
  LEFT JOIN auth.users u ON c.owner_id = u.id
  ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_all_companies_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_companies_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_company_admin(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.companies WHERE id = target_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_company_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_company_admin(uuid) TO authenticated;

