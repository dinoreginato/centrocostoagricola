DO $$
DECLARE
  t text;
  p record;
  tables_to_reset text[] := ARRAY[
    'companies',
    'company_members',
    'fields',
    'sectors',
    'products',
    'invoices',
    'invoice_items',
    'inventory_movements',
    'applications',
    'application_items',
    'application_orders',
    'application_order_items',
    'fuel_consumption',
    'workers',
    'worker_costs',
    'machines',
    'income_entries',
    'production_records',
    'general_costs',
    'fuel_assignments',
    'machinery_assignments',
    'irrigation_assignments',
    'labor_assignments'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_reset LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    FOR p IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_read_companies" ON public.companies FOR SELECT
USING (
  public.is_company_member(id)
  OR owner_id IS NULL
);

CREATE POLICY "policy_insert_companies" ON public.companies FOR INSERT
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "policy_update_companies" ON public.companies FOR UPDATE
USING (
  public.is_admin_or_editor(id)
  OR owner_id IS NULL
)
WITH CHECK (
  public.is_admin_or_editor(id)
  OR owner_id = auth.uid()
);

CREATE POLICY "policy_delete_companies" ON public.companies FOR DELETE
USING (owner_id = auth.uid());

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_read_company_members_self" ON public.company_members FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "policy_write_company_members" ON public.company_members FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

DO $$
DECLARE
  t text;
  tables_with_cid text[] := ARRAY[
    'fields',
    'products',
    'invoices',
    'production_records',
    'fuel_consumption',
    'workers',
    'worker_costs',
    'machines',
    'income_entries',
    'general_costs',
    'application_orders'
  ];
BEGIN
  FOREACH t IN ARRAY tables_with_cid LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('CREATE POLICY "policy_read_%I" ON public.%I FOR SELECT USING (public.is_company_member(company_id))', t, t);
    EXECUTE format(
      'CREATE POLICY "policy_write_%I" ON public.%I FOR ALL USING (public.is_admin_or_editor(company_id)) WITH CHECK (public.is_admin_or_editor(company_id))',
      t,
      t
    );
  END LOOP;
END $$;

ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_read_sectors" ON public.sectors FOR SELECT
USING (EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_company_member(f.company_id)));

CREATE POLICY "policy_write_sectors" ON public.sectors FOR ALL
USING (EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_admin_or_editor(f.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.fields f WHERE f.id = field_id AND public.is_admin_or_editor(f.company_id)));

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_read_invoice_items" ON public.invoice_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.is_company_member(i.company_id)));

CREATE POLICY "policy_write_invoice_items" ON public.invoice_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.is_admin_or_editor(i.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND public.is_admin_or_editor(i.company_id)));

ALTER TABLE public.application_items ENABLE ROW LEVEL SECURITY;

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

DO $$
DECLARE
  t text;
  tables_assignments text[] := ARRAY['fuel_assignments', 'machinery_assignments', 'irrigation_assignments', 'labor_assignments'];
BEGIN
  FOREACH t IN ARRAY tables_assignments LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('
      CREATE POLICY "policy_read_%I" ON public.%I FOR SELECT
      USING (
        (sector_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sectors s JOIN public.fields f ON s.field_id = f.id WHERE s.id = sector_id AND public.is_company_member(f.company_id)))
        OR
        (invoice_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_items ii JOIN public.invoices i ON ii.invoice_id = i.id WHERE ii.id = invoice_item_id AND public.is_company_member(i.company_id)))
      );
    ', t, t);

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

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

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

ALTER TABLE public.application_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_read_application_order_items" ON public.application_order_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_company_member(o.company_id)));

CREATE POLICY "policy_write_application_order_items" ON public.application_order_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)));

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

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

