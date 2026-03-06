
-- Add labor_type column to labor_assignments
ALTER TABLE labor_assignments 
ADD COLUMN labor_type text DEFAULT 'General';

-- Update RLS if necessary (usually not needed for new columns unless specific checks are added)
