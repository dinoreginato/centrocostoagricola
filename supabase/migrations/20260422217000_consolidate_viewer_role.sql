ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS supplier_rut text;

DO $$
BEGIN
  IF to_regclass('public.company_members') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_members_role_allowed'
      AND conrelid = 'public.company_members'::regclass
  ) THEN
    ALTER TABLE public.company_members
    ADD CONSTRAINT company_members_role_allowed
    CHECK (role IN ('admin', 'editor', 'viewer')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_members
    WHERE role IS NULL
       OR role NOT IN ('admin', 'editor', 'viewer')
    LIMIT 1
  ) THEN
    ALTER TABLE public.company_members VALIDATE CONSTRAINT company_members_role_allowed;
  END IF;
END $$;

