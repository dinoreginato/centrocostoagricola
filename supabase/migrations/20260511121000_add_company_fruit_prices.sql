ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS fruit_prices jsonb DEFAULT '{}'::jsonb;
