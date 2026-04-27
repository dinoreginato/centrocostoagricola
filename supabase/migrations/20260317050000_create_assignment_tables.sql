CREATE TABLE IF NOT EXISTS public.fuel_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES public.invoice_items(id),
  sector_id uuid REFERENCES public.sectors(id),
  assigned_amount numeric NOT NULL,
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.machinery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES public.invoice_items(id),
  sector_id uuid REFERENCES public.sectors(id),
  assigned_amount numeric NOT NULL,
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.irrigation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES public.invoice_items(id),
  sector_id uuid REFERENCES public.sectors(id),
  assigned_amount numeric NOT NULL,
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.labor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE CASCADE,
  assigned_amount numeric NOT NULL,
  assigned_date date DEFAULT CURRENT_DATE,
  notes text,
  labor_type text DEFAULT 'General',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.labor_assignments ADD COLUMN IF NOT EXISTS labor_type text DEFAULT 'General';

ALTER TABLE public.labor_assignments DROP CONSTRAINT IF EXISTS labor_assignments_assigned_amount_check;
ALTER TABLE public.machinery_assignments DROP CONSTRAINT IF EXISTS machinery_assignments_assigned_amount_check;
ALTER TABLE public.irrigation_assignments DROP CONSTRAINT IF EXISTS irrigation_assignments_assigned_amount_check;

ALTER TABLE public.fuel_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machinery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_fuel_assignments" ON public.fuel_assignments;
DROP POLICY IF EXISTS "policy_write_fuel_assignments" ON public.fuel_assignments;
DROP POLICY IF EXISTS "policy_read_machinery_assignments" ON public.machinery_assignments;
DROP POLICY IF EXISTS "policy_write_machinery_assignments" ON public.machinery_assignments;
DROP POLICY IF EXISTS "policy_read_irrigation_assignments" ON public.irrigation_assignments;
DROP POLICY IF EXISTS "policy_write_irrigation_assignments" ON public.irrigation_assignments;
DROP POLICY IF EXISTS "policy_read_labor_assignments" ON public.labor_assignments;
DROP POLICY IF EXISTS "policy_write_labor_assignments" ON public.labor_assignments;

CREATE POLICY "policy_read_fuel_assignments" ON public.fuel_assignments FOR SELECT
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_company_member(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_company_member(i.company_id)))
);

CREATE POLICY "policy_write_fuel_assignments" ON public.fuel_assignments FOR ALL
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
)
WITH CHECK (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
);

CREATE POLICY "policy_read_machinery_assignments" ON public.machinery_assignments FOR SELECT
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_company_member(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_company_member(i.company_id)))
);

CREATE POLICY "policy_write_machinery_assignments" ON public.machinery_assignments FOR ALL
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
)
WITH CHECK (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
);

CREATE POLICY "policy_read_irrigation_assignments" ON public.irrigation_assignments FOR SELECT
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_company_member(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_company_member(i.company_id)))
);

CREATE POLICY "policy_write_irrigation_assignments" ON public.irrigation_assignments FOR ALL
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
)
WITH CHECK (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
);

CREATE POLICY "policy_read_labor_assignments" ON public.labor_assignments FOR SELECT
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_company_member(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_company_member(i.company_id)))
);

CREATE POLICY "policy_write_labor_assignments" ON public.labor_assignments FOR ALL
USING (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
)
WITH CHECK (
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_admin_or_editor(i.company_id)))
);

