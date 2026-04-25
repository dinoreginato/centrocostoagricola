
CREATE TABLE IF NOT EXISTS public.fuel_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id),
  sector_id uuid REFERENCES sectors(id),
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.machinery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id),
  sector_id uuid REFERENCES sectors(id),
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.irrigation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_item_id uuid REFERENCES invoice_items(id),
  sector_id uuid REFERENCES sectors(id),
  assigned_amount numeric NOT NULL CHECK (assigned_amount > 0),
  assigned_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fuel_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machinery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_assignments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to be safe on re-runs)
DROP POLICY IF EXISTS "fuel_access" ON public.fuel_assignments;
DROP POLICY IF EXISTS "machinery_access" ON public.machinery_assignments;
DROP POLICY IF EXISTS "irrigation_access" ON public.irrigation_assignments;
DROP POLICY IF EXISTS "policy_read_fuel_assignments" ON public.fuel_assignments;
DROP POLICY IF EXISTS "policy_write_fuel_assignments" ON public.fuel_assignments;
DROP POLICY IF EXISTS "policy_read_machinery_assignments" ON public.machinery_assignments;
DROP POLICY IF EXISTS "policy_write_machinery_assignments" ON public.machinery_assignments;
DROP POLICY IF EXISTS "policy_read_irrigation_assignments" ON public.irrigation_assignments;
DROP POLICY IF EXISTS "policy_write_irrigation_assignments" ON public.irrigation_assignments;

-- Create Policies
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

-- Grant permissions
GRANT ALL ON public.fuel_assignments TO authenticated;
GRANT ALL ON public.machinery_assignments TO authenticated;
GRANT ALL ON public.irrigation_assignments TO authenticated;
