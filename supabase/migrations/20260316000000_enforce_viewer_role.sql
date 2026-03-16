
-- Drop existing functions to avoid signature conflicts
DROP FUNCTION IF EXISTS public.is_company_member(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin_or_editor(uuid) CASCADE;

-- Create a helper function to check if user is admin or editor
CREATE OR REPLACE FUNCTION public.is_admin_or_editor(_company_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a helper function to check if user is a member (for SELECT)
CREATE OR REPLACE FUNCTION public.is_company_member(_company_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.company_members 
    WHERE company_id = _company_id 
    AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1
    FROM public.companies
    WHERE id = _company_id
    AND owner_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Group A: Tables with company_id
DO $$
DECLARE
  t text;
  tables_with_cid text[] := ARRAY[
    'fields', 'products', 'invoices', 'production_records',
    'fuel_consumption', 'workers', 'worker_costs', 'machines', 'income_entries',
    'general_costs', 'application_orders', 'company_members'
  ];
BEGIN
  FOREACH t IN ARRAY tables_with_cid LOOP
    EXECUTE format('DROP POLICY IF EXISTS "policy_read_%I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "policy_write_%I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable read access for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable insert for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable update for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable delete for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can view %I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can insert %I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can update %I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can delete %I" ON public.%I', t, t);

    IF t = 'company_members' THEN
       EXECUTE format('
         CREATE POLICY "policy_read_%I" ON public.%I FOR SELECT
         USING (public.is_company_member(company_id));
       ', t, t);
       
       EXECUTE format('
         CREATE POLICY "policy_write_%I" ON public.%I FOR ALL
         USING (public.is_admin_or_editor(company_id))
         WITH CHECK (public.is_admin_or_editor(company_id));
       ', t, t);
    ELSE
       EXECUTE format('
         CREATE POLICY "policy_read_%I" ON public.%I FOR SELECT
         USING (public.is_company_member(company_id));
       ', t, t);

       EXECUTE format('
         CREATE POLICY "policy_write_%I" ON public.%I FOR ALL
         USING (public.is_admin_or_editor(company_id))
         WITH CHECK (public.is_admin_or_editor(company_id));
       ', t, t);
    END IF;
  END LOOP;
END $$;

-- Group B: Sectors (via field_id)
DROP POLICY IF EXISTS "policy_read_sectors" ON public.sectors;
DROP POLICY IF EXISTS "policy_write_sectors" ON public.sectors;
DROP POLICY IF EXISTS "Enable read access for company members" ON public.sectors;
DROP POLICY IF EXISTS "Enable insert for company members" ON public.sectors;
DROP POLICY IF EXISTS "Enable update for company members" ON public.sectors;
DROP POLICY IF EXISTS "Enable delete for company members" ON public.sectors;

CREATE POLICY "policy_read_sectors" ON public.sectors FOR SELECT
USING (EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_company_member(f.company_id)));

CREATE POLICY "policy_write_sectors" ON public.sectors FOR ALL
USING (EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_admin_or_editor(f.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_admin_or_editor(f.company_id)));

-- Group C: Invoice Items (via invoice_id)
DROP POLICY IF EXISTS "policy_read_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "policy_write_invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "Enable read access for company members" ON public.invoice_items;
DROP POLICY IF EXISTS "Enable insert for company members" ON public.invoice_items;
DROP POLICY IF EXISTS "Enable update for company members" ON public.invoice_items;
DROP POLICY IF EXISTS "Enable delete for company members" ON public.invoice_items;

CREATE POLICY "policy_read_invoice_items" ON public.invoice_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.is_company_member(i.company_id)));

CREATE POLICY "policy_write_invoice_items" ON public.invoice_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.is_admin_or_editor(i.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.is_admin_or_editor(i.company_id)));

-- Group D: Application Items (via application_id)
DROP POLICY IF EXISTS "policy_read_application_items" ON public.application_items;
DROP POLICY IF EXISTS "policy_write_application_items" ON public.application_items;
DROP POLICY IF EXISTS "Enable read access for company members" ON public.application_items;
DROP POLICY IF EXISTS "Enable insert for company members" ON public.application_items;
DROP POLICY IF EXISTS "Enable update for company members" ON public.application_items;
DROP POLICY IF EXISTS "Enable delete for company members" ON public.application_items;

CREATE POLICY "policy_read_application_items" ON public.application_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND 
  (
    (a.field_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = a.field_id AND public.is_company_member(f.company_id)))
    OR
    (a.sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f2 ON s.field_id = f2.id WHERE s.id = a.sector_id AND public.is_company_member(f2.company_id)))
  )
));

