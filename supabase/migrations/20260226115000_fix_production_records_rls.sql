
-- Enable RLS
ALTER TABLE public.production_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can insert production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can update production records for their company" ON public.production_records;
DROP POLICY IF EXISTS "Users can delete production records for their company" ON public.production_records;

-- Create new policies using company_members table

-- SELECT
CREATE POLICY "Users can view production records for their company"
ON public.production_records
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = production_records.company_id
    AND company_members.user_id = auth.uid()
  )
);

-- INSERT
CREATE POLICY "Users can insert production records for their company"
ON public.production_records
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = production_records.company_id
    AND company_members.user_id = auth.uid()
  )
);

-- UPDATE
CREATE POLICY "Users can update production records for their company"
ON public.production_records
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = production_records.company_id
    AND company_members.user_id = auth.uid()
  )
);

-- DELETE
CREATE POLICY "Users can delete production records for their company"
ON public.production_records
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_members.company_id = production_records.company_id
    AND company_members.user_id = auth.uid()
  )
);
