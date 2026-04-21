-- Reconcile an existing public.global_sessions/auth_login_activity schema
-- with the auth edge functions that are already using public.global_sessions.

DO $$ BEGIN
  CREATE TYPE public.session_status AS ENUM (
    'ACTIVE',
    'ENDED',
    'KILLED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

CREATE TABLE IF NOT EXISTS public.global_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.global_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS started_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + INTERVAL '24 hours'),
  ADD COLUMN IF NOT EXISTS ended_reason text,
  ADD COLUMN IF NOT EXISTS login_ip varchar(45),
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'global_sessions'
      AND column_name = 'status'
      AND udt_name <> 'session_status'
  ) THEN
    ALTER TABLE public.global_sessions
      ALTER COLUMN status DROP DEFAULT;

    ALTER TABLE public.global_sessions
      ALTER COLUMN status TYPE public.session_status
      USING (
        CASE upper(coalesce(status::text, 'ACTIVE'))
          WHEN 'ACTIVE' THEN 'ACTIVE'::public.session_status
          WHEN 'ENDED' THEN 'ENDED'::public.session_status
          WHEN 'KILLED' THEN 'KILLED'::public.session_status
          WHEN 'EXPIRED' THEN 'EXPIRED'::public.session_status
          ELSE 'ACTIVE'::public.session_status
        END
      );
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'global_sessions'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE public.global_sessions
      ADD COLUMN status public.session_status;
  END IF;
END $$;

UPDATE public.global_sessions
   SET started_at = coalesce(started_at, created_at, now()),
       created_at = coalesce(created_at, started_at, now()),
       expires_at = coalesce(expires_at, coalesce(started_at, now()) + INTERVAL '24 hours'),
       status = coalesce(status, 'ACTIVE'::public.session_status);

ALTER TABLE public.global_sessions
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'ACTIVE',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN started_at SET DEFAULT now(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '24 hours');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'global_sessions_user_id_fkey'
      AND conrelid = 'public.global_sessions'::regclass
  ) THEN
    ALTER TABLE public.global_sessions
      ADD CONSTRAINT global_sessions_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'global_sessions_ended_after_started'
      AND conrelid = 'public.global_sessions'::regclass
  ) THEN
    ALTER TABLE public.global_sessions
      ADD CONSTRAINT global_sessions_ended_after_started
      CHECK (ended_at IS NULL OR ended_at >= started_at) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'global_sessions_expires_after_started'
      AND conrelid = 'public.global_sessions'::regclass
  ) THEN
    ALTER TABLE public.global_sessions
      ADD CONSTRAINT global_sessions_expires_after_started
      CHECK (expires_at > started_at) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'global_sessions_ended_reason_required'
      AND conrelid = 'public.global_sessions'::regclass
  ) THEN
    ALTER TABLE public.global_sessions
      ADD CONSTRAINT global_sessions_ended_reason_required
      CHECK (
        status = 'ACTIVE'
        OR (status <> 'ACTIVE' AND ended_reason IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_global_sessions_user_id
  ON public.global_sessions (user_id);

DROP INDEX IF EXISTS uidx_global_sessions_one_active_per_user;
CREATE UNIQUE INDEX uidx_global_sessions_one_active_per_user
  ON public.global_sessions (user_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_global_sessions_expires_at
  ON public.global_sessions (expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.auth_login_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

ALTER TABLE public.auth_login_activity
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS identifier varchar(320),
  ADD COLUMN IF NOT EXISTS normalized_identifier varchar(320),
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS success boolean,
  ADD COLUMN IF NOT EXISTS failure_code varchar(64),
  ADD COLUMN IF NOT EXISTS source varchar(32) DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS ip_address varchar(45),
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_login_activity'
      AND column_name = 'event_type'
      AND udt_name <> 'login_event_type'
  ) THEN
    ALTER TABLE public.auth_login_activity
      ALTER COLUMN event_type DROP DEFAULT;

    ALTER TABLE public.auth_login_activity
      ALTER COLUMN event_type TYPE public.login_event_type
      USING (
        CASE upper(coalesce(event_type::text, 'LOGIN_FAILED'))
          WHEN 'LOGIN_SUCCESS' THEN 'LOGIN_SUCCESS'::public.login_event_type
          WHEN 'LOGIN_FAILED' THEN 'LOGIN_FAILED'::public.login_event_type
          WHEN 'LOGOUT' THEN 'LOGOUT'::public.login_event_type
          WHEN 'SESSION_EXPIRED' THEN 'SESSION_EXPIRED'::public.login_event_type
          WHEN 'SESSION_KILLED' THEN 'SESSION_KILLED'::public.login_event_type
          WHEN 'PASSWORD_RESET' THEN 'PASSWORD_RESET'::public.login_event_type
          WHEN 'TOKEN_REFRESH' THEN 'TOKEN_REFRESH'::public.login_event_type
          ELSE 'LOGIN_FAILED'::public.login_event_type
        END
      );
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_login_activity'
      AND column_name = 'event_type'
  ) THEN
    ALTER TABLE public.auth_login_activity
      ADD COLUMN event_type public.login_event_type;
  END IF;
END $$;

UPDATE public.auth_login_activity
   SET occurred_at = coalesce(occurred_at, now()),
       success = coalesce(success, false),
       source = coalesce(source, 'web'),
       metadata = coalesce(metadata, '{}'::jsonb);

ALTER TABLE public.auth_login_activity
  ALTER COLUMN occurred_at SET NOT NULL,
  ALTER COLUMN occurred_at SET DEFAULT now(),
  ALTER COLUMN event_type SET NOT NULL,
  ALTER COLUMN success SET NOT NULL,
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'web',
  ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_login_activity_user_id_fkey'
      AND conrelid = 'public.auth_login_activity'::regclass
  ) THEN
    ALTER TABLE public.auth_login_activity
      ADD CONSTRAINT auth_login_activity_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_login_activity_session_id_fkey'
      AND conrelid = 'public.auth_login_activity'::regclass
  ) THEN
    ALTER TABLE public.auth_login_activity
      ADD CONSTRAINT auth_login_activity_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.global_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_login_activity_failure_code_check'
      AND conrelid = 'public.auth_login_activity'::regclass
  ) THEN
    ALTER TABLE public.auth_login_activity
      ADD CONSTRAINT auth_login_activity_failure_code_check
      CHECK (success = true OR failure_code IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_login_activity_session_id_check'
      AND conrelid = 'public.auth_login_activity'::regclass
  ) THEN
    ALTER TABLE public.auth_login_activity
      ADD CONSTRAINT auth_login_activity_session_id_check
      CHECK (success = false OR session_id IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_login_activity_source_check'
      AND conrelid = 'public.auth_login_activity'::regclass
  ) THEN
    ALTER TABLE public.auth_login_activity
      ADD CONSTRAINT auth_login_activity_source_check
      CHECK (source IN ('web', 'mobile', 'api', 'sso', 'system')) NOT VALID;
  END IF;
END $$;

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
