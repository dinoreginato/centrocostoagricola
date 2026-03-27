-- Migration to add protection_days to application_orders
ALTER TABLE application_orders ADD COLUMN IF NOT EXISTS protection_days NUMERIC DEFAULT 0;
