
-- Create Application Orders Table (Header)
CREATE TABLE IF NOT EXISTS public.application_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES public.fields(id),
    sector_id UUID NOT NULL REFERENCES public.sectors(id),
    order_number SERIAL, -- Auto-incrementing number for user reference
    scheduled_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'completada', 'cancelada')),
    
    -- Technical Details
    application_type TEXT DEFAULT 'fitosanitario',
    water_liters_per_hectare NUMERIC DEFAULT 0, -- Mojamiento
    tank_capacity NUMERIC DEFAULT 2000, -- Capacidad del equipo
    
    -- Machinery Instructions
    tractor_id UUID REFERENCES public.machines(id),
    sprayer_id UUID REFERENCES public.machines(id),
    tractor_driver_id UUID REFERENCES public.workers(id),
    
    -- Calibration Details (Optional but good for orders)
    speed NUMERIC, -- km/h
    pressure NUMERIC, -- bar/psi
    rpm NUMERIC,
    nozzles TEXT, -- Boquillas
    
    -- Notes
    notes TEXT,
    safety_period_hours NUMERIC DEFAULT 0, -- Reingreso
    grace_period_days NUMERIC DEFAULT 0, -- Carencia
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create Application Order Items Table (Products)
CREATE TABLE IF NOT EXISTS public.application_order_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.application_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id),
    
    -- Planned Amounts
    dose_per_hectare NUMERIC NOT NULL,
    dose_per_100l NUMERIC, -- Optional: Concentration
    total_quantity NUMERIC NOT NULL, -- Calculated total needed
    unit TEXT NOT NULL,
    
    objective TEXT, -- Target pest/disease
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.application_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_order_items ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Allow access to all authenticated users" ON public.application_orders;
DROP POLICY IF EXISTS "policy_read_application_orders" ON public.application_orders;
DROP POLICY IF EXISTS "policy_write_application_orders" ON public.application_orders;

CREATE POLICY "policy_read_application_orders" ON public.application_orders FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_application_orders" ON public.application_orders FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

DROP POLICY IF EXISTS "Allow access to all authenticated users" ON public.application_order_items;
DROP POLICY IF EXISTS "policy_read_application_order_items" ON public.application_order_items;
DROP POLICY IF EXISTS "policy_write_application_order_items" ON public.application_order_items;

CREATE POLICY "policy_read_application_order_items" ON public.application_order_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_company_member(o.company_id)));

CREATE POLICY "policy_write_application_order_items" ON public.application_order_items FOR ALL
USING (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.application_orders o WHERE o.id = order_id AND public.is_admin_or_editor(o.company_id)));
