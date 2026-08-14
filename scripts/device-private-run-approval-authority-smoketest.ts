/**
 * Source + disposable-Postgres smoke for SQL §41 device-private approval
 * resolver authority.
 *
 * Run:
 *   npx tsx scripts/device-private-run-approval-authority-smoketest.ts
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260813180000_device_private_run_approval_authority.sql',
);
const consolidatedPath = resolve(process.cwd(), 'docs/RUN_THIS_SQL.sql');
const packagePath = resolve(process.cwd(), 'package.json');
const roadmapPath = resolve(process.cwd(), 'docs/AGENTS_ROADMAP.md');

const migrationSql = readFileSync(migrationPath, 'utf8');
const consolidatedSql = readFileSync(consolidatedPath, 'utf8');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  scripts?: Record<string, string>;
};
const roadmap = readFileSync(roadmapPath, 'utf8');
const migrationNames = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function has(source: string, value: string, message: string): void {
  check(source.includes(value), message);
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

// ── Static authority and parity contract ──────────────────────────────────

has(migrationSql, 'BEGIN;', 'migration changes are transactional');
has(migrationSql, 'COMMIT;', 'migration commits atomically');
has(
  migrationSql,
  "to_regprocedure('public.guard_tool_v2_run_approval()') IS NULL",
  'migration fails closed unless the §28 state machine is installed',
);
has(
  migrationSql,
  'device_private_run_approval_authority: apply SQL section 28 first',
  'missing dependency has stable operator recovery',
);
has(
  migrationSql,
  'ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;',
  'approval RLS remains enabled',
);
has(
  migrationSql,
  'DROP POLICY IF EXISTS agent_run_approvals_device_private_select_guard_v1',
  'named privacy policy is replaced idempotently',
);
has(
  migrationSql,
  'CREATE POLICY agent_run_approvals_device_private_select_guard_v1',
  'one canonical device-private privacy policy is installed',
);
has(
  migrationSql,
  'DROP POLICY IF EXISTS agent_run_approvals_device_private_update_guard_v1',
  'named authority policy is replaced idempotently',
);
has(
  migrationSql,
  'CREATE POLICY agent_run_approvals_device_private_update_guard_v1',
  'one canonical device-private policy is installed',
);
check(
  (migrationSql.match(/CREATE POLICY agent_run_approvals_device_private_select_guard_v1/g) || []).length === 1,
  'migration creates the canonical privacy policy exactly once',
);
check(
  (migrationSql.match(/CREATE POLICY agent_run_approvals_device_private_update_guard_v1/g) || []).length === 1,
  'migration creates the canonical authority policy exactly once',
);
check(
  (migrationSql.match(/AS RESTRICTIVE/g) || []).length === 2,
  'permissive circle-policy drift cannot bypass privacy or update authority',
);
has(migrationSql, 'FOR SELECT', 'privacy guard applies to authenticated reads');
has(migrationSql, 'FOR UPDATE', 'guard applies only to approval updates');
has(migrationSql, 'TO authenticated', 'guard applies at the authenticated database role');
check(
  (migrationSql.match(/USING \(/g) || []).length === 2,
  'read visibility and old-row update visibility are both guarded',
);
has(migrationSql, 'WITH CHECK (', 'new-row authority remains valid after the update');
check(
  (migrationSql.match(/payload->>'approvalSchemaVersion' = '2'/g) || []).length === 5,
  'privacy, authority, and state-machine predicates require canonical schema v2',
);
check(
  (migrationSql.match(/payload->>'toolName' = 'desktop\.open_attachment'/g) || []).length === 3,
  'read, old-update, and new-update expressions require the exact desktop tool',
);
check(
  (migrationSql.match(/requested_by = auth\.uid\(\)::text/g) || []).length === 3,
  'read, old-update, and new-update expressions bind the exact requesting user',
);
check(
  (migrationSql.match(/NOT COALESCE\(/g) || []).length === 3,
  'legacy, unrelated, and null-shaped payloads remain outside the private predicate',
);
check(
  !migrationSql.includes('DROP POLICY IF EXISTS approvals_via_circle'),
  'migration does not replace the existing permissive compatibility policy',
);
check(
  !migrationSql.includes('CREATE OR REPLACE FUNCTION public.guard_tool_v2_run_approval'),
  'migration composes with rather than forks the schema-v2 state machine',
);
has(
  migrationSql,
  'DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_update',
  '§28 update trigger is replaced idempotently',
);
has(
  migrationSql,
  "current_user NOT IN ('postgres', 'supabase_admin', 'service_role')",
  'only actual trusted database roles bypass the transition trigger',
);
has(
  migrationSql,
  'EXECUTE FUNCTION public.guard_tool_v2_run_approval();',
  'authenticated updates still enter the canonical §28 state machine',
);
has(migrationSql, "NOTIFY pgrst, 'reload schema';", 'PostgREST schema cache is reloaded');
has(migrationSql, 'AS device_private_approval_select_guard_ready', 'readiness reports privacy convergence');
has(migrationSql, 'AS device_private_approval_update_guard_ready', 'readiness reports update convergence');
has(migrationSql, 'AS device_private_approval_state_machine_ready', 'readiness reports §28 trigger convergence');

check(
  consolidatedSql.includes('-- §41. Device-private run-approval privacy and authority (2026-08-13)'),
  'consolidated SQL registers §41',
);
check(
  consolidatedSql.includes(migrationSql.trim()),
  '§41 mirrors the complete migration exactly',
);
check(
  packageJson.scripts?.['smoke:device-private-run-approval-authority']
    === 'npx tsx scripts/device-private-run-approval-authority-smoketest.ts',
  'package exposes the focused smoke',
);
has(
  packageJson.scripts?.['check:openswan-multi-action'] || '',
  'npm run smoke:device-private-run-approval-authority',
  'OpenSwan attachment aggregate includes the focused smoke',
);
has(
  roadmap,
  '20260813180000_device_private_run_approval_authority.sql',
  'roadmap ownership lists the canonical migration',
);
has(roadmap, '| 41 | Device-private', 'roadmap SQL checklist tracks §41');

const orderedAugust13Migrations = [
  '20260813140000_office_layout_exact_save_receipt.sql',
  '20260813160000_message_attachment_link_integrity.sql',
  '20260813170000_message_attachment_visibility_integrity.sql',
  '20260813180000_device_private_run_approval_authority.sql',
] as const;
for (const name of orderedAugust13Migrations) {
  check(migrationNames.includes(name), `${name} uses its canonical timestamped migration name`);
}
check(
  orderedAugust13Migrations.every((name, index) => (
    index === 0
    || migrationNames.indexOf(orderedAugust13Migrations[index - 1]) < migrationNames.indexOf(name)
  )),
  '§39, §40, and §41 apply in exact dependency order after the existing 14:00 migration',
);
const timestampVersions = migrationNames.flatMap((name) => {
  const match = /^(\d{14})_/.exec(name);
  return match ? [match[1]] : [];
});
check(
  new Set(timestampVersions).size === timestampVersions.length,
  'every 14-digit Supabase migration version is unique',
);
const attachmentAuthorityMigrationNames = migrationNames.filter((name) => (
  name.endsWith('_message_attachment_link_integrity.sql')
  || name.endsWith('_message_attachment_visibility_integrity.sql')
  || name.endsWith('_device_private_run_approval_authority.sql')
));
check(
  JSON.stringify(attachmentAuthorityMigrationNames)
    === JSON.stringify(orderedAugust13Migrations.slice(1)),
  'only the three canonical timestamped §39-41 migration files exist',
);
check(
  consolidatedSql.indexOf('-- §39.') < consolidatedSql.indexOf('-- §40.')
    && consolidatedSql.indexOf('-- §40.') < consolidatedSql.indexOf('-- §41.'),
  'consolidated SQL preserves §39 -> §40 -> §41 dependency order',
);

// ── Disposable PostgreSQL behavior ────────────────────────────────────────

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
      ['-n', '-u', workspaceOwner, 'mktemp', '-d', '/tmp/uc-private-approval-sql-XXXXXX'],
      { encoding: 'utf8' },
    ).trim()
    : mkdtempSync('/tmp/uc-private-approval-sql-');
  const dataDir = resolve(tempRoot, 'data');
  const socketDir = resolve(tempRoot, 'socket');
  const port = String(56_000 + (process.pid % 1_000));
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
  const sql = (value: string): string => run(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', value],
  );
  const asAuthenticated = (userId: string, statement: string): string => sql(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    ${statement}
  `);
  const asServiceRole = (userId: string, statement: string): string => sql(`
    SET ROLE service_role;
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
    SELECT set_config('request.jwt.claim.role', 'service_role', false);
    ${statement}
  `);
  const asPostgres = (statement: string): string => sql(`
    SET ROLE postgres;
    ${statement}
  `);

  const U1 = '10000000-0000-4000-8000-000000000001';
  const U2 = '10000000-0000-4000-8000-000000000002';
  const A_APPROVE = '20000000-0000-4000-8000-000000000001';
  const A_REJECT = '20000000-0000-4000-8000-000000000002';
  const A_CONSUME = '20000000-0000-4000-8000-000000000003';
  const A_FOREIGN_CONSUME = '20000000-0000-4000-8000-000000000004';
  const A_SERVICE = '20000000-0000-4000-8000-000000000005';
  const A_OTHER_TOOL = '20000000-0000-4000-8000-000000000006';
  const A_LEGACY = '20000000-0000-4000-8000-000000000007';
  const canonicalPayload = JSON.stringify({
    approvalSchemaVersion: '2',
    toolName: 'desktop.open_attachment',
    approvalMode: 'ask',
    toolApprovalDigest: `authority-v2:sha256:${'a'.repeat(64)}`,
  });

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
      CREATE ROLE postgres NOLOGIN SUPERUSER BYPASSRLS;

      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
      $$;

      CREATE TABLE public.agent_run_approvals (
        id uuid PRIMARY KEY,
        payload jsonb,
        status text NOT NULL DEFAULT 'pending',
        requested_by text,
        resolved_by uuid,
        resolved_at timestamptz,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );

      -- Minimal §28-shaped trigger seam. It deliberately raises for a request
      -- that merely claims service_role, so §41 proves maintenance bypass is
      -- based on current_user while authenticated updates still enter the
      -- canonical function.
      CREATE FUNCTION public.guard_tool_v2_run_approval() RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        IF COALESCE(auth.role(), '') <> 'authenticated' THEN
          RAISE EXCEPTION 'test_tool_v2_state_machine_rejected_claimed_role';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER trg_guard_tool_v2_run_approval_update
      BEFORE UPDATE ON public.agent_run_approvals
      FOR EACH ROW
      WHEN (
        (
          OLD.payload->>'approvalSchemaVersion' = '2'
          AND (OLD.payload ? 'toolName' OR OLD.payload ? 'toolApprovalDigest')
        )
        OR (
          NEW.payload->>'approvalSchemaVersion' = '2'
          AND (NEW.payload ? 'toolName' OR NEW.payload ? 'toolApprovalDigest')
        )
      )
      EXECUTE FUNCTION public.guard_tool_v2_run_approval();

      ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;
      CREATE POLICY approvals_via_circle_test
      ON public.agent_run_approvals
      FOR ALL
      TO PUBLIC
      USING (true)
      WITH CHECK (true);

      GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, service_role;
      GRANT SELECT, UPDATE ON public.agent_run_approvals TO authenticated;
      GRANT SELECT, UPDATE ON public.agent_run_approvals TO service_role;
    `);

    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);
    run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);

    sql(`
      INSERT INTO public.agent_run_approvals
        (id, payload, status, requested_by)
      VALUES
        ('${A_APPROVE}', '${canonicalPayload}'::jsonb, 'pending', '${U1}'),
        ('${A_REJECT}', '${canonicalPayload}'::jsonb, 'pending', '${U1}'),
        ('${A_CONSUME}', '${canonicalPayload}'::jsonb, 'approved', '${U1}'),
        ('${A_FOREIGN_CONSUME}', '${canonicalPayload}'::jsonb, 'approved', '${U1}'),
        ('${A_SERVICE}', '${canonicalPayload}'::jsonb, 'approved', '${U1}'),
        (
          '${A_OTHER_TOOL}',
          '{"approvalSchemaVersion":"2","toolName":"browser.navigate"}'::jsonb,
          'pending',
          '${U1}'
        ),
        (
          '${A_LEGACY}',
          '{"toolName":"desktop.open_attachment"}'::jsonb,
          'pending',
          '${U1}'
        );
    `);

    check(
      sql(`SELECT count(*) FROM pg_catalog.pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'agent_run_approvals'
             AND policyname = 'approvals_via_circle_test'
             AND permissive = 'PERMISSIVE'
             AND cmd = 'ALL'
             AND roles = ARRAY['public']::name[];`).trim() === '1',
      'behavior probe includes a hostile broad permissive circle policy',
    );
    postgresAssertions += 1;
    const foreignRead = asAuthenticated(
      U2,
      `SELECT id FROM public.agent_run_approvals WHERE id = '${A_APPROVE}';`,
    );
    check(!foreignRead.includes(A_APPROVE), 'another member cannot read the requester approval payload');
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U1,
        `SELECT id FROM public.agent_run_approvals WHERE id = '${A_APPROVE}';`,
      ).includes(A_APPROVE),
      'requester may read their canonical device-private approval',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U2,
        `SELECT id FROM public.agent_run_approvals WHERE id = '${A_OTHER_TOOL}';`,
      ).includes(A_OTHER_TOOL),
      'ordinary approvals retain the broad circle read behavior',
    );
    postgresAssertions += 1;

    const foreignApprove = asAuthenticated(
      U2,
      `UPDATE public.agent_run_approvals
       SET status = 'approved', requested_by = '${U2}'
       WHERE id = '${A_APPROVE}'
       RETURNING id;`,
    );
    check(!foreignApprove.includes(A_APPROVE), 'another member cannot adopt and approve the requester row');
    postgresAssertions += 1;
    check(
      sql(`SELECT status || ':' || requested_by FROM public.agent_run_approvals WHERE id = '${A_APPROVE}';`).trim()
        === `pending:${U1}`,
      'denied adoption leaves status and old requester intact',
    );
    postgresAssertions += 1;

    check(
      asAuthenticated(
        U1,
        `UPDATE public.agent_run_approvals
         SET status = 'approved', resolved_by = '${U1}', resolved_at = clock_timestamp()
         WHERE id = '${A_APPROVE}'
         RETURNING status;`,
      ).trim().endsWith('approved'),
      'requester may approve the canonical device-private row',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U1,
        `UPDATE public.agent_run_approvals
         SET status = 'rejected', resolved_by = '${U1}', resolved_at = clock_timestamp()
         WHERE id = '${A_REJECT}'
         RETURNING status;`,
      ).trim().endsWith('rejected'),
      'requester may reject the canonical device-private row',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U1,
        `UPDATE public.agent_run_approvals
         SET payload = payload || jsonb_build_object(
           'dispatchReceiptSchemaVersion', 2,
           'dispatchBindingDigest', 'authority-v2:sha256:${'b'.repeat(64)}',
           'dispatchConsumedAt', clock_timestamp()
         )
         WHERE id = '${A_CONSUME}'
         RETURNING payload->>'dispatchBindingDigest';`,
      ).trim().endsWith(`authority-v2:sha256:${'b'.repeat(64)}`),
      'requester may consume the canonical device-private approval',
    );
    postgresAssertions += 1;

    const foreignConsume = asAuthenticated(
      U2,
      `UPDATE public.agent_run_approvals
       SET payload = payload || '{"dispatchReceiptSchemaVersion":2}'::jsonb
       WHERE id = '${A_FOREIGN_CONSUME}'
       RETURNING id;`,
    );
    check(!foreignConsume.includes(A_FOREIGN_CONSUME), 'another member cannot consume the requester approval');
    postgresAssertions += 1;
    check(
      sql(`SELECT NOT (payload ? 'dispatchReceiptSchemaVersion') FROM public.agent_run_approvals WHERE id = '${A_FOREIGN_CONSUME}';`).trim() === 't',
      'denied foreign consumption leaves the payload unchanged',
    );
    postgresAssertions += 1;

    check(
      asAuthenticated(
        U1,
        `UPDATE public.agent_run_approvals
         SET status = status
         WHERE id = '${A_APPROVE}'
         RETURNING id;`,
      ).includes(A_APPROVE),
      'requester no-op retry remains idempotently allowed',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U2,
        `UPDATE public.agent_run_approvals
         SET metadata = '{"reviewed":true}'::jsonb
         WHERE id = '${A_OTHER_TOOL}'
         RETURNING id;`,
      ).includes(A_OTHER_TOOL),
      'unrelated schema-v2 tool rows remain outside the device-private guard',
    );
    postgresAssertions += 1;
    check(
      asAuthenticated(
        U2,
        `UPDATE public.agent_run_approvals
         SET metadata = '{"legacy":true}'::jsonb
         WHERE id = '${A_LEGACY}'
         RETURNING id;`,
      ).includes(A_LEGACY),
      'legacy desktop approval rows remain outside the canonical predicate',
    );
    postgresAssertions += 1;

    check(
      asServiceRole(
        U2,
        `UPDATE public.agent_run_approvals
         SET metadata = '{"serviceMaintenance":true}'::jsonb
         WHERE id = '${A_SERVICE}'
         RETURNING id;`,
      ).includes(A_SERVICE),
      'service_role BYPASSRLS maintenance remains available for a foreign requester row',
    );
    postgresAssertions += 1;
    check(
      asServiceRole(
        U2,
        `SELECT id FROM public.agent_run_approvals WHERE id = '${A_SERVICE}';`,
      ).includes(A_SERVICE),
      'service_role BYPASSRLS read maintenance remains available',
    );
    postgresAssertions += 1;
    check(
      asPostgres(`UPDATE public.agent_run_approvals
                  SET metadata = metadata || '{"postgresMaintenance":true}'::jsonb
                  WHERE id = '${A_SERVICE}'
                  RETURNING id;`).includes(A_SERVICE),
      'postgres role maintenance remains available',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT count(*) FROM pg_catalog.pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'agent_run_approvals'
             AND policyname = 'agent_run_approvals_device_private_select_guard_v1';`).trim() === '1',
      'reapplying the migration converges to exactly one restrictive privacy policy',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT count(*) FROM pg_catalog.pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'agent_run_approvals'
             AND policyname = 'agent_run_approvals_device_private_update_guard_v1';`).trim() === '1',
      'reapplying the migration converges to exactly one restrictive policy',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT permissive || ':' || cmd || ':' || array_to_string(roles, ',')
           FROM pg_catalog.pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'agent_run_approvals'
             AND policyname = 'agent_run_approvals_device_private_select_guard_v1';`).trim()
        === 'RESTRICTIVE:SELECT:authenticated',
      'catalog records the exact restrictive authenticated SELECT boundary',
    );
    postgresAssertions += 1;
    check(
      sql(`SELECT permissive || ':' || cmd || ':' || array_to_string(roles, ',')
           FROM pg_catalog.pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'agent_run_approvals'
             AND policyname = 'agent_run_approvals_device_private_update_guard_v1';`).trim()
        === 'RESTRICTIVE:UPDATE:authenticated',
      'catalog records the exact restrictive authenticated UPDATE boundary',
    );
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
  process.stdout.write(
    'Disposable PostgreSQL behavior skipped: initdb/pg_ctl/psql not all available.\n',
  );
}

process.stdout.write(
  `device-private run-approval authority smoke: ${assertions} assertions passed`
  + (postgresAssertions > 0 ? ` (${postgresAssertions} PostgreSQL behaviors).\n` : '.\n'),
);
