
-- Enable pg_trgm for search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create official products table (SAG Registry)
CREATE TABLE IF NOT EXISTS public.official_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    registration_number TEXT UNIQUE, -- Added UNIQUE constraint
    commercial_name TEXT NOT NULL,
    active_ingredient TEXT,
    concentration TEXT,
    company_name TEXT,
    formulation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast search
CREATE INDEX IF NOT EXISTS idx_official_products_name ON public.official_products USING gin(commercial_name gin_trgm_ops);

-- Add concentration to products if missing
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS concentration TEXT;

-- Enable RLS
ALTER TABLE public.official_products ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Allow read access to all authenticated users" ON public.official_products;
CREATE POLICY "Allow read access to all authenticated users"
ON public.official_products FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert access to all authenticated users" ON public.official_products;
CREATE POLICY "Allow insert access to all authenticated users"
ON public.official_products FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access to all authenticated users" ON public.official_products;
CREATE POLICY "Allow update access to all authenticated users"
ON public.official_products FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow delete access to all authenticated users" ON public.official_products;
CREATE POLICY "Allow delete access to all authenticated users"
ON public.official_products FOR DELETE TO authenticated USING (true);
