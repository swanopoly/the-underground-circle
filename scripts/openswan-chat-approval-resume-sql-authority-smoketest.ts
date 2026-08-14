/**
 * Disposable-PostgreSQL behavior proof for the exact OpenSwan Chat approval
 * resume RPC plus its canonical release packaging. It does not contact or
 * mutate a configured Supabase project.
 *
 * Run:
 *   npx tsx scripts/openswan-chat-approval-resume-sql-authority-smoketest.ts
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const consolidatedSql = readFileSync(resolve(process.cwd(), 'docs/RUN_THIS_SQL.sql'), 'utf8');
const roadmap = readFileSync(resolve(process.cwd(), 'docs/AGENTS_ROADMAP.md'), 'utf8');
const stackReference = readFileSync(resolve(process.cwd(), 'docs/UC_APP_STACK_REFERENCE.md'), 'utf8');
const claudeContext = readFileSync(resolve(process.cwd(), 'CLAUDE.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, unknown>;
};

let assertions = 0;
let postgresAssertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function has(source: string, value: string, message: string): void {
  check(source.includes(value), message);
}

function commandAvailable(command: string): boolean {
  return spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function authorityDigestInput(input: {
  approvalDigest: string;
  approvalId: string;
  approvalRunId: string;
  circleId: string;
  iteration: number;
  runId: string;
  toolName: string;
  toolUseId: string;
  userId: string;
}): string {
  return JSON.stringify({
    approvalDigest: input.approvalDigest,
    approvalId: input.approvalId,
    approvalRunId: input.approvalRunId,
    circleId: input.circleId,
    iteration: input.iteration,
    runId: input.runId,
    schemaVersion: 2,
    source: 'cross_run',
    status: 'approved',
    toolName: input.toolName,
    toolUseId: input.toolUseId,
    userId: input.userId,
  });
}

// ── Static contract ───────────────────────────────────────────────────────

const consolidatedHeader = [
  '-- BEGIN SECTION 44: OpenSwan Chat approval-resume authority',
  '-- Source: supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql',
  '',
].join('\n');
const consolidatedFooter = '-- END SECTION 44: OpenSwan Chat approval-resume authority';
const sectionStart = consolidatedSql.indexOf(consolidatedHeader);
const sectionEnd = consolidatedSql.indexOf(consolidatedFooter, sectionStart + consolidatedHeader.length);
check(sectionStart >= 0 && sectionEnd > sectionStart, 'consolidated SQL has exact §44 boundaries');
const consolidatedBody = consolidatedSql.slice(sectionStart + consolidatedHeader.length, sectionEnd);
assertions += 1;
assert.equal(consolidatedBody, migrationSql, '§44 body is byte-exact with the canonical migration');
assertions += 1;
assert.equal(consolidatedSql.indexOf(consolidatedHeader, sectionStart + 1), -1, '§44 appears exactly once');
check(
  packageJson.scripts?.['smoke:openswan-chat-approval-resume-sql-authority']
    === 'npx tsx scripts/openswan-chat-approval-resume-sql-authority-smoketest.ts',
  'package exposes the canonical §44 smoke',
);
for (const aggregate of ['check:openswan-chat-ux', 'check:openswan-multi-action']) {
  check(
    typeof packageJson.scripts?.[aggregate] === 'string'
      && packageJson.scripts[aggregate].includes('smoke:openswan-chat-approval-resume-sql-authority'),
    `${aggregate} includes the transactional Chat resume authority smoke`,
  );
}
check(
  roadmap.includes('20260813210000_openswan_chat_approval_resume_authority.sql')
    && roadmap.includes('| 44 | Transactional OpenSwan Chat approval-resume authority'),
  'roadmap owns the migration and §44 deployment checklist',
);
check(
  stackReference.includes('20260813210000_openswan_chat_approval_resume_authority'),
  'stack reference owns the transactional Chat resume layer',
);
check(
  claudeContext.includes('20260813210000_openswan_chat_approval_resume_authority'),
  'human-readable project context owns the transactional Chat resume layer',
);

has(migrationSql, 'BEGIN;', 'migration is transactional');
has(migrationSql, 'COMMIT;', 'migration commits atomically');
has(
  migrationSql,
  "to_regprocedure('public.is_valid_tool_v2_approval_payload(jsonb,boolean)') IS NULL",
  'migration fails closed without the canonical section-28 payload validator',
);
has(
  migrationSql,
  "'trg_guard_tool_v2_run_approval_update'",
  'migration fails closed unless the canonical section-28 trigger trio is active',
);
has(
  migrationSql,
  "to_regprocedure('public.guard_authenticated_message_mutation()') IS NULL",
  'migration fails closed without the canonical section-31 message boundary',
);
has(
  migrationSql,
  'ADD COLUMN IF NOT EXISTS thread_id uuid',
  'run lineage has a dedicated circle_chat_threads id',
);
has(
  migrationSql,
  'ADD COLUMN IF NOT EXISTS source_message_id uuid',
  'run lineage has a dedicated source message id',
);
has(
  migrationSql,
  'CHECK ((thread_id IS NULL) = (source_message_id IS NULL))',
  'lineage is all-or-none without breaking Console/legacy null pairs',
);
has(
  migrationSql,
  "thread_id IS NULL\n      OR ((surface = 'main_chat' AND provider = 'openswan') IS TRUE)",
  'present lineage is limited to main_chat OpenSwan runs',
);
has(
  migrationSql,
  'REFERENCES public.circle_chat_threads(id)',
  'thread lineage points to the Circle Chat namespace, not chat_sessions',
);
has(migrationSql, 'REFERENCES public.messages(id)', 'source lineage points to the exact Chat message');
check(
  !migrationSql.includes('REFERENCES public.chat_sessions'),
  'migration never conflates Circle Chat with legacy chat_sessions',
);
has(
  migrationSql,
  'agent_run_chat_lineage_must_be_set_on_insert',
  'authenticated writers cannot graft lineage onto a legacy run later',
);
has(
  migrationSql,
  'agent_run_chat_lineage_immutable',
  'established thread/message lineage and owning scope are immutable',
);
has(
  migrationSql,
  'agent_runs_chat_lineage_update_owner_v1',
  'protected Chat run updates are owner-restrictive despite permissive drift',
);
has(
  migrationSql,
  'agent_runs_chat_lineage_delete_owner_v1',
  'protected Chat run deletes are owner-restrictive despite permissive drift',
);
has(
  migrationSql,
  'agent_run_approvals_chat_ask_requester_update_v1',
  'protected Chat ask approvals are requester-restrictive despite permissive drift',
);
has(
  migrationSql,
  'requested_by = auth.uid()::text',
  'protected approval updates remain bound to the exact requester',
);
has(
  migrationSql,
  'consume_openswan_chat_approval_resume_v1',
  'one authenticated cross-run consume RPC owns the race-free boundary',
);
has(
  migrationSql,
  'can_consume_openswan_chat_approval_resume_v1',
  'an authenticated read-only custody preflight is available before outbox claim',
);
has(
  migrationSql,
  'RETURNS boolean\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER',
  'custody preflight is database-enforced read-only and exposes no approval payload',
);
has(migrationSql, 'ORDER BY run_row.id\n  FOR UPDATE;', 'both runs lock in deterministic order');
has(migrationSql, 'FOR SHARE;', 'the exact thread is locked against concurrent archive/move');
has(migrationSql, 'FOR KEY SHARE;', 'membership rows are transaction-locked');
has(
  migrationSql,
  'WHERE message.id = p_source_message_id\n  FOR SHARE;',
  'source message lineage is locked against every concurrent rewrite',
);
has(
  migrationSql,
  "v_source_run.status IS DISTINCT FROM 'failed'",
  'source run must already be terminal failed',
);
has(
  migrationSql,
  "v_terminal->>'reason' IS DISTINCT FROM 'action_coverage_incomplete'",
  'source run must have the exact approval-stop reason',
);
has(
  migrationSql,
  "v_terminal->'completionVerified' IS DISTINCT FROM 'false'::jsonb",
  'source run completion must be explicitly unverified',
);
has(
  migrationSql,
  "v_current_run.status NOT IN ('queued', 'planning', 'running')",
  'dispatch run must remain active when authority is consumed',
);
has(migrationSql, 'v_message.is_bot IS DISTINCT FROM false', 'exact source must explicitly be a non-bot user message');
has(
  migrationSql,
  "v_approval.resolved_by IS DISTINCT FROM v_uid",
  'requester and resolver must be the authenticated user',
);
has(
  migrationSql,
  "v_approval.payload->>'approvalMode' IS DISTINCT FROM 'ask'",
  'only explicit ask approvals may cross runs',
);
has(
  migrationSql,
  "v_approval.payload->>'toolName' = 'desktop.open_attachment'",
  'device-private attachment approval remains on its dedicated path',
);
has(
  migrationSql,
  "NOT public.is_valid_tool_v2_approval_payload(v_approval.payload, false)",
  'the RPC reuses the exact canonical schema-v2 payload validator',
);
has(
  migrationSql,
  "p_tool_use_id IS DISTINCT FROM 'approval-resume:' || p_approval_id::text",
  'runtime-owned approval-resume tool call identity is exact',
);
has(
  migrationSql,
  "extensions.digest(convert_to(v_authority_json, 'UTF8'), 'sha256')",
  'the database recomputes the complete exact-call dispatch binding',
);
has(
  migrationSql,
  "approval_row.payload IS NOT DISTINCT FROM v_approval.payload",
  'final approval write retains an exact payload compare-and-set',
);
has(
  migrationSql,
  "REVOKE ALL ON FUNCTION public.consume_openswan_chat_approval_resume_v1",
  'RPC starts closed to public/anon/authenticated',
);
has(
  migrationSql,
  ') TO authenticated;',
  'only the authenticated application role receives RPC execution',
);
check(
  !migrationSql.includes('GRANT UPDATE ON TABLE public.agent_run_approvals'),
  'migration does not grant a parallel raw approval mutation path',
);

// ── Disposable PostgreSQL behavior ────────────────────────────────────────

const requiredTools = ['initdb', 'pg_ctl', 'psql'];
if (requiredTools.every(commandAvailable)) {
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const workspaceOwner = runningAsRoot
    ? execFileSync('id', ['-nu', String(statSync(process.cwd()).uid)], { encoding: 'utf8' }).trim()
    : '';
  const tempRoot = runningAsRoot
    ? execFileSync(
      'sudo',
      ['-n', '-u', workspaceOwner, 'mktemp', '-d', '/tmp/uc-openswan-chat-resume-sql-XXXXXX'],
      { encoding: 'utf8' },
    ).trim()
    : mkdtempSync('/tmp/uc-openswan-chat-resume-sql-');
  const dataDir = resolve(tempRoot, 'data');
  const socketDir = resolve(tempRoot, 'socket');
  const port = String(57_000 + (process.pid % 1_000));
  const pgEnv = {
    ...process.env,
    PGHOST: socketDir,
    PGPORT: port,
    PGDATABASE: 'postgres',
    PGUSER: workspaceOwner || process.env.USER || 'postgres',
  };
  let serverStarted = false;

  const run = (command: string, args: string[], input?: string): string => {
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
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  };
  const sql = (value: string): string => run(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', value],
  );
  const sqlFile = (value: string): string => run(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq'],
    value,
  );
  const asAuthenticated = (userId: string, statement: string): string => sql(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    ${statement}
  `);
  const asServiceRole = (statement: string): string => sql(`
    SET ROLE service_role;
    SELECT set_config('request.jwt.claim.role', 'service_role', false);
    ${statement}
  `);
  const expectAuthenticatedError = (
    userId: string,
    statement: string,
    messagePattern: RegExp,
    assertionMessage: string,
  ): void => {
    let failed = false;
    try {
      asAuthenticated(userId, statement);
    } catch (error) {
      failed = messagePattern.test(String((error as { stderr?: string }).stderr || error));
    }
    check(failed, assertionMessage);
    postgresAssertions += 1;
  };

  const U1 = '10000000-0000-4000-8000-000000000001';
  const U2 = '10000000-0000-4000-8000-000000000002';
  const C1 = '20000000-0000-4000-8000-000000000001';
  const C2 = '20000000-0000-4000-8000-000000000002';
  const T1 = '30000000-0000-4000-8000-000000000001';
  const T2 = '30000000-0000-4000-8000-000000000002';
  const M1 = '40000000-0000-4000-8000-000000000001';
  const M2 = '40000000-0000-4000-8000-000000000002';
  const MBOT = '40000000-0000-4000-8000-000000000003';
  const RUN_SOURCE = '50000000-0000-4000-8000-000000000001';
  const RUN_CURRENT = '50000000-0000-4000-8000-000000000002';
  const RUN_REPLAY = '50000000-0000-4000-8000-000000000003';
  const RUN_CONSOLE = '50000000-0000-4000-8000-000000000004';
  const RUN_WRONG_THREAD = '50000000-0000-4000-8000-000000000005';
  const A_OK = '60000000-0000-4000-8000-000000000001';
  const A_THREAD = '60000000-0000-4000-8000-000000000002';
  const A_USER = '60000000-0000-4000-8000-000000000003';
  const A_STATUS = '60000000-0000-4000-8000-000000000004';
  const A_EXPIRED = '60000000-0000-4000-8000-000000000005';
  const A_AUTO = '60000000-0000-4000-8000-000000000006';
  const A_BOT = '60000000-0000-4000-8000-000000000007';
  const A_PEER = '60000000-0000-4000-8000-000000000009';
  const A_OFFICE = '60000000-0000-4000-8000-000000000010';
  const RUN_OFFICE = '50000000-0000-4000-8000-000000000008';
  const RUN_AUTH_INSERT = '50000000-0000-4000-8000-000000000009';
  const DIGEST = `approval-v2:sha256:${'a'.repeat(64)}`;
  const TOOL = 'browser.fill_field';

  const call = (args: {
    approvalId: string;
    sourceRunId?: string;
    currentRunId?: string;
    circleId?: string;
    threadId?: string;
    sourceMessageId?: string;
    iteration?: number;
    bindingDigest: string;
  }): string => `SELECT * FROM public.consume_openswan_chat_approval_resume_v1(
    '${args.approvalId}',
    '${args.sourceRunId || RUN_SOURCE}',
    '${args.currentRunId || RUN_CURRENT}',
    '${args.circleId || C1}',
    '${args.threadId || T1}',
    '${args.sourceMessageId || M1}',
    '${TOOL}',
    '${DIGEST}',
    'approval-resume:${args.approvalId}',
    ${args.iteration || 1},
    '${args.bindingDigest}'
  );`;
  const preflight = (args: {
    approvalId: string;
    sourceRunId?: string;
    currentRunId?: string;
    circleId?: string;
    threadId?: string;
    sourceMessageId?: string;
    iteration?: number;
    bindingDigest: string;
  }): string => `SELECT public.can_consume_openswan_chat_approval_resume_v1(
    '${args.approvalId}',
    '${args.sourceRunId || RUN_SOURCE}',
    '${args.currentRunId || RUN_CURRENT}',
    '${args.circleId || C1}',
    '${args.threadId || T1}',
    '${args.sourceMessageId || M1}',
    '${TOOL}',
    '${DIGEST}',
    'approval-resume:${args.approvalId}',
    ${args.iteration || 1},
    '${args.bindingDigest}'
  );`;

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

    sqlFile(`
      CREATE SCHEMA auth;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;

      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.circles(id uuid PRIMARY KEY);
      CREATE TABLE public.circle_members(
        circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        PRIMARY KEY(circle_id, user_id)
      );
      CREATE TABLE public.circle_chat_threads(
        id uuid PRIMARY KEY,
        circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
        created_by uuid NOT NULL REFERENCES auth.users(id),
        visibility text NOT NULL DEFAULT 'private',
        archived boolean NOT NULL DEFAULT false
      );
      CREATE TABLE public.circle_chat_thread_members(
        thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        PRIMARY KEY(thread_id, user_id)
      );
      CREATE TABLE public.messages(
        id uuid PRIMARY KEY,
        circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
        thread_id uuid NOT NULL REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES auth.users(id),
        is_bot boolean NOT NULL DEFAULT false
      );
      CREATE TABLE public.agent_runs(
        id uuid PRIMARY KEY,
        circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES auth.users(id),
        surface text NOT NULL,
        provider text,
        status text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE public.agent_run_approvals(
        id uuid PRIMARY KEY,
        run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
        circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
        status text NOT NULL,
        requested_by text,
        resolved_by uuid,
        requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        resolved_at timestamptz,
        timeout_seconds integer NOT NULL DEFAULT 300,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb
      );

      CREATE FUNCTION public.is_valid_tool_v2_approval_payload(p jsonb, allow_dispatch boolean)
      RETURNS boolean LANGUAGE sql IMMUTABLE
      AS $$ SELECT COALESCE(
        jsonb_typeof(p) = 'object'
        AND p->>'approvalSchemaVersion' = '2'
        AND p->>'toolName' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
        AND p->>'toolApprovalDigest' ~ '^approval-v2:sha256:[0-9a-f]{64}$'
        AND p->>'toolApprovalKey' = p->>'toolApprovalDigest'
        AND p->>'toolApprovalKeyVersion' = '2'
        AND p->>'policyFamily' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
        AND p->>'approvalMode' IN ('ask', 'auto')
        AND jsonb_typeof(p->'mutatesState') = 'boolean'
        AND jsonb_typeof(p->'externalSideEffect') = 'boolean'
        AND (
          (NOT allow_dispatch AND NOT (p ? 'dispatchReceiptSchemaVersion')
            AND NOT (p ? 'dispatchBindingDigest') AND NOT (p ? 'dispatchConsumedAt'))
          OR (allow_dispatch AND p->>'dispatchReceiptSchemaVersion' = '2'
            AND p->>'dispatchBindingDigest' ~ '^authority-v2:sha256:[0-9a-f]{64}$'
            AND p->>'dispatchConsumedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$')
        )
      , false) $$;

      CREATE FUNCTION public.guard_tool_v2_run_approval() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        v_uid uuid := auth.uid();
        v_expires_at timestamptz;
      BEGIN
        IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
        v_expires_at := OLD.requested_at + make_interval(secs => OLD.timeout_seconds);
        IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
          IF NEW.payload IS DISTINCT FROM OLD.payload OR clock_timestamp() >= v_expires_at THEN
            RAISE EXCEPTION 'tool_v2_approval_not_live';
          END IF;
          NEW.resolved_by := v_uid;
          NEW.resolved_at := clock_timestamp();
          RETURN NEW;
        END IF;
        IF OLD.status IN ('approved', 'auto_approved')
           AND NEW.status = OLD.status
           AND NOT (OLD.payload ? 'dispatchBindingDigest')
           AND NEW.payload ? 'dispatchBindingDigest' THEN
          IF OLD.requested_by <> v_uid::text
             OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
             OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
             OR clock_timestamp() >= v_expires_at
             OR NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
             OR NOT public.is_valid_tool_v2_approval_payload(NEW.payload, true)
             OR (NEW.payload - ARRAY['dispatchReceiptSchemaVersion','dispatchBindingDigest','dispatchConsumedAt']::text[])
               IS DISTINCT FROM OLD.payload THEN
            RAISE EXCEPTION 'tool_v2_approval_consumption_forbidden';
          END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'tool_v2_approval_transition_forbidden';
      END $$;
      CREATE FUNCTION public.guard_authenticated_message_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE FUNCTION public.guard_authenticated_chat_thread_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

      CREATE TRIGGER trg_guard_tool_v2_run_approval_insert
      BEFORE INSERT ON public.agent_run_approvals
      FOR EACH ROW
      WHEN (NEW.payload->>'approvalSchemaVersion' = '2')
      EXECUTE FUNCTION public.guard_tool_v2_run_approval();
      CREATE TRIGGER trg_guard_tool_v2_run_approval_update
      BEFORE UPDATE ON public.agent_run_approvals
      FOR EACH ROW
      WHEN (
        current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
        AND (
          OLD.payload->>'approvalSchemaVersion' = '2'
          OR NEW.payload->>'approvalSchemaVersion' = '2'
        )
      )
      EXECUTE FUNCTION public.guard_tool_v2_run_approval();
      CREATE TRIGGER trg_guard_tool_v2_run_approval_delete
      BEFORE DELETE ON public.agent_run_approvals
      FOR EACH ROW
      WHEN (OLD.payload->>'approvalSchemaVersion' = '2')
      EXECUTE FUNCTION public.guard_tool_v2_run_approval();

      ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY agent_runs_broad_compatibility
      ON public.agent_runs FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
      ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;
      CREATE POLICY agent_run_approvals_broad_compatibility
      ON public.agent_run_approvals FOR ALL TO authenticated
      USING (true) WITH CHECK (true);

      GRANT USAGE ON SCHEMA public, auth, extensions TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
      GRANT SELECT ON public.circle_members, public.circle_chat_threads,
        public.circle_chat_thread_members, public.messages
        TO authenticated;
      GRANT SELECT, UPDATE ON public.agent_run_approvals TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, auth
        TO service_role;
    `);

    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);
    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);

    const payloadAsk = JSON.stringify({
      approvalSchemaVersion: 2,
      toolName: TOOL,
      toolApprovalDigest: DIGEST,
      toolApprovalKey: DIGEST,
      toolApprovalKeyVersion: 2,
      policyFamily: 'browser',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: false,
    });
    const payloadAuto = JSON.stringify({ ...JSON.parse(payloadAsk), approvalMode: 'auto' });
    const partialTerminal = JSON.stringify({
      terminal: {
        state: 'partial',
        reason: 'action_coverage_incomplete',
        completionVerified: false,
      },
    });

    sqlFile(`
      SET ROLE service_role;
      INSERT INTO auth.users(id) VALUES ('${U1}'), ('${U2}');
      INSERT INTO public.circles(id) VALUES ('${C1}'), ('${C2}');
      INSERT INTO public.circle_members(circle_id, user_id) VALUES
        ('${C1}', '${U1}'), ('${C1}', '${U2}'), ('${C2}', '${U1}');
      INSERT INTO public.circle_chat_threads(id, circle_id, created_by, visibility) VALUES
        ('${T1}', '${C1}', '${U1}', 'private'),
        ('${T2}', '${C1}', '${U1}', 'private');
      INSERT INTO public.circle_chat_thread_members(thread_id, user_id) VALUES
        ('${T1}', '${U1}'), ('${T2}', '${U1}');
      INSERT INTO public.messages(id, circle_id, thread_id, user_id, is_bot) VALUES
        ('${M1}', '${C1}', '${T1}', '${U1}', false),
        ('${M2}', '${C1}', '${T2}', '${U1}', false),
        ('${MBOT}', '${C1}', '${T1}', '${U1}', true);

      INSERT INTO public.agent_runs(id, circle_id, user_id, surface, provider, status, metadata, thread_id, source_message_id) VALUES
        ('${RUN_SOURCE}', '${C1}', '${U1}', 'main_chat', 'openswan', 'failed', ${sqlLiteral(partialTerminal)}::jsonb, '${T1}', '${M1}'),
        ('${RUN_CURRENT}', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '{}'::jsonb, '${T1}', '${M1}'),
        ('${RUN_REPLAY}', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '{}'::jsonb, '${T1}', '${M1}'),
        ('${RUN_CONSOLE}', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '{}'::jsonb, NULL, NULL),
        ('${RUN_WRONG_THREAD}', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '{}'::jsonb, '${T2}', '${M2}'),
        ('${RUN_OFFICE}', '${C1}', '${U1}', 'office_terminal', 'openswan', 'running', '{}'::jsonb, NULL, NULL);

      INSERT INTO public.agent_run_approvals(
        id, run_id, circle_id, status, requested_by, resolved_by,
        requested_at, resolved_at, timeout_seconds, metadata, payload
      ) VALUES
        ('${A_OK}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds', 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_THREAD}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds', 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_USER}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds', 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_STATUS}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds', 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_EXPIRED}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '19 minutes', 300, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_AUTO}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds', 600, '{}'::jsonb, ${sqlLiteral(payloadAuto)}::jsonb),
        ('${A_BOT}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds', 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_PEER}', '${RUN_SOURCE}', '${C1}', 'pending', '${U1}', NULL, clock_timestamp() - interval '1 minute', NULL, 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb),
        ('${A_OFFICE}', '${RUN_OFFICE}', '${C1}', 'pending', '${U1}', NULL, clock_timestamp() - interval '1 minute', NULL, 600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb);
      RESET ROLE;

    `);

    const digestFor = (approvalId: string, currentRunId: string, iteration = 1): string => sql(`
      SELECT 'authority-v2:sha256:' || encode(
        extensions.digest(convert_to(${sqlLiteral(authorityDigestInput({
          approvalDigest: DIGEST,
          approvalId,
          approvalRunId: RUN_SOURCE,
          circleId: C1,
          iteration,
          runId: currentRunId,
          toolName: TOOL,
          toolUseId: `approval-resume:${approvalId}`,
          userId: U1,
        }))}, 'UTF8'), 'sha256'),
        'hex'
      );
    `).trim();

    check(
      sql(`SELECT count(*) FROM public.agent_runs WHERE id = '${RUN_CONSOLE}' AND thread_id IS NULL AND source_message_id IS NULL;`).trim() === '1',
      'legacy/Console main_chat OpenSwan creation remains compatible with a null pair',
    );
    postgresAssertions += 1;
    check(
      asServiceRole(`UPDATE public.agent_runs SET thread_id = '${T1}', source_message_id = '${M1}' WHERE id = '${RUN_CONSOLE}' RETURNING id;`).includes(RUN_CONSOLE),
      'trusted service maintenance can backfill one exact legacy lineage pair',
    );
    postgresAssertions += 1;
    let serviceRewriteFailed = false;
    try {
      asServiceRole(`UPDATE public.agent_runs SET thread_id = '${T2}', source_message_id = '${M2}' WHERE id = '${RUN_CONSOLE}';`);
    } catch (error) {
      serviceRewriteFailed = /agent_run_chat_lineage_immutable/.test(
        String((error as { stderr?: string }).stderr || error),
      );
    }
    check(serviceRewriteFailed, 'even service maintenance cannot rewrite established lineage');
    postgresAssertions += 1;
    check(
      sql(`SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid = 'public.agent_runs'::regclass AND conname LIKE 'agent_runs_chat_thread_lineage_%_v1';`).trim() === '4',
      'reapply converges to exactly four lineage constraints',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid = 'public.agent_runs'::regclass AND contype = 'f' AND confdeltype = 'r' AND ((conname = 'agent_runs_chat_thread_lineage_thread_fkey_v1' AND confrelid = 'public.circle_chat_threads'::regclass) OR (conname = 'agent_runs_chat_thread_lineage_message_fkey_v1' AND confrelid = 'public.messages'::regclass));`).trim() === '2',
      'both lineage FKs point to the exact canonical tables with delete restrict',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'agent_runs' AND policyname IN ('agent_runs_chat_lineage_update_owner_v1','agent_runs_chat_lineage_delete_owner_v1') AND permissive = 'RESTRICTIVE';`).trim() === '2',
      'reapply converges to exactly two restrictive owner policies',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U1,
        `INSERT INTO public.agent_runs(id, circle_id, user_id, surface, provider, status, thread_id, source_message_id)
         VALUES ('${RUN_AUTH_INSERT}', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '${T1}', '${M1}') RETURNING id;`,
      ).includes(RUN_AUTH_INSERT),
      'authenticated Chat creation can establish one exact valid lineage pair',
    );
    postgresAssertions += 1;

    expectAuthenticatedError(
      U1,
      `INSERT INTO public.agent_runs(id, circle_id, user_id, surface, provider, status, thread_id, source_message_id)
       VALUES ('70000000-0000-4000-8000-000000000001', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '${T1}', NULL);`,
      /agent_runs_chat_thread_lineage_pair_v1|agent_run_chat_lineage_pair_required/,
      'half-present lineage is rejected',
    );
    expectAuthenticatedError(
      U1,
      `UPDATE public.agent_runs SET source_message_id = '${M2}' WHERE id = '${RUN_CURRENT}';`,
      /agent_run_chat_lineage_immutable/,
      'authenticated owner cannot rewrite established source lineage',
    );
    check(
      !asAuthenticated(
        U2,
        `UPDATE public.agent_runs SET status = 'cancelled' WHERE id = '${RUN_CURRENT}' RETURNING id;`,
      ).includes(RUN_CURRENT),
      'a peer cannot update another owner protected Chat run through broad compatibility policy',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(U2, `SELECT id FROM public.agent_run_approvals WHERE id = '${A_PEER}';`).includes(A_PEER),
      'a circle peer retains product read visibility for a protected Chat approval',
    );
    postgresAssertions += 1;
    check(
      !asAuthenticated(
        U2,
        `UPDATE public.agent_run_approvals SET status = 'approved' WHERE id = '${A_PEER}' RETURNING id;`,
      ).includes(A_PEER),
      'a circle peer cannot resolve the protected requester approval',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT status = 'pending' AND resolved_by IS NULL FROM public.agent_run_approvals WHERE id = '${A_PEER}';`).trim() === 't',
      'blocked peer resolution leaves protected approval pending and unclaimed',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U1,
        `UPDATE public.agent_run_approvals SET status = 'approved' WHERE id = '${A_PEER}' RETURNING id;`,
      ).includes(A_PEER),
      'the exact requester can resolve their protected Chat approval',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U2,
        `UPDATE public.agent_run_approvals SET payload = payload || jsonb_build_object(
          'dispatchReceiptSchemaVersion', 2,
          'dispatchBindingDigest', 'authority-v2:sha256:${'b'.repeat(64)}',
          'dispatchConsumedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) WHERE id = '${A_PEER}' RETURNING id;`,
      ).trim() === '',
      'a circle peer cannot consume a requester-resolved protected approval',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U2,
        `UPDATE public.agent_run_approvals SET status = 'approved' WHERE id = '${A_OFFICE}' RETURNING id;`,
      ).includes(A_OFFICE),
      'unrelated Office approval behavior remains compatible',
    );
    postgresAssertions += 1;
    check(
      !asAuthenticated(
        U2,
        `DELETE FROM public.agent_runs WHERE id = '${RUN_CURRENT}' RETURNING id;`,
      ).includes(RUN_CURRENT),
      'a peer cannot delete another owner protected Chat run through broad compatibility policy',
    );
    postgresAssertions += 1;

    const okDigest = digestFor(A_OK, RUN_CURRENT);
    check(
      asAuthenticated(U1, preflight({ approvalId: A_OK, bindingDigest: okDigest })).trim().endsWith('t'),
      'read-only preflight admits the exact eligible source before custody claim',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT NOT (payload ? 'dispatchBindingDigest') FROM public.agent_run_approvals WHERE id = '${A_OK}';`).trim() === 't',
      'read-only preflight does not consume approval authority',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(U1, preflight({ approvalId: A_THREAD, currentRunId: RUN_WRONG_THREAD, threadId: T2, sourceMessageId: M2, bindingDigest: digestFor(A_THREAD, RUN_WRONG_THREAD) })).trim().endsWith('f'),
      'preflight fails closed for a different-thread dispatch',
    );
    postgresAssertions += 1;
    const ok = asAuthenticated(U1, call({ approvalId: A_OK, bindingDigest: okDigest }));
    check(ok.includes(`${A_OK}|${RUN_SOURCE}|${RUN_CURRENT}|${C1}|${T1}|${M1}|${TOOL}|${DIGEST}|cross_run|approved|${okDigest}|`), 'exact eligible approval consumes and returns a bound receipt');
    postgresAssertions += 1;
    check(
      sql(`SELECT payload->>'dispatchBindingDigest' FROM public.agent_run_approvals WHERE id = '${A_OK}';`).trim() === okDigest,
      'successful RPC stamps exactly one canonical dispatch binding',
    );
    postgresAssertions += 1;

    expectAuthenticatedError(
      U1,
      call({ approvalId: A_OK, currentRunId: RUN_REPLAY, bindingDigest: digestFor(A_OK, RUN_REPLAY) }),
      /openswan_chat_approval_resume_approval_not_live/,
      'an already-consumed approval cannot replay into another run',
    );
    expectAuthenticatedError(
      U2,
      call({ approvalId: A_USER, currentRunId: RUN_REPLAY, bindingDigest: digestFor(A_USER, RUN_REPLAY) }),
      /openswan_chat_approval_resume_source_run_not_eligible|openswan_chat_approval_resume_current_run_not_eligible/,
      'another circle member cannot consume the requester approval',
    );
    expectAuthenticatedError(
      U1,
      call({ approvalId: A_THREAD, currentRunId: RUN_WRONG_THREAD, threadId: T2, sourceMessageId: M2, bindingDigest: digestFor(A_THREAD, RUN_WRONG_THREAD) }),
      /openswan_chat_approval_resume_source_run_not_eligible/,
      'a same-circle different-thread run cannot consume the approval',
    );
    expectAuthenticatedError(
      U1,
      call({ approvalId: A_EXPIRED, bindingDigest: digestFor(A_EXPIRED, RUN_CURRENT) }),
      /openswan_chat_approval_resume_approval_not_live/,
      'database clock rejects an expired approval',
    );
    expectAuthenticatedError(
      U1,
      call({ approvalId: A_AUTO, bindingDigest: digestFor(A_AUTO, RUN_CURRENT) }),
      /openswan_chat_approval_resume_approval_not_live/,
      'category-auto approval cannot enter the cross-run RPC',
    );
    expectAuthenticatedError(
      U1,
      call({ approvalId: A_BOT, sourceMessageId: MBOT, bindingDigest: digestFor(A_BOT, RUN_CURRENT) }),
      /openswan_chat_approval_resume_source_run_not_eligible|openswan_chat_approval_resume_current_run_not_eligible|openswan_chat_approval_resume_source_message_invalid/,
      'a bot message cannot become human source lineage or resume authority',
    );

    asServiceRole(`UPDATE public.agent_runs SET status = 'completed' WHERE id = '${RUN_CURRENT}';`);
    const statusDigest = digestFor(A_STATUS, RUN_CURRENT);
    expectAuthenticatedError(
      U1,
      call({ approvalId: A_STATUS, bindingDigest: statusDigest }),
      /openswan_chat_approval_resume_current_run_not_eligible/,
      'a terminal dispatch-run status race fails closed before approval consumption',
    );
    check(
      sql(`SELECT NOT (payload ? 'dispatchBindingDigest') FROM public.agent_run_approvals WHERE id = '${A_STATUS}';`).trim() === 't',
      'failed status race leaves approval authority unconsumed',
    );
    postgresAssertions += 1;

    const pendingRaceRun = '50000000-0000-4000-8000-000000000007';
    const pendingRaceApproval = '60000000-0000-4000-8000-000000000008';
    sqlFile(`
      SET ROLE service_role;
      INSERT INTO public.agent_runs(id, circle_id, user_id, surface, provider, status, metadata, thread_id, source_message_id)
      VALUES ('${pendingRaceRun}', '${C1}', '${U1}', 'main_chat', 'openswan', 'running', '{}'::jsonb, '${T1}', '${M1}');
      INSERT INTO public.agent_run_approvals(
        id, run_id, circle_id, status, requested_by, resolved_by,
        requested_at, resolved_at, timeout_seconds, metadata, payload
      ) VALUES (
        '${pendingRaceApproval}', '${RUN_SOURCE}', '${C1}', 'approved', '${U1}', '${U1}',
        clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 seconds',
        600, '{}'::jsonb, ${sqlLiteral(payloadAsk)}::jsonb
      );
      RESET ROLE;
    `);
    const raceDigest = digestFor(pendingRaceApproval, pendingRaceRun);
    const consumeSql = `
      BEGIN;
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${U1}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      ${call({ approvalId: pendingRaceApproval, currentRunId: pendingRaceRun, bindingDigest: raceDigest })}
      SELECT pg_sleep(1.2);
      COMMIT;
    `;
    const statusSql = `
      SELECT pg_sleep(0.2);
      SET ROLE service_role;
      UPDATE public.agent_runs SET status = 'completed' WHERE id = '${pendingRaceRun}';
    `;
    const raceStartedAt = Date.now();
    run('sh', [
      '-c',
      'psql -X -v ON_ERROR_STOP=1 -Atq -c "$1" & first_pid=$!; psql -X -v ON_ERROR_STOP=1 -Atq -c "$2"; wait "$first_pid"',
      'openswan-chat-resume-race',
      consumeSql,
      statusSql,
    ]);
    const raceElapsedMs = Date.now() - raceStartedAt;
    check(raceElapsedMs >= 1000, 'status transition waits for the consuming run-row lock');
    postgresAssertions += 1;
    check(
      sql(`SELECT status FROM public.agent_runs WHERE id = '${pendingRaceRun}';`).trim() === 'completed'
      && sql(`SELECT payload->>'dispatchBindingDigest' FROM public.agent_run_approvals WHERE id = '${pendingRaceApproval}';`).trim() === raceDigest,
      'status changes only after the consuming transaction releases its run lock',
    );
    postgresAssertions += 1;

    check(
      sql(`SELECT has_function_privilege('authenticated', 'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)', 'EXECUTE');`).trim() === 't',
      'catalog grants only authenticated execution for both RPCs',
    );
    postgresAssertions += 1;
  } finally {
    if (serverStarted) {
      try {
        run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Keep the original failure; temp cleanup still runs.
      }
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
} else {
  process.stdout.write(
    'Disposable PostgreSQL behavior skipped: initdb/pg_ctl/psql not all available.\n',
  );
}

process.stdout.write(
  `OpenSwan Chat approval-resume SQL authority smoke: ${assertions} assertions passed`
  + (postgresAssertions > 0 ? ` (${postgresAssertions} PostgreSQL behaviors).\n` : '.\n'),
);
