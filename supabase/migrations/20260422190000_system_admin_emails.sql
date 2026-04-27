CREATE TABLE IF NOT EXISTS public.system_admin_emails (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_admin_emails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.system_admin_emails FROM PUBLIC;
REVOKE ALL ON TABLE public.system_admin_emails FROM anon;
REVOKE ALL ON TABLE public.system_admin_emails FROM authenticated;

INSERT INTO public.system_admin_emails (email)
VALUES ('dino.reginato@gmail.com')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email text;
BEGIN
  SELECT email INTO current_email FROM auth.users WHERE id = auth.uid();

  RETURN EXISTS (
    SELECT 1
    FROM public.system_admin_emails sae
    WHERE lower(sae.email) = lower(current_email)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_system_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;
