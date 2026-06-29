-- Raise the messages.content length cap.
--
-- The original schema capped circle-chat content at 1000 chars
-- (`content TEXT NOT NULL CHECK (char_length(content) <= 1000)`, auto-named
-- `messages_content_check`). Agent/recovery messages — Use-Computer preflight
-- blocks, recovery-option cards, structured findings — routinely exceed that,
-- so the insert was rejected with a `messages_content_check` violation
-- (PostgREST HTTP 400). Long bot messages then failed to persist and vanished
-- on reload. Raise to a generous bound that still guards against unbounded
-- rows. Idempotent: drop the old constraint by name, add the new one.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (char_length(content) <= 100000);

NOTIFY pgrst, 'reload schema';
