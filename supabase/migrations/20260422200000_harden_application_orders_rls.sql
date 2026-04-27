ALTER TABLE public.application_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_application_orders" ON public.application_orders;
DROP POLICY IF EXISTS "policy_write_application_orders" ON public.application_orders;
DROP POLICY IF EXISTS "Allow access to all authenticated users" ON public.application_orders;

CREATE POLICY "policy_read_application_orders" ON public.application_orders FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_application_orders" ON public.application_orders FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

