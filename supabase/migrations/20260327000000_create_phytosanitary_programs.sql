CREATE TABLE IF NOT EXISTS public.phytosanitary_programs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  season text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.program_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  program_id uuid REFERENCES public.phytosanitary_programs(id) ON DELETE CASCADE NOT NULL,
  stage_name text NOT NULL,
  objective text,
  water_per_ha numeric DEFAULT 0,
  estimated_date date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.program_event_products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES public.program_events(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  dose numeric NOT NULL,
  dose_unit text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.phytosanitary_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_event_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_read_phytosanitary_programs" ON public.phytosanitary_programs;
DROP POLICY IF EXISTS "policy_write_phytosanitary_programs" ON public.phytosanitary_programs;
DROP POLICY IF EXISTS "policy_read_program_events" ON public.program_events;
DROP POLICY IF EXISTS "policy_write_program_events" ON public.program_events;
DROP POLICY IF EXISTS "policy_read_program_event_products" ON public.program_event_products;
DROP POLICY IF EXISTS "policy_write_program_event_products" ON public.program_event_products;

CREATE POLICY "policy_read_phytosanitary_programs" ON public.phytosanitary_programs FOR SELECT
USING (public.is_company_member(company_id));

CREATE POLICY "policy_write_phytosanitary_programs" ON public.phytosanitary_programs FOR ALL
USING (public.is_admin_or_editor(company_id))
WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "policy_read_program_events" ON public.program_events FOR SELECT
USING (EXISTS (SELECT 1 FROM public.phytosanitary_programs p WHERE p.id = program_id AND public.is_company_member(p.company_id)));

CREATE POLICY "policy_write_program_events" ON public.program_events FOR ALL
USING (EXISTS (SELECT 1 FROM public.phytosanitary_programs p WHERE p.id = program_id AND public.is_admin_or_editor(p.company_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.phytosanitary_programs p WHERE p.id = program_id AND public.is_admin_or_editor(p.company_id)));

CREATE POLICY "policy_read_program_event_products" ON public.program_event_products FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.program_events e
    JOIN public.phytosanitary_programs p ON p.id = e.program_id
    WHERE e.id = event_id
      AND public.is_company_member(p.company_id)
  )
);

CREATE POLICY "policy_write_program_event_products" ON public.program_event_products FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.program_events e
    JOIN public.phytosanitary_programs p ON p.id = e.program_id
    WHERE e.id = event_id
      AND public.is_admin_or_editor(p.company_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.program_events e
    JOIN public.phytosanitary_programs p ON p.id = e.program_id
    WHERE e.id = event_id
      AND public.is_admin_or_editor(p.company_id)
  )
);

