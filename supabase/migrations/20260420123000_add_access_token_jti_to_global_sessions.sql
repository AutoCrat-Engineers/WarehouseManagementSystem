ALTER TABLE public.global_sessions
  ADD COLUMN IF NOT EXISTS access_token_jti text;

CREATE INDEX IF NOT EXISTS idx_global_sessions_access_token_jti
  ON public.global_sessions (access_token_jti)
  WHERE access_token_jti IS NOT NULL;
