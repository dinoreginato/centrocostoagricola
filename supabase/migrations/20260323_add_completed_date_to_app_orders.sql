-- Add completed_date to application_orders table
ALTER TABLE application_orders
ADD COLUMN completed_date date;
