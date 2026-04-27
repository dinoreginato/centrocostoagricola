CREATE TABLE IF NOT EXISTS public.application_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.fields(id),
  sector_id uuid NOT NULL REFERENCES public.sectors(id),
  order_number SERIAL,
  scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'completada', 'cancelada')),
  completed_date date,
  application_type text DEFAULT 'fitosanitario',
  water_liters_per_hectare numeric DEFAULT 0,
  tank_capacity numeric DEFAULT 2000,
  tractor_id uuid REFERENCES public.machines(id),
  sprayer_id uuid REFERENCES public.machines(id),
  tractor_driver_id uuid REFERENCES public.workers(id),
  speed numeric,
  pressure numeric,
  rpm numeric,
  nozzles text,
  notes text,
  safety_period_hours numeric DEFAULT 0,
  grace_period_days numeric DEFAULT 0,
  protection_days numeric DEFAULT 0,
  variety text,
  objective text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.application_orders ADD COLUMN IF NOT EXISTS completed_date date;
ALTER TABLE public.application_orders ADD COLUMN IF NOT EXISTS protection_days numeric DEFAULT 0;
ALTER TABLE public.application_orders ADD COLUMN IF NOT EXISTS variety text;
ALTER TABLE public.application_orders ADD COLUMN IF NOT EXISTS objective text;

CREATE TABLE IF NOT EXISTS public.application_order_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.application_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  dose_per_hectare numeric NOT NULL,
  dose_per_100l numeric,
  total_quantity numeric NOT NULL,
  unit text NOT NULL,
  objective text,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.application_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_application_orders" ON public.application_orders;
DROP POLICY IF EXISTS "policy_write_application_orders" ON public.application_orders;

CREATE POLICY "policy_read_application_orders" ON public.application_orders FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_application_orders" ON public.application_orders FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

DROP POLICY IF EXISTS "policy_read_application_order_items" ON public.application_order_items;
DROP POLICY IF EXISTS "policy_write_application_order_items" ON public.application_order_items;

CREATE POLICY "policy_read_application_order_items" ON public.application_order_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_company_member(o.company_id)));

CREATE POLICY "policy_write_application_order_items" ON public.application_order_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)));

