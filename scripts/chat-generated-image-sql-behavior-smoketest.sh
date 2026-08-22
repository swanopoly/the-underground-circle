#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
postgres_tmp="$(mktemp -d)"
postgres_port=55439

cleanup() {
  pg_ctl -D "$postgres_tmp/data" -m immediate stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

initdb -D "$postgres_tmp/data" -A trust -U postgres >/dev/null
pg_ctl -D "$postgres_tmp/data" -o "-k $postgres_tmp -h '' -p $postgres_port" -w start >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$postgres_tmp" -p "$postgres_port" -U postgres -d postgres <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.circles (id uuid PRIMARY KEY);
CREATE TABLE public.circle_chat_threads (
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  visibility text NOT NULL
);
CREATE TABLE public.circle_members (
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (circle_id, user_id)
);
CREATE TABLE public.circle_chat_thread_members (
  thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, user_id)
);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_bot boolean NOT NULL DEFAULT false
);
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text UNIQUE NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL
);
SQL

psql -X -v ON_ERROR_STOP=1 \
  -h "$postgres_tmp" -p "$postgres_port" -U postgres -d postgres \
  -f "$repo_root/supabase/migrations/20260820120000_chat_generated_images.sql" \
  >/dev/null

psql -X -v ON_ERROR_STOP=1 -h "$postgres_tmp" -p "$postgres_port" -U postgres -d postgres <<'SQL'
INSERT INTO auth.users(id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.circles(id) VALUES
  ('20000000-0000-4000-8000-000000000001');
INSERT INTO public.circle_members(circle_id,user_id) VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.circle_chat_threads(id,circle_id,created_by,visibility) VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','private');
INSERT INTO public.messages(id,circle_id,thread_id,user_id,is_bot) VALUES
  ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',false),
  ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',false);

INSERT INTO public.chat_generated_images(
  id,generation_scope,circle_id,thread_id,source_message_id,requested_by,
  provider,model,requested_model,prompt_sha256,storage_path,status
) VALUES (
  '50000000-0000-4000-8000-000000000001','chat',
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'openai','gpt-image-2','gpt-image-2',repeat('a',64),
  '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001',
  'pending'
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.chat_generated_images(
      id,generation_scope,circle_id,thread_id,source_message_id,requested_by,
      provider,model,prompt_sha256,storage_path,status
    ) VALUES (
      '50000000-0000-4000-8000-000000000002','chat',
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      'openai','gpt-image-2',repeat('b',64),
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002/50000000-0000-4000-8000-000000000002',
      'pending'
    );
    RAISE EXCEPTION 'forged requester insert unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.chat_generated_images SET
      status='ready', provider_started_at=now(), mime_type='image/png',
      size_bytes=8, width=1, height=1, sha256=repeat('c',64), completed_at=now()
    WHERE id='50000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'claim-plus-ready unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;

UPDATE public.chat_generated_images
SET provider_started_at=now()
WHERE id='50000000-0000-4000-8000-000000000001';

DO $test$
BEGIN
  BEGIN
    UPDATE public.chat_generated_images SET
      status='ready', mime_type='image/png', size_bytes=NULL,
      width=1, height=1, sha256=repeat('c',64), completed_at=now()
    WHERE id='50000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'NULL-incomplete ready receipt unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;

UPDATE public.chat_generated_images SET
  status='ready', provider_request_id='req_1', mime_type='image/png',
  size_bytes=8, width=1, height=1, sha256=repeat('c',64), completed_at=now()
WHERE id='50000000-0000-4000-8000-000000000001';

DO $test$
BEGIN
  BEGIN
    UPDATE public.chat_generated_images SET model='gpt-image-1'
    WHERE id='50000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'terminal receipt mutation unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$test$;

INSERT INTO public.chat_generated_images(
  id,generation_scope,circle_id,thread_id,source_message_id,requested_by,
  provider,model,prompt_sha256,storage_path,status
) VALUES (
  '50000000-0000-4000-8000-000000000003','chat',
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
  'openai','gpt-image-2',repeat('d',64),
  '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000003',
  'pending'
);
INSERT INTO public.chat_generated_images(
  id,generation_scope,circle_id,thread_id,source_message_id,requested_by,
  provider,model,prompt_sha256,storage_path,status
) VALUES (
  '50000000-0000-4000-8000-000000000004','terminal',
  '20000000-0000-4000-8000-000000000001',NULL,NULL,
  '10000000-0000-4000-8000-000000000001','openai','gpt-image-2',repeat('e',64),
  '20000000-0000-4000-8000-000000000001/_terminal/10000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000004',
  'pending'
);

DELETE FROM public.circle_members
WHERE circle_id='20000000-0000-4000-8000-000000000001'
  AND user_id='10000000-0000-4000-8000-000000000001';

DO $test$
BEGIN
  BEGIN
    UPDATE public.chat_generated_images SET provider_started_at=now()
    WHERE id='50000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'revoked Chat requester claim unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.chat_generated_images SET provider_started_at=now()
    WHERE id='50000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'revoked terminal requester claim unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;

DO $test$
DECLARE
  is_private boolean;
BEGIN
  SELECT NOT public
    AND file_size_limit=20971520
    AND allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp']::text[]
  INTO is_private
  FROM storage.buckets
  WHERE id='chat-generated-images';
  IF is_private IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'private bucket contract missing';
  END IF;
END
$test$;

SELECT 'chat generated image migration behavior passed' AS result;
SQL

echo "chat-generated-image SQL behavior smoke passed"
