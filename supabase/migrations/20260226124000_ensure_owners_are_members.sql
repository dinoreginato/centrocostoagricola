
-- 1. Data Fix: Ensure all current company owners are in company_members
INSERT INTO public.company_members (company_id, user_id, role)
SELECT id, owner_id, 'admin'
FROM public.companies c
WHERE NOT EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = c.id AND cm.user_id = c.owner_id
);

-- 2. Create a function to handle new company creation
CREATE OR REPLACE FUNCTION public.handle_new_company_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the trigger
DROP TRIGGER IF EXISTS on_company_created ON public.companies;
CREATE TRIGGER on_company_created
AFTER INSERT ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_company_owner();
