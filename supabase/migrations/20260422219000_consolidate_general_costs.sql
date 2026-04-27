CREATE TABLE IF NOT EXISTS public.general_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  sector_id uuid NOT NULL REFERENCES public.sectors(id),
  invoice_item_id uuid REFERENCES public.invoice_items(id),
  category text NOT NULL,
  amount numeric NOT NULL,
  description text,
  date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.general_costs DROP CONSTRAINT IF EXISTS general_costs_amount_check;

ALTER TABLE public.general_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view general_costs of their company" ON public.general_costs;
DROP POLICY IF EXISTS "Users can insert general_costs for their company" ON public.general_costs;
DROP POLICY IF EXISTS "Users can update general_costs for their company" ON public.general_costs;
DROP POLICY IF EXISTS "Users can delete general_costs for their company" ON public.general_costs;
DROP POLICY IF EXISTS "Access general_costs" ON public.general_costs;
DROP POLICY IF EXISTS "policy_read_general_costs" ON public.general_costs;
DROP POLICY IF EXISTS "policy_write_general_costs" ON public.general_costs;

CREATE POLICY "policy_read_general_costs" ON public.general_costs FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_general_costs" ON public.general_costs FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));
