ALTER TABLE public.executive_global_alert_events
  ADD COLUMN IF NOT EXISTS management_status text NOT NULL DEFAULT 'pendiente'
    CHECK (management_status IN ('pendiente', 'reconocida', 'comunicada', 'cerrada')),
  ADD COLUMN IF NOT EXISTS management_owner_label text,
  ADD COLUMN IF NOT EXISTS management_note text,
  ADD COLUMN IF NOT EXISTS management_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_executive_global_alert_events_company_status
  ON public.executive_global_alert_events(company_id, management_status, created_at DESC);

DROP POLICY IF EXISTS "Users can update executive global alert events" ON public.executive_global_alert_events;

CREATE POLICY "Users can update executive global alert events"
  ON public.executive_global_alert_events
  FOR UPDATE
  USING (public.is_admin_or_editor(company_id))
  WITH CHECK (public.is_admin_or_editor(company_id));

GRANT UPDATE ON public.executive_global_alert_events TO authenticated;
