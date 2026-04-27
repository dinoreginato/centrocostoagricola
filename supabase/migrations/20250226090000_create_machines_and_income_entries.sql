CREATE TABLE IF NOT EXISTS public.machines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text,
  brand text,
  model text,
  plate text,
  description text,
  is_active boolean DEFAULT true
);

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view machines of their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines to their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines of their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines of their company" ON public.machines;
DROP POLICY IF EXISTS "policy_read_machines" ON public.machines;
DROP POLICY IF EXISTS "policy_write_machines" ON public.machines;

CREATE POLICY "policy_read_machines" ON public.machines FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_machines" ON public.machines FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

ALTER TABLE public.machinery_assignments
ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.income_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  date date NOT NULL,
  category text DEFAULT 'Venta Fruta',
  amount numeric(12, 2) NOT NULL,
  description text,
  season text
);

ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view income_entries of their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can insert income_entries to their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can update income_entries of their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can delete income_entries of their company" ON public.income_entries;
DROP POLICY IF EXISTS "policy_read_income_entries" ON public.income_entries;
DROP POLICY IF EXISTS "policy_write_income_entries" ON public.income_entries;

CREATE POLICY "policy_read_income_entries" ON public.income_entries FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_income_entries" ON public.income_entries FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

