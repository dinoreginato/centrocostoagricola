DO $$
BEGIN
  BEGIN
    ALTER FUNCTION public.is_admin_or_editor(uuid) SET search_path = public;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    ALTER FUNCTION public.is_company_member(uuid) SET search_path = public;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    ALTER FUNCTION public.get_company_members(uuid) SET search_path = public;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    ALTER FUNCTION public.get_user_id_by_email(text) SET search_path = public;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  BEGIN
    ALTER FUNCTION public.handle_new_company_owner() SET search_path = public;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END $$;