CREATE POLICY "policy_write_application_items" ON public.application_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND 
  (
    (a.field_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = a.field_id AND public.is_admin_or_editor(f.company_id)))
    OR
    (a.sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f2 ON s.field_id = f2.id WHERE s.id = a.sector_id AND public.is_admin_or_editor(f2.company_id)))
  )
))
WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND 
  (
    (a.field_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = a.field_id AND public.is_admin_or_editor(f.company_id)))
    OR
    (a.sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f2 ON s.field_id = f2.id WHERE s.id = a.sector_id AND public.is_admin_or_editor(f2.company_id)))
  )
));

-- Group E: Assignments (fuel_assignments, machinery_assignments, irrigation_assignments, labor_assignments)
DO $$
DECLARE
  t text;
  tables_assignments text[] := ARRAY['fuel_assignments', 'machinery_assignments', 'irrigation_assignments', 'labor_assignments'];
BEGIN
  FOREACH t IN ARRAY tables_assignments LOOP
    EXECUTE format('DROP POLICY IF EXISTS "policy_read_%I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "policy_write_%I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable read access for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable insert for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable update for company members" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable delete for company members" ON public.%I', t);

    -- READ
    EXECUTE format('
      CREATE POLICY "policy_read_%I" ON public.%I FOR SELECT
      USING (
        (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_company_member(f.company_id)))
        OR
        (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_company_member(i.company_id)))
      );
    ', t, t);

    -- WRITE
    EXECUTE format('
      CREATE POLICY "policy_write_%I" ON public.%I FOR ALL
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
    ', t, t);
  END LOOP;
END $$;

-- Group F: Inventory Movements
DROP POLICY IF EXISTS "policy_read_inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "policy_write_inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "Enable read access for company members" ON public.inventory_movements;
DROP POLICY IF EXISTS "Enable insert for company members" ON public.inventory_movements;
DROP POLICY IF EXISTS "Enable update for company members" ON public.inventory_movements;
DROP POLICY IF EXISTS "Enable delete for company members" ON public.inventory_movements;

CREATE POLICY "policy_read_inventory_movements" ON public.inventory_movements FOR SELECT
USING (
  (product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND public.is_company_member(p.company_id)))
);

CREATE POLICY "policy_write_inventory_movements" ON public.inventory_movements FOR ALL
USING (
  (product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND public.is_admin_or_editor(p.company_id)))
)
WITH CHECK (
  (product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND public.is_admin_or_editor(p.company_id)))
);

-- Group G: Application Order Items (via order_id)
DROP POLICY IF EXISTS "policy_read_application_order_items" ON public.application_order_items;
DROP POLICY IF EXISTS "policy_write_application_order_items" ON public.application_order_items;
DROP POLICY IF EXISTS "Enable read access for company members" ON public.application_order_items;
DROP POLICY IF EXISTS "Enable insert for company members" ON public.application_order_items;
DROP POLICY IF EXISTS "Enable update for company members" ON public.application_order_items;
DROP POLICY IF EXISTS "Enable delete for company members" ON public.application_order_items;

CREATE POLICY "policy_read_application_order_items" ON public.application_order_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_company_member(o.company_id)));

CREATE POLICY "policy_write_application_order_items" ON public.application_order_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)));

-- Group H: Applications (Special case with field_id OR sector_id)
DROP POLICY IF EXISTS "policy_read_applications" ON public.applications;
DROP POLICY IF EXISTS "policy_write_applications" ON public.applications;
DROP POLICY IF EXISTS "Enable read access for company members" ON public.applications;
DROP POLICY IF EXISTS "Enable insert for company members" ON public.applications;
DROP POLICY IF EXISTS "Enable update for company members" ON public.applications;
DROP POLICY IF EXISTS "Enable delete for company members" ON public.applications;

CREATE POLICY "policy_read_applications" ON public.applications FOR SELECT
USING (
  (field_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_company_member(f.company_id)))
  OR
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f2 ON s.field_id = f2.id WHERE s.id = sector_id AND public.is_company_member(f2.company_id)))
);

CREATE POLICY "policy_write_applications" ON public.applications FOR ALL
USING (
  (field_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f2 ON s.field_id = f2.id WHERE s.id = sector_id AND public.is_admin_or_editor(f2.company_id)))
)
WITH CHECK (
  (field_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_admin_or_editor(f.company_id)))
  OR
  (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f2 ON s.field_id = f2.id WHERE s.id = sector_id AND public.is_admin_or_editor(f2.company_id)))
);
