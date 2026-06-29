ALTER TABLE public.executive_budget_plan_publication_events
ADD COLUMN IF NOT EXISTS document_ref text;

ALTER TABLE public.executive_budget_plan_publication_events
ADD COLUMN IF NOT EXISTS document_hash text;
