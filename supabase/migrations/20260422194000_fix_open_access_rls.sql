DROP POLICY IF EXISTS "Allow access to all authenticated users" ON public.application_orders;
DROP POLICY IF EXISTS "Allow access to all authenticated users" ON public.application_order_items;

DROP POLICY IF EXISTS "production_records_open_access" ON public.production_records;

DROP POLICY IF EXISTS "Allow read access to all authenticated users" ON public.official_products;
DROP POLICY IF EXISTS "Allow insert access to all authenticated users" ON public.official_products;
DROP POLICY IF EXISTS "Allow update access to all authenticated users" ON public.official_products;
DROP POLICY IF EXISTS "Allow delete access to all authenticated users" ON public.official_products;

CREATE POLICY "Allow read access to all authenticated users"
ON public.official_products FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow system admin insert"
ON public.official_products FOR INSERT
TO authenticated
WITH CHECK (public.is_system_admin());

CREATE POLICY "Allow system admin update"
ON public.official_products FOR UPDATE
TO authenticated
USING (public.is_system_admin())
WITH CHECK (public.is_system_admin());

CREATE POLICY "Allow system admin delete"
ON public.official_products FOR DELETE
TO authenticated
USING (public.is_system_admin());

