CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workflow_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type text NOT NULL,
  entity_id text NULL,
  entity_type text NULL,
  status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 0,
  session_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  abandoned_at timestamptz NULL,
  CONSTRAINT workflow_sessions_session_type_check CHECK (
    session_type IN (
      'dispatch_selection',
      'packing_list_wizard',
      'stock_movement_form',
      'contract_config',
      'item_edit'
    )
  ),
  CONSTRAINT workflow_sessions_status_check CHECK (
    status IN ('draft', 'in_progress', 'completed', 'abandoned')
  ),
  CONSTRAINT workflow_sessions_version_check CHECK (version >= 0)
);

CREATE INDEX IF NOT EXISTS idx_workflow_sessions_user_type
  ON public.workflow_sessions (user_id, session_type, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_workflow_sessions_one_active
  ON public.workflow_sessions (
    user_id,
    session_type,
    COALESCE(entity_type, ''),
    COALESCE(entity_id, '')
  )
  WHERE status IN ('draft', 'in_progress');

CREATE OR REPLACE FUNCTION public.set_workflow_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_sessions_updated_at ON public.workflow_sessions;
CREATE TRIGGER trg_workflow_sessions_updated_at
  BEFORE UPDATE ON public.workflow_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_workflow_sessions_updated_at();

ALTER TABLE public.workflow_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_workflow_sessions" ON public.workflow_sessions;
CREATE POLICY "users_manage_own_workflow_sessions"
  ON public.workflow_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "service_role_full_access_workflow_sessions" ON public.workflow_sessions;
CREATE POLICY "service_role_full_access_workflow_sessions"
  ON public.workflow_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
