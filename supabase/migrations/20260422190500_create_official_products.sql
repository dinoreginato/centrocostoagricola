CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.official_products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_number text,
  commercial_name text NOT NULL,
  active_ingredient text,
  concentration text,
  company_name text,
  formulation text,
  created_at timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_products_registration_number_key'
      AND conrelid = 'public.official_products'::regclass
  ) THEN
    ALTER TABLE public.official_products
    ADD CONSTRAINT official_products_registration_number_key UNIQUE (registration_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_official_products_name ON public.official_products USING gin (commercial_name gin_trgm_ops);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS concentration text;

ALTER TABLE public.official_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to all authenticated users" ON public.official_products;
DROP POLICY IF EXISTS "Allow system admin insert" ON public.official_products;
DROP POLICY IF EXISTS "Allow system admin update" ON public.official_products;
DROP POLICY IF EXISTS "Allow system admin delete" ON public.official_products;

CREATE POLICY "Allow read access to all authenticated users"
ON public.official_products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow system admin insert"
ON public.official_products FOR INSERT TO authenticated WITH CHECK (public.is_system_admin());

CREATE POLICY "Allow system admin update"
ON public.official_products FOR UPDATE TO authenticated USING (public.is_system_admin()) WITH CHECK (public.is_system_admin());

CREATE POLICY "Allow system admin delete"
ON public.official_products FOR DELETE TO authenticated USING (public.is_system_admin());

