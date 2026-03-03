
-- Add UNIQUE constraint to registration_number
ALTER TABLE public.official_products 
ADD CONSTRAINT official_products_registration_number_key UNIQUE (registration_number);
