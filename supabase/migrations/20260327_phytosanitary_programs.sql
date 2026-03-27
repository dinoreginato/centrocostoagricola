-- Create Phytosanitary Programs tables
CREATE TABLE IF NOT EXISTS public.phytosanitary_programs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    season TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.program_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    program_id UUID REFERENCES public.phytosanitary_programs(id) ON DELETE CASCADE NOT NULL,
    stage_name TEXT NOT NULL,
    objective TEXT,
    water_per_ha NUMERIC DEFAULT 0,
    estimated_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.program_event_products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES public.program_events(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    dose NUMERIC NOT NULL,
    dose_unit TEXT NOT NULL, -- e.g., 'L/ha', 'Kg/ha', 'cc/100L', 'g/100L'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies for phytosanitary_programs
ALTER TABLE public.phytosanitary_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their company programs" ON public.phytosanitary_programs
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert their company programs" ON public.phytosanitary_programs
    FOR INSERT WITH CHECK (
        company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update their company programs" ON public.phytosanitary_programs
    FOR UPDATE USING (
        company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete their company programs" ON public.phytosanitary_programs
    FOR DELETE USING (
        company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        )
    );

-- RLS Policies for program_events
ALTER TABLE public.program_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view program events" ON public.program_events
    FOR SELECT USING (
        program_id IN (
            SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
            )
        )
    );
CREATE POLICY "Users can insert program events" ON public.program_events
    FOR INSERT WITH CHECK (
        program_id IN (
            SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
            )
        )
    );
CREATE POLICY "Users can update program events" ON public.program_events
    FOR UPDATE USING (
        program_id IN (
            SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
            )
        )
    );
CREATE POLICY "Users can delete program events" ON public.program_events
    FOR DELETE USING (
        program_id IN (
            SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
            )
        )
    );

-- RLS Policies for program_event_products
ALTER TABLE public.program_event_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view program event products" ON public.program_event_products
    FOR SELECT USING (
        event_id IN (
            SELECT id FROM public.program_events WHERE program_id IN (
                SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                    SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
                )
            )
        )
    );
CREATE POLICY "Users can insert program event products" ON public.program_event_products
    FOR INSERT WITH CHECK (
        event_id IN (
            SELECT id FROM public.program_events WHERE program_id IN (
                SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                    SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
                )
            )
        )
    );
CREATE POLICY "Users can update program event products" ON public.program_event_products
    FOR UPDATE USING (
        event_id IN (
            SELECT id FROM public.program_events WHERE program_id IN (
                SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                    SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
                )
            )
        )
    );
CREATE POLICY "Users can delete program event products" ON public.program_event_products
    FOR DELETE USING (
        event_id IN (
            SELECT id FROM public.program_events WHERE program_id IN (
                SELECT id FROM public.phytosanitary_programs WHERE company_id IN (
                    SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
                )
            )
        )
    );
