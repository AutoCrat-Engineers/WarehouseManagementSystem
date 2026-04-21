ALTER TABLE public.global_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_sessions" ON public.global_sessions;
CREATE POLICY "users_see_own_sessions"
  ON public.global_sessions
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_role_full_access_sessions" ON public.global_sessions;
CREATE POLICY "service_role_full_access_sessions"
  ON public.global_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

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
