ALTER TABLE public.company_members
DROP CONSTRAINT IF EXISTS company_members_company_id_fkey;

ALTER TABLE public.company_members
ADD CONSTRAINT company_members_company_id_fkey
FOREIGN KEY (company_id)
REFERENCES public.companies(id)
ON DELETE CASCADE;

