
-- Add missing columns to application_orders header to match physical form
ALTER TABLE public.application_orders 
ADD COLUMN IF NOT EXISTS variety TEXT,
ADD COLUMN IF NOT EXISTS objective TEXT;
