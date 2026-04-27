ALTER TABLE public.production_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_production_records" ON public.production_records;
DROP POLICY IF EXISTS "policy_write_production_records" ON public.production_records;
DROP POLICY IF EXISTS "production_records_open_access" ON public.production_records;
DROP POLICY IF EXISTS "production_records_access_v2" ON public.production_records;
DROP POLICY IF EXISTS "production_records_company_policy" ON public.production_records;
DROP POLICY IF EXISTS "Users can view production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Access production_records" ON public.production_records;
DROP POLICY IF EXISTS "Production Access" ON public.production_records;
DROP POLICY IF EXISTS "Production_Access" ON public.production_records;

CREATE POLICY "policy_read_production_records" ON public.production_records FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_production_records" ON public.production_records FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

