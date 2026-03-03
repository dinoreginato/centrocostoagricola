
CREATE TABLE IF NOT EXISTS public.general_costs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL REFERENCES public.companies(id),
    sector_id uuid NOT NULL REFERENCES public.sectors(id),
    invoice_item_id uuid REFERENCES public.invoice_items(id),
    category text NOT NULL, 
    amount numeric NOT NULL CHECK (amount >= 0),
    description text,
    date date DEFAULT CURRENT_DATE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add RLS
ALTER TABLE public.general_costs ENABLE ROW LEVEL SECURITY;

-- Policies using the existing helper function
CREATE POLICY "Users can view general_costs of their company" ON public.general_costs
    FOR SELECT USING (
        (SELECT check_is_member_or_owner(company_id))
    );

CREATE POLICY "Users can insert general_costs for their company" ON public.general_costs
    FOR INSERT WITH CHECK (
        (SELECT check_is_member_or_owner(company_id))
    );

CREATE POLICY "Users can update general_costs for their company" ON public.general_costs
    FOR UPDATE USING (
        (SELECT check_is_member_or_owner(company_id))
    );

CREATE POLICY "Users can delete general_costs for their company" ON public.general_costs
    FOR DELETE USING (
        (SELECT check_is_member_or_owner(company_id))
    );
