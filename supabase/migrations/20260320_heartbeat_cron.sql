-- Schedule heartbeat agent to run every 30 minutes
-- Uses pg_cron + pg_net to call the edge function

-- Enable pg_net if not already
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create heartbeat cron job (every 30 minutes)
SELECT cron.schedule(
  'heartbeat-agent',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/heartbeat-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- If vault secrets aren't set up, use this simpler version instead:
-- (Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY with actual values)
--
-- SELECT cron.schedule(
--   'heartbeat-agent',
--   '*/30 * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/heartbeat-agent',
--     headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
--     body := '{}'::jsonb
--   );
--   $$
-- );
