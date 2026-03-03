
-- Fix RLS for general_costs using the stable non-recursive function pattern

ALTER TABLE public.general_costs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view general_costs of their company" ON public.general_costs;
DROP POLICY IF EXISTS "Users can insert general_costs for their company" ON public.general_costs;
DROP POLICY IF EXISTS "Users can update general_costs for their company" ON public.general_costs;
DROP POLICY IF EXISTS "Users can delete general_costs for their company" ON public.general_costs;
DROP POLICY IF EXISTS "Access general_costs" ON public.general_costs;

-- Create unified policy using the optimized function
CREATE POLICY "Access general_costs"
ON public.general_costs
FOR ALL
TO authenticated
USING (
    company_id IN (SELECT get_accessible_company_ids())
)
WITH CHECK (
    company_id IN (SELECT get_accessible_company_ids())
);
