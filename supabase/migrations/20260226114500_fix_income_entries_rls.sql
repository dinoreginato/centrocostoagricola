
-- Enable RLS
ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (to be safe and ensure clean slate)
DROP POLICY IF EXISTS "Users can view income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can insert income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can update income entries for their company" ON public.income_entries;
DROP POLICY IF EXISTS "Users can delete income entries for their company" ON public.income_entries;

-- Create new policies using company_members table

-- SELECT
CREATE POLICY "Users can view income entries for their company"
ON public.income_entries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = income_entries.company_id
    AND company_members.user_id = auth.uid()
  )
);

-- INSERT
CREATE POLICY "Users can insert income entries for their company"
ON public.income_entries
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = income_entries.company_id
    AND company_members.user_id = auth.uid()
  )
);

-- UPDATE
CREATE POLICY "Users can update income entries for their company"
ON public.income_entries
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = income_entries.company_id
    AND company_members.user_id = auth.uid()
  )
);

-- DELETE
CREATE POLICY "Users can delete income entries for their company"
ON public.income_entries
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = income_entries.company_id
    AND company_members.user_id = auth.uid()
  )
);
