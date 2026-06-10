CREATE TABLE IF NOT EXISTS public.assistant_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'preference' CHECK (kind IN ('preference', 'correction', 'fact', 'rule')),
  content text NOT NULL,
  importance integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view assistant memories" ON public.assistant_memories;
DROP POLICY IF EXISTS "Users can insert assistant memories" ON public.assistant_memories;
DROP POLICY IF EXISTS "Users can delete assistant memories" ON public.assistant_memories;

CREATE POLICY "Users can view assistant memories"
  ON public.assistant_memories
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert assistant memories"
  ON public.assistant_memories
  FOR INSERT
  WITH CHECK (public.has_company_access(company_id));

CREATE POLICY "Users can delete assistant memories"
  ON public.assistant_memories
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));


CREATE TABLE IF NOT EXISTS public.assistant_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  user_message text NOT NULL,
  assistant_message text NOT NULL,
  rating integer NOT NULL CHECK (rating IN (-1, 1)),
  correction text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view assistant feedback" ON public.assistant_feedback;
DROP POLICY IF EXISTS "Users can insert assistant feedback" ON public.assistant_feedback;
DROP POLICY IF EXISTS "Users can delete assistant feedback" ON public.assistant_feedback;

CREATE POLICY "Users can view assistant feedback"
  ON public.assistant_feedback
  FOR SELECT
  USING (public.has_company_access(company_id));

CREATE POLICY "Users can insert assistant feedback"
  ON public.assistant_feedback
  FOR INSERT
  WITH CHECK (public.has_company_access(company_id));

CREATE POLICY "Users can delete assistant feedback"
  ON public.assistant_feedback
  FOR DELETE
  USING (public.is_admin_or_editor(company_id));

