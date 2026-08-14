/**
 * Source + disposable-Postgres smoke for SQL §39 attachment linkage integrity.
 *
 * Run:
 *   npx tsx scripts/message-attachment-link-integrity-smoketest.ts
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260813160000_message_attachment_link_integrity.sql',
);
const consolidatedPath = resolve(process.cwd(), 'docs/RUN_THIS_SQL.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');
const consolidatedSql = readFileSync(consolidatedPath, 'utf8');

let assertions = 0;
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

// ── Static convergence and fail-closed contract ───────────────────────────

has(migrationSql, 'BEGIN;', 'migration changes are transactional');
has(migrationSql, 'ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;', 'attachment RLS is enabled');
has(migrationSql, 'SET message_id = NULL', 'unprovable legacy links are quarantined');
has(migrationSql, 'target_message.id = attachment.message_id', 'legacy repair binds the exact message id');
has(migrationSql, 'target_message.circle_id = attachment.circle_id', 'legacy repair binds the exact circle');
has(migrationSql, 'target_message.thread_id IS NOT DISTINCT FROM attachment.thread_id', 'legacy repair binds the exact nullable thread');
has(migrationSql, 'target_message.user_id = attachment.user_id', 'legacy repair binds the exact owner');
has(migrationSql, 'COALESCE(target_message.is_bot, false) = false', 'legacy repair permits only user-message targets');

const targetValidator = section(
  'CREATE OR REPLACE FUNCTION public.message_attachment_link_target_is_valid_v1(',
  'REVOKE ALL ON FUNCTION public.message_attachment_link_target_is_valid_v1',
);
has(targetValidator, 'SECURITY INVOKER', 'target validation explicitly keeps caller message/thread RLS');
check(!targetValidator.includes('SECURITY DEFINER'), 'target validation cannot become a message existence oracle');
has(targetValidator, 'p_message_id IS NULL', 'an unlinked staged attachment remains valid');
has(targetValidator, 'p_user_id = auth.uid()', 'validator is bound to the authenticated owner');
has(targetValidator, 'target_message.id = p_message_id', 'validator binds exact message identity');
has(targetValidator, 'target_message.circle_id = p_circle_id', 'validator binds exact circle identity');
has(targetValidator, 'target_message.thread_id IS NOT DISTINCT FROM p_thread_id', 'validator binds exact thread identity');
has(targetValidator, 'target_message.user_id = p_user_id', 'validator binds message and attachment ownership');
has(targetValidator, 'COALESCE(target_message.is_bot, false) = false', 'validator rejects bot-message linkage');
has(migrationSql, 'GRANT EXECUTE ON FUNCTION public.message_attachment_link_target_is_valid_v1', 'authenticated policy may call the invoker validator');

const updateGuard = section(
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_message_attachment_update_v1()',
  'DROP TRIGGER IF EXISTS trg_guard_authenticated_message_attachment_update_v1',
);
has(updateGuard, 'SECURITY INVOKER', 'update guard explicitly runs as the authenticated caller');
has(updateGuard, "COALESCE(auth.role(), '') = 'service_role'", 'trusted service-role maintenance bypass is explicit');
has(updateGuard, "current_user IN ('postgres', 'supabase_admin', 'service_role')", 'trusted database maintenance bypass is explicit');
has(updateGuard, 'OLD.user_id IS DISTINCT FROM actor_id', 'guard requires ownership of the old row');
has(updateGuard, "to_jsonb(NEW) - ARRAY['message_id', 'ocr_text']", 'only message linkage and OCR are mutable');
has(updateGuard, "RAISE EXCEPTION 'message_attachment_identity_immutable'", 'identity mutation has a stable denial');
has(updateGuard, 'OLD.message_id IS NOT NULL', 'guard detects a previously linked row');
has(updateGuard, 'NEW.message_id IS DISTINCT FROM OLD.message_id', 'only an idempotent retry may touch a linked row');
has(updateGuard, "RAISE EXCEPTION 'message_attachment_relink_forbidden'", 'relink has a stable denial');
has(updateGuard, 'message_attachment_link_target_is_valid_v1(', 'guard independently validates the new link target');
has(updateGuard, "RAISE EXCEPTION 'message_attachment_target_mismatch'", 'target mismatch has a stable denial');
has(migrationSql, 'BEFORE UPDATE ON public.message_attachments', 'guard runs before every attachment update');
has(migrationSql, 'REVOKE ALL ON FUNCTION public.guard_authenticated_message_attachment_update_v1()', 'trigger function is not directly callable');

has(migrationSql, "cmd IN ('INSERT', 'UPDATE', 'ALL')", 'all permissive INSERT/UPDATE/FOR ALL policy drift is converged');
has(migrationSql, "'DROP POLICY %I ON public.message_attachments'", 'historical write policies are removed dynamically');
check(
  (migrationSql.match(/CREATE POLICY message_attachments_insert_owner_staged_v1/g) || []).length === 1,
  'exactly one canonical attachment INSERT policy is created',
);
const insertPolicy = section(
  'CREATE POLICY message_attachments_insert_owner_staged_v1',
  'CREATE POLICY message_attachments_update_owner_exact_link_v1',
);
has(insertPolicy, 'FOR INSERT', 'canonical insert policy is insert-only');
has(insertPolicy, 'TO authenticated', 'canonical insert policy applies to authenticated clients');
has(insertPolicy, 'WITH CHECK (', 'canonical insert policy validates the new staged row');
has(insertPolicy, 'user_id = auth.uid()', 'canonical insert policy requires the exact owner');
has(insertPolicy, 'message_id IS NULL', 'authenticated inserts cannot forge linkage directly');
has(insertPolicy, 'membership.circle_id = message_attachments.circle_id', 'canonical insert policy requires circle membership');
check(
  (migrationSql.match(/CREATE POLICY message_attachments_update_owner_exact_link_v1/g) || []).length === 1,
  'exactly one canonical attachment UPDATE policy is created',
);
const updatePolicy = section(
  'CREATE POLICY message_attachments_update_owner_exact_link_v1',
  '-- Keep the current PostgREST',
);
has(updatePolicy, 'FOR UPDATE', 'canonical policy is update-only');
has(updatePolicy, 'TO authenticated', 'canonical policy applies to authenticated clients');
has(updatePolicy, 'USING (', 'canonical policy constrains the old row');
has(updatePolicy, 'WITH CHECK (', 'canonical policy constrains the new row');
check((updatePolicy.match(/user_id = auth\.uid\(\)/g) || []).length >= 2, 'old and new rows require the exact owner');
check((updatePolicy.match(/message_attachment_link_target_is_valid_v1\(/g) || []).length === 2, 'old and new link targets are validated');
has(migrationSql, 'GRANT INSERT, UPDATE ON TABLE public.message_attachments TO authenticated;', 'current staged upload, direct link, and OCR writes remain compatible');
has(migrationSql, 'AS attachment_insert_policy_converged', 'readiness proves insert-policy convergence');
has(migrationSql, 'AS attachment_update_policy_converged', 'readiness proves update-policy convergence');
has(migrationSql, 'AS stored_attachment_links_valid', 'readiness proves stored link scope');
has(migrationSql, 'AS authenticated_attachment_write_grants_ready', 'readiness proves direct-write compatibility');

const migrationTransaction = migrationSql.slice(
  migrationSql.indexOf('BEGIN;'),
  migrationSql.indexOf("NOTIFY pgrst, 'reload schema';") + "NOTIFY pgrst, 'reload schema';".length,
);
check(migrationTransaction.startsWith('BEGIN;'), 'migration transaction is locatable');
check(consolidatedSql.includes('-- §39. Message-attachment link integrity (2026-08-13)'), 'consolidated SQL registers §39');
check(consolidatedSql.includes(migrationTransaction), '§39 mirrors the executable migration transaction exactly');

// ── Disposable PostgreSQL behavioral proof (when local binaries exist) ────

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

const postgresTools = ['initdb', 'pg_ctl', 'psql'];
let postgresAssertions = 0;
if (postgresTools.every(commandAvailable)) {
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const workspaceOwner = runningAsRoot
    ? execFileSync('id', ['-nu', String(statSync(process.cwd()).uid)], { encoding: 'utf8' }).trim()
    : '';
  const tempRoot = runningAsRoot
    ? execFileSync(
      'sudo',
      ['-n', '-u', workspaceOwner, 'mktemp', '-d', '/tmp/uc-attachment-link-sql-XXXXXX'],
      { encoding: 'utf8' },
    ).trim()
    : mkdtempSync('/tmp/uc-attachment-link-sql-');
  const dataDir = resolve(tempRoot, 'data');
  const socketDir = resolve(tempRoot, 'socket');
  const port = String(54_000 + (process.pid % 1_000));
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
  const asUser = (userId: string, statement: string): string => sql(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    ${statement}
  `);
  const expectDenied = (
    userId: string,
    statement: string,
    reason: string,
    expectedError: string,
  ): void => {
    const psqlArgs = [
      '-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', `
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${userId}', false);
        SELECT set_config('request.jwt.claim.role', 'authenticated', false);
        ${statement}
      `,
    ];
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
    check(result.stderr.includes(expectedError), `${reason} fails at the intended integrity boundary`);
    postgresAssertions += 2;
  };

  const U1 = '10000000-0000-4000-8000-000000000001';
  const U2 = '10000000-0000-4000-8000-000000000002';
  const C1 = '20000000-0000-4000-8000-000000000001';
  const C2 = '20000000-0000-4000-8000-000000000002';
  const T1 = '30000000-0000-4000-8000-000000000001';
  const T2 = '30000000-0000-4000-8000-000000000002';
  const M1 = '40000000-0000-4000-8000-000000000001';
  const M2 = '40000000-0000-4000-8000-000000000002';
  const MC = '40000000-0000-4000-8000-000000000003';
  const MT = '40000000-0000-4000-8000-000000000004';
  const MF = '40000000-0000-4000-8000-000000000005';
  const MB = '40000000-0000-4000-8000-000000000006';
  const A1 = '50000000-0000-4000-8000-000000000001';
  const A2 = '50000000-0000-4000-8000-000000000002';
  const A3 = '50000000-0000-4000-8000-000000000003';
  const A4 = '50000000-0000-4000-8000-000000000004';
  const AF = '50000000-0000-4000-8000-000000000005';
  const AL = '50000000-0000-4000-8000-000000000006';
  const AN = '50000000-0000-4000-8000-000000000007';
  const AI = '50000000-0000-4000-8000-000000000008';

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
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;

      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user) $$;

      CREATE TABLE public.circle_members (
        circle_id uuid NOT NULL,
        user_id uuid NOT NULL,
        PRIMARY KEY (circle_id, user_id)
      );
      CREATE TABLE public.messages (
        id uuid PRIMARY KEY,
        circle_id uuid NOT NULL,
        thread_id uuid,
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

      INSERT INTO public.circle_members VALUES ('${C1}', '${U1}'), ('${C1}', '${U2}'), ('${C2}', '${U2}');
      INSERT INTO public.messages (id, circle_id, thread_id, user_id, is_bot) VALUES
        ('${M1}', '${C1}', '${T1}', '${U1}', false),
        ('${M2}', '${C1}', '${T1}', '${U1}', false),
        ('${MC}', '${C2}', '${T1}', '${U1}', false),
        ('${MT}', '${C1}', '${T2}', '${U1}', false),
        ('${MF}', '${C1}', '${T1}', '${U2}', false),
        ('${MB}', '${C1}', '${T1}', '${U1}', true);
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes, extract_text)
      VALUES
        ('${A1}', NULL, '${C1}', '${T1}', '${U1}', 'c1/t1/u1/a1.pdf', 'a1.pdf', 'application/pdf', 10, NULL),
        ('${A2}', NULL, '${C1}', '${T1}', '${U1}', 'c1/t1/u1/a2.png', 'a2.png', 'image/png', 20, NULL),
        ('${A3}', NULL, '${C1}', '${T1}', '${U1}', 'c1/t1/u1/a3.txt', 'a3.txt', 'text/plain', 30, 'fixed text'),
        ('${A4}', NULL, '${C1}', '${T1}', '${U1}', 'c1/t1/u1/a4.pdf', 'a4.pdf', 'application/pdf', 40, NULL),
        ('${AF}', NULL, '${C1}', '${T1}', '${U2}', 'c1/t1/u2/af.pdf', 'af.pdf', 'application/pdf', 50, NULL),
        ('${AL}', '${MC}', '${C1}', '${T1}', '${U1}', 'c1/t1/u1/legacy.pdf', 'legacy.pdf', 'application/pdf', 60, NULL);

      ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY messages_select_for_test ON public.messages FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.circle_members AS membership
          WHERE membership.circle_id = messages.circle_id
            AND membership.user_id = auth.uid()
        )
      );
      ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY message_attachments_select_for_test ON public.message_attachments FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.circle_members AS membership
          WHERE membership.circle_id = message_attachments.circle_id
            AND membership.user_id = auth.uid()
        )
      );
      CREATE POLICY message_attachments_update ON public.message_attachments FOR UPDATE TO authenticated
      USING (user_id = auth.uid());

      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated;
      GRANT SELECT ON public.messages, public.circle_members TO authenticated;
      GRANT SELECT, UPDATE ON public.message_attachments TO authenticated;
    `);

    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);
    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);
    check(sql(`SELECT message_id IS NULL FROM public.message_attachments WHERE id = '${AL}';`).trim() === 't', 'migration quarantines a legacy cross-scope link');
    postgresAssertions += 1;

    check(
      asUser(U1, `
        INSERT INTO public.message_attachments
          (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
        VALUES
          ('${AN}', NULL, '${C1}', '${T1}', '${U1}', 'c1/t1/u1/new.pdf', 'new.pdf', 'application/pdf', 70)
        RETURNING id;
      `).trim().endsWith(AN),
      'owner can insert an unlinked staged attachment in their circle',
    );
    postgresAssertions += 1;
    expectDenied(U1, `
      INSERT INTO public.message_attachments
        (id, message_id, circle_id, thread_id, user_id, storage_path, original_name, mime_type, size_bytes)
      VALUES
        ('${AI}', '${M1}', '${C1}', '${T1}', '${U1}', 'c1/t1/u1/forged.pdf', 'forged.pdf', 'application/pdf', 80);
    `, 'direct linked-row insert', 'new row violates row-level security policy');

    check(asUser(U1, `UPDATE public.message_attachments SET message_id = '${M1}' WHERE id = '${A1}' RETURNING message_id;`).trim().endsWith(M1), 'owner can link to the exact same-scope user message');
    postgresAssertions += 1;
    check(asUser(U1, `UPDATE public.message_attachments SET message_id = '${M1}' WHERE id = '${A1}' RETURNING message_id;`).trim().endsWith(M1), 'same-message retry is idempotent');
    postgresAssertions += 1;
    expectDenied(U1, `UPDATE public.message_attachments SET message_id = '${M2}' WHERE id = '${A1}';`, 'relink to a second valid message', 'message_attachment_relink_forbidden');
    expectDenied(U1, `UPDATE public.message_attachments SET message_id = '${MC}' WHERE id = '${A2}';`, 'cross-circle link', 'message_attachment_target_mismatch');
    expectDenied(U1, `UPDATE public.message_attachments SET message_id = '${MT}' WHERE id = '${A2}';`, 'cross-thread link', 'message_attachment_target_mismatch');
    expectDenied(U1, `UPDATE public.message_attachments SET message_id = '${MF}' WHERE id = '${A2}';`, 'foreign-owner message link', 'message_attachment_target_mismatch');
    expectDenied(U1, `UPDATE public.message_attachments SET message_id = '${MB}' WHERE id = '${A2}';`, 'bot-message link', 'message_attachment_target_mismatch');
    expectDenied(U1, `UPDATE public.message_attachments SET message_id = '40000000-0000-4000-8000-000000000099' WHERE id = '${A2}';`, 'missing-message link', 'message_attachment_target_mismatch');
    expectDenied(U1, `UPDATE public.message_attachments SET storage_path = 'rewritten' WHERE id = '${A3}';`, 'storage identity rewrite', 'message_attachment_identity_immutable');
    expectDenied(U1, `UPDATE public.message_attachments SET extract_text = 'rewritten' WHERE id = '${A3}';`, 'extracted-content rewrite', 'message_attachment_identity_immutable');

    check(asUser(U1, `UPDATE public.message_attachments SET ocr_text = 'owner OCR' WHERE id = '${A2}' RETURNING ocr_text;`).trim().endsWith('owner OCR'), 'owner OCR update remains available before linking');
    postgresAssertions += 1;
    check(asUser(U1, `UPDATE public.message_attachments SET ocr_text = 'linked OCR' WHERE id = '${A1}' RETURNING ocr_text;`).trim().endsWith('linked OCR'), 'owner OCR update remains available after linking');
    postgresAssertions += 1;

    const foreignResult = asUser(U1, `UPDATE public.message_attachments SET ocr_text = 'forged OCR' WHERE id = '${AF}'; SELECT count(*) FROM public.message_attachments WHERE id = '${AF}' AND ocr_text = 'forged OCR';`);
    check(foreignResult.trim().endsWith('0'), 'foreign owner cannot update another attachment');
    postgresAssertions += 1;
    check(sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'message_attachments' AND cmd = 'INSERT';`).trim() === '1', 'migration converges to one insert policy after repeated execution');
    postgresAssertions += 1;
    check(sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'message_attachments' AND cmd IN ('UPDATE', 'ALL');`).trim() === '1', 'migration converges to one update policy after repeated execution');
    postgresAssertions += 1;
  } finally {
    if (serverStarted) {
      try {
        run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Preserve the original assertion/error; temp cleanup is still attempted.
      }
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
} else {
  process.stdout.write('Disposable PostgreSQL behavior skipped: initdb/pg_ctl/psql not all available.\n');
}

process.stdout.write(
  `message attachment link integrity smoke: ${assertions} assertions passed`
  + (postgresAssertions > 0 ? ` (${postgresAssertions} PostgreSQL behaviors).\n` : '.\n'),
);
