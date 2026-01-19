-- Add application_item_id to inventory_movements to link applications with stock deduction
ALTER TABLE public.inventory_movements 
ADD COLUMN IF NOT EXISTS application_item_id uuid REFERENCES public.application_items(id) ON DELETE CASCADE;
