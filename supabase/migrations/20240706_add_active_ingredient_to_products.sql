
-- Add active_ingredient column to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS active_ingredient TEXT;
