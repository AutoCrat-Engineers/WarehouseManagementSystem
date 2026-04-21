DO $$ BEGIN
  CREATE TYPE public.session_status AS ENUM (
    'ACTIVE',
    'ENDED',
    'KILLED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.validate_active_session(
  p_session_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_status public.session_status;
  v_expires timestamp with time zone;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT user_id, status, expires_at
    INTO v_user_id, v_status, v_expires
    FROM public.global_sessions
   WHERE id = p_session_id;

  IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RETURN NULL;
  END IF;

  IF v_expires < now() THEN
    UPDATE public.global_sessions
       SET status = 'EXPIRED',
           ended_at = now(),
           ended_reason = 'TTL_EXCEEDED'
     WHERE id = p_session_id
       AND status = 'ACTIVE';

    RETURN NULL;
  END IF;

  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kill_other_sessions(
  p_user_id uuid,
  p_keep_session_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_killed integer;
BEGIN
  UPDATE public.global_sessions
     SET status = 'KILLED',
         ended_at = now(),
         ended_reason = 'CONCURRENT_LOGIN'
   WHERE user_id = p_user_id
     AND id <> p_keep_session_id
     AND status = 'ACTIVE';

  GET DIAGNOSTICS v_killed = ROW_COUNT;
  RETURN v_killed;
END;
$$;
