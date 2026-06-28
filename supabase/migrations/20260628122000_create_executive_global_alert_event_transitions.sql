CREATE TABLE IF NOT EXISTS public.executive_global_alert_event_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.executive_global_alert_events(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  from_status text NOT NULL CHECK (from_status IN ('sin_estado', 'pendiente', 'reconocida', 'comunicada', 'cerrada')),
  to_status text NOT NULL CHECK (to_status IN ('pendiente', 'reconocida', 'comunicada', 'cerrada')),
  owner_label text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_transitions_company_created
  ON public.executive_global_alert_event_transitions(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_global_alert_transitions_event_created
  ON public.executive_global_alert_event_transitions(event_id, created_at DESC);

ALTER TABLE public.executive_global_alert_event_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view executive global alert transitions" ON public.executive_global_alert_event_transitions;
DROP POLICY IF EXISTS "Users can insert executive global alert transitions" ON public.executive_global_alert_event_transitions;
DROP POLICY IF EXISTS "Users can delete executive global alert transitions" ON public.executive_global_alert_event_transitions;

CREATE POLICY "Users can view executive global alert transitions"
  ON public.executive_global_alert_event_transitions
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert executive global alert transitions"
  ON public.executive_global_alert_event_transitions
  FOR INSERT
  WITH CHECK (public.is_admin_or_editor(company_id));

CREATE POLICY "Users can delete executive global alert transitions"
  ON public.executive_global_alert_event_transitions
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

GRANT SELECT, INSERT, DELETE ON public.executive_global_alert_event_transitions TO authenticated;
