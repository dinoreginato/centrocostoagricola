
-- Enable RLS
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can insert machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can update machines for their company" ON public.machines;
DROP POLICY IF EXISTS "Users can delete machines for their company" ON public.machines;

-- Create new policies checking both company_members AND companies.owner_id

-- SELECT
CREATE POLICY "Users can view machines for their company"
ON public.machines
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = machines.company_id
    AND company_members.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.companies
    WHERE companies.id = machines.company_id
    AND companies.owner_id = auth.uid()
  )
);

-- INSERT
CREATE POLICY "Users can insert machines for their company"
ON public.machines
FOR INSERT
WITH CHECK (
  (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = machines.company_id
      AND company_members.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.companies
      WHERE companies.id = machines.company_id
      AND companies.owner_id = auth.uid()
    )
  )
);

-- UPDATE
CREATE POLICY "Users can update machines for their company"
ON public.machines
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = machines.company_id
    AND company_members.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.companies
    WHERE companies.id = machines.company_id
    AND companies.owner_id = auth.uid()
  )
);

-- DELETE
CREATE POLICY "Users can delete machines for their company"
ON public.machines
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = machines.company_id
    AND company_members.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.companies
    WHERE companies.id = machines.company_id
    AND companies.owner_id = auth.uid()
  )
);
