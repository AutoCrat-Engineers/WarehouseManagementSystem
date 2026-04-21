DO $$ BEGIN
  CREATE TYPE public.login_event_type AS ENUM (
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'LOGOUT',
    'SESSION_EXPIRED',
    'SESSION_KILLED',
    'PASSWORD_RESET',
    'TOKEN_REFRESH'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.auth_login_activity (
  id                    uuid                      NOT NULL DEFAULT gen_random_uuid(),
  occurred_at           timestamp with time zone  NOT NULL DEFAULT now(),
  identifier            character varying(320),
  normalized_identifier character varying(320),
  user_id               uuid,
  event_type            public.login_event_type   NOT NULL,
  success               boolean                   NOT NULL,
  failure_code          character varying(64),
  source                character varying(32)     NOT NULL DEFAULT 'web',
  ip_address            character varying(45),
  user_agent            text,
  session_id            uuid,
  metadata              jsonb                     NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT auth_login_activity_pkey
    PRIMARY KEY (id),

  CONSTRAINT auth_login_activity_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users (id)
    ON DELETE SET NULL,

  CONSTRAINT auth_login_activity_session_id_fkey
    FOREIGN KEY (session_id)
    REFERENCES public.global_sessions (id)
    ON DELETE SET NULL,

  CONSTRAINT auth_login_activity_failure_code_check
    CHECK (success = true OR failure_code IS NOT NULL),

  CONSTRAINT auth_login_activity_session_id_check
    CHECK (success = false OR session_id IS NOT NULL),

  CONSTRAINT auth_login_activity_source_check
    CHECK (source IN ('web', 'mobile', 'api', 'sso', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_auth_login_activity_user_id
  ON public.auth_login_activity (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_login_activity_normalized_identifier
  ON public.auth_login_activity (normalized_identifier, occurred_at DESC)
  WHERE success = false;

CREATE INDEX IF NOT EXISTS idx_auth_login_activity_ip_occurred
  ON public.auth_login_activity (ip_address, occurred_at DESC)
  WHERE success = false;

CREATE INDEX IF NOT EXISTS idx_auth_login_activity_occurred_at
  ON public.auth_login_activity (occurred_at DESC);

ALTER TABLE public.auth_login_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_login_activity" ON public.auth_login_activity;
CREATE POLICY "users_see_own_login_activity"
  ON public.auth_login_activity
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_role_full_access_login_activity" ON public.auth_login_activity;
CREATE POLICY "service_role_full_access_login_activity"
  ON public.auth_login_activity
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
