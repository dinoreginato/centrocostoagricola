CREATE OR REPLACE FUNCTION public.get_user_id_by_email_for_company(
  p_company_id uuid,
  email_input text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id uuid;
BEGIN
  IF NOT public.is_admin_or_editor(p_company_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT id
  INTO found_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(email_input));

  RETURN found_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_email_for_company(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email_for_company(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_user_id_by_email(text);

CREATE OR REPLACE FUNCTION public.get_company_members(company_id_input uuid)
RETURNS TABLE (
  member_id uuid,
  user_id uuid,
  email varchar,
  role varchar,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_editor(company_id_input) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT 
    cm.id as member_id,
    cm.user_id,
    au.email::varchar,
    cm.role,
    cm.created_at
  FROM public.company_members cm
  JOIN auth.users au ON cm.user_id = au.id
  WHERE cm.company_id = company_id_input;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_members(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_system_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.get_all_companies_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_companies_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.delete_company_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_company_admin(uuid) TO authenticated;

