-- Add export percentage (provided by exporter) for export shipments
ALTER TABLE public.income_entries
ADD COLUMN IF NOT EXISTS export_percentage NUMERIC DEFAULT 0;

