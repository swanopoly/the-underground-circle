/**
 * Source + disposable-PostgreSQL proof for SQL §40 attachment visibility and
 * private Storage integrity.
 *
 * Run:
 *   npx tsx scripts/message-attachment-visibility-integrity-smoketest.ts
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260813170000_message_attachment_visibility_integrity.sql',
);
const linkMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260813160000_message_attachment_link_integrity.sql',
);
const consolidatedPath = resolve(process.cwd(), 'docs/RUN_THIS_SQL.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');
const consolidatedSql = readFileSync(consolidatedPath, 'utf8');

let assertions = 0;
let postgresAssertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function has(source: string, value: string, message: string): void {
  check(source.includes(value), message);
}

function section(start: string, end: string): string {
  const startIndex = migrationSql.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = migrationSql.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return migrationSql.slice(startIndex, endIndex);
}

// ── Static authority, convergence, and no-cleanup contract ────────────────

has(migrationSql, 'BEGIN;', 'migration is transactional');
has(migrationSql, 'apply SQL section 39 and canonical message-thread RLS first', '§39 and message-thread dependencies fail closed');
has(migrationSql, "trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'", 'readiness requires the §39 immutable-link trigger');
check(!/UPDATE\s+public\.message_attachments\b/i.test(migrationSql), '§40 never rewrites legacy attachment rows');
check(!/DELETE\s+FROM\s+public\.message_attachments\b/i.test(migrationSql), '§40 never deletes legacy attachment rows');
has(migrationSql, 'invalid legacy storage path; inspect before applying', 'invalid legacy paths abort for operator inspection');
has(migrationSql, 'duplicate legacy storage path; inspect before applying', 'duplicate legacy paths abort for operator inspection');
has(migrationSql, 'missing or owner-mismatched legacy storage object; inspect before applying', 'missing or mismatched objects abort without cleanup');

const pathHelper = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_path_matches_row_v1(',
  'REVOKE ALL ON FUNCTION public.message_attachment_storage_path_matches_row_v1',
);
has(pathHelper, "array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4", 'path has exactly four segments');
has(pathHelper, "split_part(p_name, '/', 1) = p_circle_id::text", 'path binds exact circle');
has(pathHelper, "split_part(p_name, '/', 2) = COALESCE(p_thread_id::text, '_direct')", 'path binds exact nullable thread');
has(pathHelper, "split_part(p_name, '/', 3) = p_user_id::text", 'path binds exact owner');
has(pathHelper, "split_part(p_name, '/', 4) ~*", 'path requires a UUID-prefixed safe basename');
has(migrationSql, 'message_attachments_storage_path_matches_scope_v1', 'path identity is a checked row constraint');
has(migrationSql, 'CREATE UNIQUE INDEX message_attachments_storage_path_unique_v1', 'one storage path maps to at most one metadata row');

has(migrationSql, 'INSERT INTO storage.buckets (id, name, public, file_size_limit)', 'private bucket is created when absent');
has(migrationSql, 'ON CONFLICT (id) DO UPDATE', 'private bucket settings converge idempotently');
has(migrationSql, 'public = false', 'bucket converges to private');
has(migrationSql, 'file_size_limit = 52428800', 'bucket converges to the 50 MiB limit');
has(migrationSql, 'bucket identity mismatch; inspect before applying', 'ambiguous bucket identity aborts without replacement');
has(migrationSql, 'Hosted Supabase owns storage.objects through supabase_storage_admin', 'migration respects hosted Storage table ownership');
check(!migrationSql.includes('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'), 'migration does not ALTER the platform-owned Storage table');

const objectMatchHelper = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_matches_row_v1(',
  'REVOKE ALL ON FUNCTION public.message_attachment_storage_object_matches_row_v1',
);
has(objectMatchHelper, 'SECURITY DEFINER', 'object binding can inspect private Storage without caller object visibility');
has(objectMatchHelper, 'p_user_id = auth.uid()', 'object binding is not a cross-user existence oracle');
has(objectMatchHelper, "object_row.bucket_id = 'chat-attachments'", 'object binding requires the exact bucket');
has(objectMatchHelper, 'object_row.name = p_name', 'object binding requires the exact path');
has(objectMatchHelper, 'object_row.owner_id::text = p_user_id::text', 'object binding requires the exact Storage owner');

const visibilityHelper = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_row_visible_v1(',
  'REVOKE ALL ON FUNCTION public.message_attachment_row_visible_v1',
);
has(visibilityHelper, 'p_message_id IS NULL', 'staged visibility is explicit');
has(visibilityHelper, 'p_user_id = auth.uid()', 'staged rows are owner-only');
has(visibilityHelper, 'message_thread_visible_to_current_user(p_circle_id, p_thread_id)', 'linked rows follow current private/shared/circle thread visibility');
has(visibilityHelper, 'target_message.id = p_message_id', 'linked visibility binds the exact message');
has(visibilityHelper, 'target_message.circle_id = p_circle_id', 'linked visibility binds the exact circle');
has(visibilityHelper, 'target_message.thread_id = p_thread_id', 'linked visibility binds the exact thread');
has(visibilityHelper, 'target_message.user_id = p_user_id', 'linked visibility binds the message author and attachment owner');
has(visibilityHelper, 'COALESCE(target_message.is_bot, false) = false', 'linked visibility excludes forged bot targets');

has(migrationSql, "FROM pg_catalog.pg_policies\n    WHERE schemaname = 'public'", 'all historical attachment-table policy drift is enumerated');
has(migrationSql, "'DROP POLICY %I ON public.message_attachments'", 'historical attachment policies are converged');
for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
  has(migrationSql, `message_attachments_anon_${operation}_deny_v1`, `anon ${operation} has an explicit restrictive denial`);
}
check((migrationSql.match(/ON public\.message_attachments\nAS RESTRICTIVE/g) || []).length === 8, 'table has four authenticated guards and four anon denials');
has(migrationSql, 'GRANT ALL ON TABLE public.message_attachments TO service_role;', 'trusted service maintenance retains an explicit grant');

const storageInsert = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_insert_authorized_v1(',
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_visible_v1(',
);
has(storageInsert, "split_part(p_name, '/', 3) = auth.uid()::text", 'storage insert path is owner-bound');
has(storageInsert, 'membership.user_id = auth.uid()', 'storage insert requires current circle membership');
has(storageInsert, 'message_thread_visible_to_current_user(', 'storage insert requires current thread visibility');

const storageVisible = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_visible_v1(',
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_owned_v1(',
);
has(storageVisible, 'attachment.storage_path = p_name', 'storage SELECT binds the exact metadata path');
has(storageVisible, 'attachment.user_id::text = p_owner_id', 'storage SELECT binds metadata owner to object owner');
has(storageVisible, 'message_attachment_row_visible_v1(', 'storage SELECT reuses exact row visibility');

const storageOwned = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_owned_v1(',
  'REVOKE ALL ON FUNCTION public.message_attachment_storage_insert_authorized_v1',
);
has(storageOwned, 'p_owner_id = auth.uid()::text', 'storage DELETE requires the exact object owner');
has(storageOwned, 'attachment.user_id = auth.uid()', 'storage DELETE requires the exact metadata owner');
has(storageOwned, 'message_attachment_row_visible_v1(', 'storage DELETE requires current row visibility');

for (const operation of ['select', 'insert', 'update', 'delete'] as const) {
  has(migrationSql, `chat_attachments_${operation}_guard_v1`, `authenticated storage ${operation} has a restrictive bucket guard`);
  has(migrationSql, `chat_attachments_anon_${operation}_deny_v1`, `anon storage ${operation} has an explicit restrictive denial`);
}
has(migrationSql, 'USING (bucket_id <> \'chat-attachments\')\nWITH CHECK (bucket_id <> \'chat-attachments\');', 'authenticated UPDATE is impossible for the private bucket');
has(migrationSql, 'AS attachment_bucket_private_ready', 'readiness inspects private bucket settings');
has(migrationSql, 'AS attachment_table_policies_converged', 'readiness inspects exact table policy counts, commands, roles, and clauses');
has(migrationSql, 'AS attachment_storage_policies_converged', 'readiness inspects exact Storage policy counts, commands, roles, and clauses');
has(migrationSql, 'qual IS NOT NULL', 'readiness inspects USING clauses');
has(migrationSql, 'with_check IS NOT NULL', 'readiness inspects WITH CHECK clauses');

const migrationTransaction = migrationSql.slice(
  migrationSql.indexOf('BEGIN;'),
  migrationSql.indexOf("NOTIFY pgrst, 'reload schema';") + "NOTIFY pgrst, 'reload schema';".length,
);
check(migrationTransaction.startsWith('BEGIN;'), 'transaction is locatable for parity');
check(consolidatedSql.includes('-- §40. Message-attachment visibility and Storage integrity (2026-08-13)'), 'consolidated SQL registers §40');
check(consolidatedSql.includes(migrationSql.trim()), '§40 mirrors the complete migration exactly');

// ── Disposable PostgreSQL behavior ────────────────────────────────────────

function commandAvailable(command: string): boolean {
  return spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
}

const postgresTools = ['initdb', 'pg_ctl', 'psql'];
if (postgresTools.every(commandAvailable)) {
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const workspaceOwner = runningAsRoot
    ? execFileSync('id', ['-nu', String(statSync(process.cwd()).uid)], { encoding: 'utf8' }).trim()
    : '';
  const tempRoot = runningAsRoot
    ? execFileSync(
      'sudo',
      ['-n', '-u', workspaceOwner, 'mktemp', '-d', '/tmp/uc-attachment-visibility-sql-XXXXXX'],
      { encoding: 'utf8' },
    ).trim()
    : mkdtempSync('/tmp/uc-attachment-visibility-sql-');
  const dataDir = resolve(tempRoot, 'data');
  const socketDir = resolve(tempRoot, 'socket');
  const port = String(55_000 + (process.pid % 1_000));
  const pgEnv = {
    ...process.env,
    PGHOST: socketDir,
    PGPORT: port,
    PGDATABASE: 'postgres',
    PGUSER: workspaceOwner || process.env.USER || 'postgres',
  };
  let serverStarted = false;

  const run = (command: string, args: string[]): string => {
    const executable = runningAsRoot ? 'sudo' : command;
    const commandArgs = runningAsRoot
      ? [
        '-n', '-u', workspaceOwner,
        'env',
        `PGHOST=${pgEnv.PGHOST}`,
        `PGPORT=${pgEnv.PGPORT}`,
        `PGDATABASE=${pgEnv.PGDATABASE}`,
        `PGUSER=${pgEnv.PGUSER}`,
        command,
        ...args,
      ]
      : args;
    return execFileSync(executable, commandArgs, {
      env: pgEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  const sql = (value: string): string => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', value]);
  const roleSql = (role: 'authenticated' | 'anon' | 'service_role', userId: string | null, statement: string): string => sql(`
    SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${userId || ''}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);
    ${statement}
  `);
  const asUser = (userId: string, statement: string): string => roleSql('authenticated', userId, statement);
  const asAnon = (statement: string): string => roleSql('anon', null, statement);
  const expectDenied = (
    role: 'authenticated' | 'anon',
    userId: string | null,
    statement: string,
    reason: string,
    expected: RegExp,
  ): void => {
    const psqlArgs = ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', `
      SET ROLE ${role};
      SELECT set_config('request.jwt.claim.sub', '${userId || ''}', false);
      SELECT set_config('request.jwt.claim.role', '${role}', false);
      ${statement}
    `];
    const executable = runningAsRoot ? 'sudo' : 'psql';
    const commandArgs = runningAsRoot
      ? [
        '-n', '-u', workspaceOwner,
        'env',
        `PGHOST=${pgEnv.PGHOST}`,
        `PGPORT=${pgEnv.PGPORT}`,
        `PGDATABASE=${pgEnv.PGDATABASE}`,
        `PGUSER=${pgEnv.PGUSER}`,
        'psql',
        ...psqlArgs,
      ]
      : psqlArgs;
    const result = spawnSync(executable, commandArgs, { env: pgEnv, encoding: 'utf8' });
    check(result.status !== 0, `${reason} is rejected by PostgreSQL`);
    check(expected.test(result.stderr), `${reason} fails at the intended policy/integrity boundary`);
    postgresAssertions += 2;
  };
  const runMigration = (): void => {
    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);
  };
  const expectMigrationFailure = (expected: RegExp, reason: string): void => {
    const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath];
    const executable = runningAsRoot ? 'sudo' : 'psql';
    const commandArgs = runningAsRoot
      ? [
        '-n', '-u', workspaceOwner,
        'env',
        `PGHOST=${pgEnv.PGHOST}`,
        `PGPORT=${pgEnv.PGPORT}`,
        `PGDATABASE=${pgEnv.PGDATABASE}`,
        `PGUSER=${pgEnv.PGUSER}`,
        'psql',
        ...args,
      ]
      : args;
    const result = spawnSync(executable, commandArgs, { env: pgEnv, encoding: 'utf8' });
    check(result.status !== 0, `${reason} aborts the migration`);
    check(expected.test(result.stderr), `${reason} reports its exact preflight boundary`);
    postgresAssertions += 2;
  };

  const U1 = '10000000-0000-4000-8000-000000000001';
  const U2 = '10000000-0000-4000-8000-000000000002';
  const C1 = '20000000-0000-4000-8000-000000000001';
  const TC = '30000000-0000-4000-8000-000000000001';
  const TP = '30000000-0000-4000-8000-000000000002';
  const TS = '30000000-0000-4000-8000-000000000003';
  const TL = '30000000-0000-4000-8000-000000000004';
  const MC = '40000000-0000-4000-8000-000000000001';
  const MP = '40000000-0000-4000-8000-000000000002';
  const MS = '40000000-0000-4000-8000-000000000003';
  const ML = '40000000-0000-4000-8000-000000000004';
  const A_STAGE = '50000000-0000-4000-8000-000000000001';
  const A_PRIVATE = '50000000-0000-4000-8000-000000000002';
  const A_SHARED = '50000000-0000-4000-8000-000000000003';
  const A_CIRCLE = '50000000-0000-4000-8000-000000000004';
  const A_LOST = '50000000-0000-4000-8000-000000000005';
  const A_DELETE = '50000000-0000-4000-8000-000000000006';
  const A_LINK = '50000000-0000-4000-8000-000000000007';
  const A_U2 = '50000000-0000-4000-8000-000000000008';
  const A_INVALID = '50000000-0000-4000-8000-000000000009';
  const A_MISSING = '50000000-0000-4000-8000-000000000010';
  const A_DUP1 = '50000000-0000-4000-8000-000000000011';
  const A_DUP2 = '50000000-0000-4000-8000-000000000012';
  const fileSegment = (seed: number, name: string): string => `60000000-0000-4000-8000-${String(seed).padStart(12, '0')}-${name}`;
  const path = (thread: string, user: string, seed: number, name: string): string => `${C1}/${thread}/${user}/${fileSegment(seed, name)}`;
  const P_STAGE = path(TP, U1, 1, 'stage.pdf');
  const P_PRIVATE = path(TP, U1, 2, 'private.pdf');
  const P_SHARED = path(TS, U1, 3, 'shared.pdf');
  const P_CIRCLE = path(TC, U1, 4, 'circle.pdf');
  const P_LOST = path(TL, U1, 5, 'lost.pdf');
  const P_DELETE = path(TC, U1, 6, 'delete.pdf');
  const P_LINK = path(TC, U1, 7, 'link.pdf');
  const P_U2 = path(TS, U2, 8, 'u2.pdf');
  const P_MISSING = path(TC, U1, 10, 'missing.pdf');
  const P_DUP = path(TC, U1, 11, 'duplicate.pdf');

  try {
    run('initdb', ['-D', dataDir, '-A', 'trust', '--no-locale', '--encoding=UTF8']);
    run('mkdir', ['-p', socketDir]);
    run('pg_ctl', [
      '-D', dataDir,
      '-o', `-F -k ${socketDir} -p ${port} -c listen_addresses=''`,
      '-l', resolve(tempRoot, 'postgres.log'),
      '-w', 'start',
    ]);
    serverStarted = true;

    sql(`
      CREATE SCHEMA auth;
      CREATE SCHEMA storage;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;

      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user) $$;

      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint
      );
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY,
        bucket_id text NOT NULL,
        name text NOT NULL,
        owner_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (bucket_id, name)
      );
      CREATE TABLE public.circle_members (
        circle_id uuid NOT NULL,
        user_id uuid NOT NULL,
        PRIMARY KEY (circle_id, user_id)
      );
      CREATE TABLE public.circle_chat_threads (
        id uuid PRIMARY KEY,
        circle_id uuid NOT NULL,
        created_by uuid NOT NULL,
        visibility text NOT NULL
      );
      CREATE TABLE public.circle_chat_thread_members (
        thread_id uuid NOT NULL,
        user_id uuid NOT NULL,
        PRIMARY KEY (thread_id, user_id)
      );
      CREATE TABLE public.messages (
        id uuid PRIMARY KEY,
        circle_id uuid NOT NULL,
        thread_id uuid NOT NULL,
        user_id uuid NOT NULL,
        is_bot boolean DEFAULT false
      );
      CREATE TABLE public.message_attachments (
        id uuid PRIMARY KEY,
        message_id uuid,
        circle_id uuid NOT NULL,
        thread_id uuid,
        user_id uuid NOT NULL,
        storage_path text NOT NULL,
        original_name text NOT NULL,
        mime_type text NOT NULL DEFAULT 'application/octet-stream',
        size_bytes integer NOT NULL DEFAULT 0,
        extract_text text,
        ocr_text text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE FUNCTION public.message_thread_visible_to_current_user(p_circle_id uuid, p_thread_id uuid)
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
        SELECT auth.uid() IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.circle_members AS membership
          JOIN public.circle_chat_threads AS thread
            ON thread.id = p_thread_id AND thread.circle_id = p_circle_id
          WHERE membership.circle_id = p_circle_id
            AND membership.user_id = auth.uid()
            AND (
              thread.visibility = 'circle'
              OR thread.created_by = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.circle_chat_thread_members AS member
                WHERE member.thread_id = thread.id AND member.user_id = auth.uid()
              )
            )
        )
      $$;

      ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY messages_visible_for_test ON public.messages
      FOR SELECT TO authenticated
      USING (public.message_thread_visible_to_current_user(circle_id, thread_id));
      ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY legacy_attachment_public_all ON public.message_attachments
      FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY hostile_storage_public_all ON storage.objects
      FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

      GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) TO authenticated;
      GRANT SELECT ON public.circle_members, public.circle_chat_threads, public.circle_chat_thread_members, public.messages TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_attachments TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO service_role;
    `);

    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', linkMigrationPath]);

    sql(`
      INSERT INTO public.circle_members VALUES ('${C1}', '${U1}'), ('${C1}', '${U2}');
      INSERT INTO public.circle_chat_threads VALUES
        ('${TC}', '${C1}', '${U1}', 'circle'),
        ('${TP}', '${C1}', '${U1}', 'private'),
        ('${TS}', '${C1}', '${U1}', 'shared'),
        ('${TL}', '${C1}', '${U1}', 'shared');
      INSERT INTO public.circle_chat_thread_members VALUES ('${TS}', '${U2}'), ('${TL}', '${U2}');
      INSERT INTO public.messages VALUES
        ('${MC}', '${C1}', '${TC}', '${U1}', false),
        ('${MP}', '${C1}', '${TP}', '${U1}', false),
        ('${MS}', '${C1}', '${TS}', '${U1}', false),
        ('${ML}', '${C1}', '${TL}', '${U1}', false);

      INSERT INTO storage.buckets (id, name, public, file_size_limit)
      VALUES ('chat-attachments', 'chat-attachments', true, 1);
      INSERT INTO storage.objects (id, bucket_id, name, owner_id) VALUES
        ('70000000-0000-4000-8000-000000000001', 'chat-attachments', '${P_STAGE}', '${U1}'),
        ('70000000-0000-4000-8000-000000000002', 'chat-attachments', '${P_PRIVATE}', '${U1}'),
        ('70000000-0000-4000-8000-000000000003', 'chat-attachments', '${P_SHARED}', '${U1}'),
        ('70000000-0000-4000-8000-000000000004', 'chat-attachments', '${P_CIRCLE}', '${U1}'),
        ('70000000-0000-4000-8000-000000000005', 'chat-attachments', '${P_LOST}', '${U1}'),
        ('70000000-0000-4000-8000-000000000006', 'chat-attachments', '${P_DELETE}', '${U1}'),
        ('70000000-0000-4000-8000-000000000007', 'chat-attachments', '${P_LINK}', '${U1}');
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes, extract_text)
      VALUES
        ('${A_STAGE}', NULL, '${C1}', '${TP}', '${U1}', '${P_STAGE}', 'stage.pdf', 'application/pdf', 10, 'private staged text'),
        ('${A_PRIVATE}', '${MP}', '${C1}', '${TP}', '${U1}', '${P_PRIVATE}', 'private.pdf', 'application/pdf', 11, 'private linked text'),
        ('${A_SHARED}', '${MS}', '${C1}', '${TS}', '${U1}', '${P_SHARED}', 'shared.pdf', 'application/pdf', 12, 'shared linked text'),
        ('${A_CIRCLE}', '${MC}', '${C1}', '${TC}', '${U1}', '${P_CIRCLE}', 'circle.pdf', 'application/pdf', 13, 'circle linked text'),
        ('${A_LOST}', '${ML}', '${C1}', '${TL}', '${U1}', '${P_LOST}', 'lost.pdf', 'application/pdf', 14, 'lost linked text'),
        ('${A_DELETE}', '${MC}', '${C1}', '${TC}', '${U1}', '${P_DELETE}', 'delete.pdf', 'application/pdf', 15, NULL),
        ('${A_LINK}', NULL, '${C1}', '${TC}', '${U1}', '${P_LINK}', 'link.pdf', 'application/pdf', 16, NULL);
    `);

    runMigration();
    runMigration();

    check(sql(`SELECT public, file_size_limit FROM storage.buckets WHERE id = 'chat-attachments';`).trim() === 'f|52428800', 'bucket converges from public/1 byte to private/50 MiB');
    postgresAssertions += 1;
    check(sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'message_attachments';`).trim() === '12', 'reapply converges exactly twelve table policies');
    postgresAssertions += 1;
    check(sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'chat_attachments_%_v1';`).trim() === '11', 'reapply converges exactly eleven named Storage policies');
    postgresAssertions += 1;

    check(asUser(U1, `SELECT count(*) FROM public.message_attachments;`).trim().endsWith('7'), 'owner sees staged and every linked private/shared/circle row');
    postgresAssertions += 1;
    check(asUser(U2, `SELECT string_agg(id::text, ',' ORDER BY id) FROM public.message_attachments;`).includes(A_SHARED), 'shared-thread member sees the linked shared attachment');
    postgresAssertions += 1;
    check(asUser(U2, `SELECT count(*) FROM public.message_attachments WHERE id = '${A_CIRCLE}';`).trim().endsWith('1'), 'circle member sees the linked circle attachment');
    postgresAssertions += 1;
    check(asUser(U2, `SELECT count(*) FROM public.message_attachments WHERE id IN ('${A_STAGE}', '${A_PRIVATE}');`).trim().endsWith('0'), 'foreign staged and private-thread rows stay hidden');
    postgresAssertions += 1;
    check(asUser(U2, `SELECT count(*) FROM storage.objects WHERE name = '${P_SHARED}';`).trim().endsWith('1'), 'shared-thread member may read the exact shared Storage object');
    postgresAssertions += 1;
    check(asUser(U2, `SELECT count(*) FROM storage.objects WHERE name IN ('${P_STAGE}', '${P_PRIVATE}');`).trim().endsWith('0'), 'foreign staged and private Storage objects stay hidden');
    postgresAssertions += 1;

    sql(`DELETE FROM public.circle_chat_thread_members WHERE thread_id = '${TL}' AND user_id = '${U2}';`);
    check(asUser(U2, `SELECT count(*) FROM public.message_attachments WHERE id = '${A_LOST}';`).trim().endsWith('0'), 'thread-membership loss immediately removes metadata visibility');
    postgresAssertions += 1;
    check(asUser(U2, `SELECT count(*) FROM storage.objects WHERE name = '${P_LOST}';`).trim().endsWith('0'), 'thread-membership loss immediately removes Storage visibility');
    postgresAssertions += 1;

    check(asUser(U1, `UPDATE public.message_attachments SET message_id = '${MC}' WHERE id = '${A_LINK}' RETURNING message_id;`).trim().endsWith(MC), '§39 exact staged-link transition remains compatible under §40');
    postgresAssertions += 1;
    check(asUser(U1, `UPDATE public.message_attachments SET ocr_text = 'verified OCR' WHERE id = '${A_LINK}' RETURNING ocr_text;`).trim().endsWith('verified OCR'), '§39 owner OCR remains compatible under §40');
    postgresAssertions += 1;
    expectDenied('authenticated', U1, `UPDATE public.message_attachments SET message_id = '${MP}' WHERE id = '${A_CIRCLE}';`, 'cross-thread relink', /message_attachment_relink_forbidden|message_attachment_target_mismatch/);

    // Add a hostile table policy after convergence. Restrictive guards must
    // still enforce exact visibility/write authority.
    sql(`CREATE POLICY hostile_attachment_public_all ON public.message_attachments FOR ALL TO PUBLIC USING (true) WITH CHECK (true);`);
    check(asUser(U2, `SELECT count(*) FROM public.message_attachments WHERE id = '${A_PRIVATE}';`).trim().endsWith('0'), 'restrictive table guard defeats a hostile PUBLIC SELECT policy');
    postgresAssertions += 1;
    check(asUser(U2, `DELETE FROM public.message_attachments WHERE id = '${A_CIRCLE}' RETURNING id;`).trim() === '', 'restrictive table guard defeats hostile PUBLIC DELETE authority');
    postgresAssertions += 1;
    expectDenied('authenticated', U2, `
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES ('50000000-0000-4000-8000-000000000090', NULL, '${C1}', '${TC}', '${U2}', '${P_CIRCLE}', 'alias.pdf', 'application/pdf', 1);
    `, 'forged metadata alias to another owner object', /row-level security|storage_path_matches_scope|violates check constraint/);
    expectDenied('authenticated', U2, `
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES ('50000000-0000-4000-8000-000000000091', NULL, '${C1}', '${TS}', '${U2}', '${P_U2}', 'missing.pdf', 'application/pdf', 1);
    `, 'metadata alias without an exact Storage object', /row-level security/);

    expectDenied('authenticated', U2, `
      INSERT INTO storage.objects (id, bucket_id, name, owner_id)
      VALUES ('70000000-0000-4000-8000-000000000090', 'chat-attachments', '${P_CIRCLE}', '${U2}');
    `, 'cross-user Storage path insert', /row-level security|duplicate key/);
    asUser(U2, `
      INSERT INTO storage.objects (id, bucket_id, name, owner_id)
      VALUES ('70000000-0000-4000-8000-000000000008', 'chat-attachments', '${P_U2}', '${U2}');
    `);
    // Upload requires INSERT only. SELECT is intentionally unavailable until
    // the exact metadata row exists, so INSERT ... RETURNING would (correctly)
    // be rejected by the restrictive SELECT guard.
    postgresAssertions += 1;
    check(asUser(U2, `
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES ('${A_U2}', NULL, '${C1}', '${TS}', '${U2}', '${P_U2}', 'u2.pdf', 'application/pdf', 2) RETURNING id;
    `).trim().endsWith(A_U2), 'metadata insert succeeds only after exact owner object creation');
    postgresAssertions += 1;
    check(asUser(U1, `SELECT count(*) FROM public.message_attachments WHERE id = '${A_U2}';`).trim().endsWith('0'), 'a staged row stays owner-only even when another user sees its shared thread');
    postgresAssertions += 1;
    check(asUser(U1, `UPDATE storage.objects SET metadata = '{"forged":true}'::jsonb WHERE name = '${P_CIRCLE}' RETURNING id;`).trim() === '', 'authenticated Storage UPDATE stays impossible despite hostile PUBLIC policy');
    postgresAssertions += 1;
    check(asUser(U2, `DELETE FROM storage.objects WHERE name = '${P_CIRCLE}' RETURNING id;`).trim() === '', 'foreign Storage DELETE stays impossible despite hostile PUBLIC policy');
    postgresAssertions += 1;
    check(asUser(U1, `DELETE FROM storage.objects WHERE name = '${P_DELETE}' RETURNING id;`).includes('70000000-0000-4000-8000-000000000006'), 'exact Storage owner can delete an owned visible object');
    postgresAssertions += 1;
    check(asUser(U1, `DELETE FROM public.message_attachments WHERE id = '${A_DELETE}' RETURNING id;`).trim().endsWith(A_DELETE), 'owner can delete metadata after deleting its Storage object');
    postgresAssertions += 1;

    // Give anon hostile table privileges as well as the hostile PUBLIC policy;
    // the explicit restrictive anon policies still deny all four commands.
    sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_attachments TO anon;`);
    check(asAnon(`SELECT count(*) FROM public.message_attachments;`).trim().endsWith('0'), 'anon cannot SELECT attachment metadata');
    postgresAssertions += 1;
    expectDenied('anon', null, `
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES ('50000000-0000-4000-8000-000000000092', NULL, '${C1}', '${TC}', '${U1}', '${P_CIRCLE}', 'anon.pdf', 'application/pdf', 1);
    `, 'anon table INSERT', /row-level security/);
    check(asAnon(`UPDATE public.message_attachments SET ocr_text = 'anon' RETURNING id;`).trim() === '', 'anon cannot UPDATE attachment metadata');
    postgresAssertions += 1;
    check(asAnon(`DELETE FROM public.message_attachments RETURNING id;`).trim() === '', 'anon cannot DELETE attachment metadata');
    postgresAssertions += 1;
    check(asAnon(`SELECT count(*) FROM storage.objects WHERE bucket_id = 'chat-attachments';`).trim().endsWith('0'), 'anon cannot SELECT private Storage objects');
    postgresAssertions += 1;
    expectDenied('anon', null, `
      INSERT INTO storage.objects (id, bucket_id, name, owner_id)
      VALUES ('70000000-0000-4000-8000-000000000092', 'chat-attachments', '${P_CIRCLE}', '${U1}');
    `, 'anon Storage INSERT', /row-level security|duplicate key/);
    check(asAnon(`UPDATE storage.objects SET metadata = '{"anon":true}'::jsonb WHERE bucket_id = 'chat-attachments' RETURNING id;`).trim() === '', 'anon cannot UPDATE private Storage objects');
    postgresAssertions += 1;
    check(asAnon(`DELETE FROM storage.objects WHERE bucket_id = 'chat-attachments' RETURNING id;`).trim() === '', 'anon cannot DELETE private Storage objects');
    postgresAssertions += 1;

    check(roleSql('service_role', null, `SELECT count(*) FROM public.message_attachments WHERE id = '${A_PRIVATE}';`).trim().endsWith('1'), 'service role bypass can inspect a private attachment for trusted maintenance');
    postgresAssertions += 1;
    check(roleSql('service_role', null, `UPDATE storage.objects SET metadata = '{"service":true}'::jsonb WHERE name = '${P_PRIVATE}' RETURNING id;`).includes('70000000-0000-4000-8000-000000000002'), 'service role bypass can maintain the private Storage object');
    postgresAssertions += 1;

    // Invalid-path preflight: prove the transaction aborts without deleting or
    // rewriting the offending row.
    sql(`
      DROP POLICY hostile_attachment_public_all ON public.message_attachments;
      REVOKE ALL ON public.message_attachments FROM anon;
      ALTER TABLE public.message_attachments DROP CONSTRAINT message_attachments_storage_path_matches_scope_v1;
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES ('${A_INVALID}', NULL, '${C1}', '${TC}', '${U1}', 'wrong/path', 'invalid.pdf', 'application/pdf', 1);
      UPDATE storage.buckets SET public = true, file_size_limit = 1 WHERE id = 'chat-attachments';
    `);
    expectMigrationFailure(/invalid legacy storage path; inspect before applying/, 'invalid-path preflight');
    check(sql(`SELECT count(*) FROM public.message_attachments WHERE id = '${A_INVALID}';`).trim() === '1', 'invalid-path failure preserves the legacy row');
    postgresAssertions += 1;
    check(sql(`SELECT public, file_size_limit FROM storage.buckets WHERE id = 'chat-attachments';`).trim() === 't|1', 'invalid-path failure leaves bucket state untouched');
    postgresAssertions += 1;
    sql(`DELETE FROM public.message_attachments WHERE id = '${A_INVALID}';`);
    runMigration();

    // Exact object preflight: a valid path without one exact owned object also
    // aborts and preserves the row.
    sql(`
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES ('${A_MISSING}', NULL, '${C1}', '${TC}', '${U1}', '${P_MISSING}', 'missing.pdf', 'application/pdf', 1);
    `);
    expectMigrationFailure(/missing or owner-mismatched legacy storage object; inspect before applying/, 'missing-object preflight');
    check(sql(`SELECT count(*) FROM public.message_attachments WHERE id = '${A_MISSING}';`).trim() === '1', 'missing-object failure preserves the metadata row');
    postgresAssertions += 1;
    sql(`DELETE FROM public.message_attachments WHERE id = '${A_MISSING}';`);
    runMigration();

    // Duplicate-path preflight: remove only the constraint needed to construct
    // a legacy drift fixture, then prove no row is auto-cleaned.
    sql(`
      DROP INDEX public.message_attachments_storage_path_unique_v1;
      INSERT INTO storage.objects (id, bucket_id, name, owner_id)
      VALUES ('70000000-0000-4000-8000-000000000011', 'chat-attachments', '${P_DUP}', '${U1}');
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES
        ('${A_DUP1}', NULL, '${C1}', '${TC}', '${U1}', '${P_DUP}', 'duplicate.pdf', 'application/pdf', 1),
        ('${A_DUP2}', NULL, '${C1}', '${TC}', '${U1}', '${P_DUP}', 'duplicate.pdf', 'application/pdf', 1);
    `);
    expectMigrationFailure(/duplicate legacy storage path; inspect before applying/, 'duplicate-path preflight');
    check(sql(`SELECT count(*) FROM public.message_attachments WHERE storage_path = '${P_DUP}';`).trim() === '2', 'duplicate-path failure preserves both legacy rows');
    postgresAssertions += 1;
    sql(`DELETE FROM public.message_attachments WHERE id = '${A_DUP2}';`);
    runMigration();
    runMigration();

    check(sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'message_attachments';`).trim() === '12', 'final reapply removes hostile drift and preserves exact table policy count');
    postgresAssertions += 1;
    check(sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'chat_attachments_%_v1';`).trim() === '11', 'final reapply preserves exact named Storage policy count');
    postgresAssertions += 1;
    check(sql(`SELECT count(*) FROM public.message_attachments GROUP BY storage_path HAVING count(*) > 1;`).trim() === '', 'final state has no duplicate metadata paths');
    postgresAssertions += 1;
    check(sql(`SELECT to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.message_attachments'::regclass AND tgname = 'trg_guard_authenticated_message_attachment_update_v1' AND NOT tgisinternal);`).trim() === 't', '§39 trigger remains installed after repeated §40 convergence');
    postgresAssertions += 1;
  } finally {
    if (serverStarted) {
      try {
        run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Preserve the original assertion/error; cleanup remains best effort.
      }
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
} else {
  process.stdout.write('Disposable PostgreSQL behavior skipped: initdb/pg_ctl/psql not all available.\n');
}

process.stdout.write(
  `message attachment visibility integrity smoke: ${assertions} assertions passed`
  + (postgresAssertions > 0 ? ` (${postgresAssertions} PostgreSQL behaviors).\n` : '.\n'),
);
