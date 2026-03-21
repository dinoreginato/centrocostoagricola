-- Migration to add advanced features: minimum stock, profitability, and machinery maintenance

-- 1. Smart Inventory
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS minimum_stock numeric DEFAULT 0;

-- 2. Profitability Analysis
ALTER TABLE public.production_records ADD COLUMN IF NOT EXISTS price_per_kg numeric DEFAULT 0;

-- 3. Machinery Maintenance
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS current_hours numeric DEFAULT 0;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS maintenance_interval_hours numeric DEFAULT 250;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS last_maintenance_hours numeric DEFAULT 0;
