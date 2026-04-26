REVOKE ALL ON FUNCTION public.get_my_company_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_company_ids() TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_company_ids_safe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_company_ids_safe() TO authenticated;

REVOKE ALL ON FUNCTION public.has_company_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_company_access(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin_or_editor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_editor(uuid) TO authenticated;

