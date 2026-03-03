
-- Add application_id to fuel_consumption to link applications with fuel usage
ALTER TABLE fuel_consumption 
ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_fuel_consumption_application_id ON fuel_consumption(application_id);
