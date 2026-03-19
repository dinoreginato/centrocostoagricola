-- Add budget column to sectors table
ALTER TABLE sectors ADD COLUMN budget numeric DEFAULT 0;
