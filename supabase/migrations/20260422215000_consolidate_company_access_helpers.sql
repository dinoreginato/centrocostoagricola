CREATE OR REPLACE FUNCTION public.get_my_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM public.company_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_ids_safe()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT company_id FROM public.company_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_company_access(cmp_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members
    WHERE company_id = cmp_id
      AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.companies
    WHERE id = cmp_id
      AND owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.has_company_access(_company_id);
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_editor(_company_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members
    WHERE company_id = _company_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'editor')
  ) OR EXISTS (
    SELECT 1
    FROM public.companies
    WHERE id = _company_id
      AND owner_id = auth.uid()
  );
$$;

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

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.company_members', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "policy_read_company_members_self" ON public.company_members FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "policy_write_company_members" ON public.company_members FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

