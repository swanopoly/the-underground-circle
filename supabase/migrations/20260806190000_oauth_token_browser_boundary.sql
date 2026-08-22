-- OAuth provider credentials are server authority, never browser data.
--
-- Both legacy tables stored usable provider tokens in plaintext columns. RLS
-- limited rows to their owner, but a same-origin script with the user's
-- Supabase session could still select a long-lived Google refresh token or a
-- GitHub access token through PostgREST. Edge functions already use the
-- service role for the OAuth lifecycle and safe metadata/operation endpoints.

BEGIN;

ALTER TABLE public.user_google_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_github_tokens ENABLE ROW LEVEL SECURITY;

DO $policy_cleanup$
DECLARE
  candidate record;
BEGIN
  FOR candidate IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('user_google_credentials', 'user_github_tokens')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      candidate.policyname,
      candidate.schemaname,
      candidate.tablename
    );
  END LOOP;
END
$policy_cleanup$;

REVOKE ALL ON TABLE public.user_google_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.user_github_tokens FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.user_google_credentials TO service_role;
GRANT ALL ON TABLE public.user_github_tokens TO service_role;

COMMENT ON TABLE public.user_google_credentials IS
  'Server-only Google OAuth credential store. Browser roles must use authenticated google-oauth actions.';
COMMENT ON TABLE public.user_github_tokens IS
  'Server-only GitHub OAuth credential store. Browser roles must use authenticated github-oauth actions.';

NOTIFY pgrst, 'reload schema';

COMMIT;
