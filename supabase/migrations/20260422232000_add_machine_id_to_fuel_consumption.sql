ALTER TABLE public.fuel_consumption
ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fuel_consumption_company_machine_date_idx
ON public.fuel_consumption (company_id, machine_id, date);

