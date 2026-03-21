-- Migration to add final user-requested improvements: Inventory Expiration, Piece-rates, and Rain Logs

-- 1. Inventory: Lot number and expiration date
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS lot_number text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS expiration_date date;

-- 2. Workers: Piece-rate (Tratos)
ALTER TABLE public.worker_costs ADD COLUMN IF NOT EXISTS is_piece_rate boolean DEFAULT false;
ALTER TABLE public.worker_costs ADD COLUMN IF NOT EXISTS piece_quantity numeric;
ALTER TABLE public.worker_costs ADD COLUMN IF NOT EXISTS piece_price numeric;
ALTER TABLE public.worker_costs ADD COLUMN IF NOT EXISTS worker_name text;
ALTER TABLE public.worker_costs ADD COLUMN IF NOT EXISTS labor_type text;

-- 3. Weather: Rain Logs
CREATE TABLE IF NOT EXISTS public.rain_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    date date NOT NULL,
    rain_mm numeric NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS for rain_logs
ALTER TABLE public.rain_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access rain_logs"
ON public.rain_logs
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);