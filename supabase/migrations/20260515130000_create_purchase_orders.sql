CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  order_number text,
  supplier_name text NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'Borrador' CHECK (status IN ('Borrador', 'Enviada', 'Cancelada')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_orders_company_id_idx
ON public.purchase_orders (company_id, order_date DESC);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  unit text,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric,
  line_total numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_order_items_company_id_idx
ON public.purchase_order_items (company_id);

CREATE INDEX IF NOT EXISTS purchase_order_items_order_id_idx
ON public.purchase_order_items (purchase_order_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "policy_write_purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "policy_read_purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "policy_write_purchase_order_items" ON public.purchase_order_items;

CREATE POLICY "policy_read_purchase_orders" ON public.purchase_orders FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_purchase_orders" ON public.purchase_orders FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "policy_read_purchase_order_items" ON public.purchase_order_items FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_purchase_order_items" ON public.purchase_order_items FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

CREATE OR REPLACE FUNCTION public.set_purchase_orders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_orders_set_updated_at ON public.purchase_orders;
CREATE TRIGGER purchase_orders_set_updated_at
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_purchase_orders_updated_at();

