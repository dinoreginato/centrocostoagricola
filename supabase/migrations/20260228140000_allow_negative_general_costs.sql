
-- Drop the check constraint that prevents negative amounts in general_costs
ALTER TABLE general_costs DROP CONSTRAINT IF EXISTS general_costs_amount_check;
