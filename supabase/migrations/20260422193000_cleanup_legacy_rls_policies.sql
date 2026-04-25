DROP POLICY IF EXISTS "fuel_access" ON public.fuel_assignments;
DROP POLICY IF EXISTS "machinery_access" ON public.machinery_assignments;
DROP POLICY IF EXISTS "irrigation_access" ON public.irrigation_assignments;

DROP POLICY IF EXISTS "Users can view fuel_consumption of their company" ON public.fuel_consumption;
DROP POLICY IF EXISTS "Users can insert fuel_consumption for their company" ON public.fuel_consumption;
DROP POLICY IF EXISTS "Users can update fuel_consumption for their company" ON public.fuel_consumption;
DROP POLICY IF EXISTS "Users can delete fuel_consumption for their company" ON public.fuel_consumption;

