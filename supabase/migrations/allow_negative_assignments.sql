-- Allow negative amounts for credit notes in assignments
-- This removes the check constraint that forces assigned_amount to be positive

-- For Labor Assignments
ALTER TABLE labor_assignments DROP CONSTRAINT IF EXISTS labor_assignments_assigned_amount_check;

-- For Machinery Assignments
ALTER TABLE machinery_assignments DROP CONSTRAINT IF EXISTS machinery_assignments_assigned_amount_check;

-- For Irrigation Assignments
ALTER TABLE irrigation_assignments DROP CONSTRAINT IF EXISTS irrigation_assignments_assigned_amount_check;

-- For Fuel Consumption (though usually positive, just in case)
ALTER TABLE fuel_consumption DROP CONSTRAINT IF EXISTS fuel_consumption_liters_check;
ALTER TABLE fuel_consumption DROP CONSTRAINT IF EXISTS fuel_consumption_estimated_price_check;
