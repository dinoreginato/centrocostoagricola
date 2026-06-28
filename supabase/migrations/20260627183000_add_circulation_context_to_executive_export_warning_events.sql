ALTER TABLE public.executive_export_warning_events
  ADD COLUMN IF NOT EXISTS circulation_recipient text,
  ADD COLUMN IF NOT EXISTS circulation_reason text,
  ADD COLUMN IF NOT EXISTS circulation_notes text;

CREATE INDEX IF NOT EXISTS idx_executive_export_warning_events_company_reason
  ON public.executive_export_warning_events(company_id, circulation_reason, created_at DESC);
