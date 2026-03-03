
-- Add application_fuel_rate to companies table
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS application_fuel_rate NUMERIC DEFAULT 12;

-- Update existing companies to have default value if null (though DEFAULT handles new ones)
UPDATE companies SET application_fuel_rate = 12 WHERE application_fuel_rate IS NULL;
