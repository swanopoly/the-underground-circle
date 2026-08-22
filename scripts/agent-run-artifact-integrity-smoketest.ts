/**
 * Database-free integrity smoke for §38 and canonical Chat artifact hydration.
 *
 * Run:
 *   npx tsx scripts/agent-run-artifact-integrity-smoketest.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260812_agent_run_artifact_integrity.sql',
);
const consolidatedPath = resolve(process.cwd(), 'docs/RUN_THIS_SQL.sql');
const agentRunSystemPath = resolve(process.cwd(), 'src/lib/agentRunSystem.ts');
const chatTabPath = resolve(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx');
const migrationSql = readFileSync(migrationPath, 'utf8');
const consolidatedSql = readFileSync(consolidatedPath, 'utf8');
const agentRunSystemSource = readFileSync(agentRunSystemPath, 'utf8');
const chatTabSource = readFileSync(chatTabPath, 'utf8');
const agentRunSystemAst = ts.createSourceFile(
  agentRunSystemPath,
  agentRunSystemSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);
const chatTabAst = ts.createSourceFile(
  chatTabPath,
  chatTabSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TSX,
);

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function has(source: string, value: string, message: string): void {
  check(source.includes(value), message);
}

function sqlSection(start: string, end: string): string {
  const startIndex = migrationSql.indexOf(start);
  check(startIndex >= 0, `SQL section starts with ${start}`);
  const endIndex = migrationSql.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `SQL section ends with ${end}`);
  return migrationSql.slice(startIndex, endIndex);
}

function declarationText(
  sourceFile: ts.SourceFile,
  name: string,
): string {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement))
      && statement.name?.text === name
    ) return statement.getText(sourceFile);
    if (
      ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => (
        ts.isIdentifier(declaration.name) && declaration.name.text === name
      ))
    ) return statement.getText(sourceFile);
  }
  assert.fail(`declaration ${name} exists in ${sourceFile.fileName}`);
}

function transpileDeclarations(sourceFile: ts.SourceFile, names: string[]): string {
  const source = names.map((name) => (
    declarationText(sourceFile, name).replace(/^export\s+/, '')
  )).join('\n\n');
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
}

// ── SQL policy/grant convergence ───────────────────────────────────────────

check(
  (migrationSql.match(/CREATE POLICY agent_runs_owner_(?:insert|update|delete)_guard_v1/g) || []).length === 3,
  'agent_runs receives exactly three owner-bound restrictive policies',
);
for (const policyName of [
  'agent_runs_owner_insert_guard_v1',
  'agent_runs_owner_update_guard_v1',
  'agent_runs_owner_delete_guard_v1',
]) {
  const policy = sqlSection(
    `CREATE POLICY ${policyName}`,
    policyName === 'agent_runs_owner_delete_guard_v1'
      ? 'CREATE OR REPLACE FUNCTION public.guard_authenticated_agent_run_identity_v1()'
      : `DROP POLICY IF EXISTS ${policyName.replace(
          policyName.includes('insert') ? 'insert' : 'update',
          policyName.includes('insert') ? 'update' : 'delete',
        )}`,
  );
  has(policy, 'AS RESTRICTIVE', `${policyName} composes restrictively with the historical member policy`);
  has(policy, 'TO authenticated', `${policyName} applies at the authenticated client boundary`);
  has(policy, 'user_id = auth.uid()', `${policyName} binds the durable run owner`);
}
const runInsertPolicy = sqlSection(
  'CREATE POLICY agent_runs_owner_insert_guard_v1',
  'DROP POLICY IF EXISTS agent_runs_owner_update_guard_v1',
);
has(runInsertPolicy, 'FOR INSERT', 'run INSERT owner policy covers new parent-row forgery');
has(runInsertPolicy, 'WITH CHECK', 'run INSERT owner policy validates the new row');
const runUpdatePolicy = sqlSection(
  'CREATE POLICY agent_runs_owner_update_guard_v1',
  'DROP POLICY IF EXISTS agent_runs_owner_delete_guard_v1',
);
has(runUpdatePolicy, 'FOR UPDATE', 'run UPDATE owner policy covers parent-owner hijack');
has(runUpdatePolicy, 'USING', 'run UPDATE policy requires ownership of the old visible row');
has(runUpdatePolicy, 'WITH CHECK', 'run UPDATE policy retains ownership on the new row');
const runDeletePolicy = sqlSection(
  'CREATE POLICY agent_runs_owner_delete_guard_v1',
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_agent_run_identity_v1()',
);
has(runDeletePolicy, 'FOR DELETE', 'run DELETE owner policy closes cross-owner artifact cascade deletion');

const runIdentityGuard = sqlSection(
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_agent_run_identity_v1()',
  'DROP TRIGGER IF EXISTS trg_guard_authenticated_agent_run_identity_v1',
);
has(runIdentityGuard, "COALESCE(auth.role(), '') = 'service_role'", 'service-role maintenance bypass is explicit');
has(runIdentityGuard, "current_user IN ('postgres', 'supabase_admin', 'service_role')", 'trusted Postgres maintenance bypass is explicit');
has(runIdentityGuard, "IF TG_OP = 'INSERT'", 'identity trigger validates direct INSERT');
has(runIdentityGuard, 'NEW.user_id IS DISTINCT FROM actor_id', 'INSERT cannot claim another user as owner');
has(runIdentityGuard, "IF TG_OP = 'UPDATE'", 'identity trigger validates direct UPDATE');
has(runIdentityGuard, 'OLD.user_id IS DISTINCT FROM actor_id', 'only the existing run owner may update');
has(runIdentityGuard, 'NEW.id IS DISTINCT FROM OLD.id', 'run id is immutable');
has(runIdentityGuard, 'NEW.circle_id IS DISTINCT FROM OLD.circle_id', 'run circle is immutable');
has(runIdentityGuard, 'NEW.user_id IS DISTINCT FROM OLD.user_id', 'run owner is immutable');
has(runIdentityGuard, "RAISE EXCEPTION 'agent_run_owner_required'", 'ownership violations fail with a stable permission error');
has(runIdentityGuard, "RAISE EXCEPTION 'agent_run_identity_immutable'", 'identity rewrites fail with a stable permission error');
has(migrationSql, 'BEFORE INSERT OR UPDATE ON public.agent_runs', 'identity guard runs before every authenticated parent write');
has(migrationSql, 'REVOKE ALL ON FUNCTION public.guard_authenticated_agent_run_identity_v1()', 'identity trigger function is not directly callable');
has(migrationSql, 'AS agent_run_identity_guard_ready', 'readiness reports the installed identity trigger');
has(migrationSql, 'AS agent_run_owner_policies_ready', 'readiness reports all three restrictive owner policies');

has(migrationSql, "tablename = 'agent_run_artifacts'", 'policy convergence is artifact-table scoped');
has(migrationSql, "'DROP POLICY %I ON public.agent_run_artifacts'", 'all historical policy drift is removed');
check(
  (migrationSql.match(/CREATE POLICY agent_run_artifacts_/g) || []).length === 2,
  'migration creates exactly two canonical artifact policies',
);
has(migrationSql, 'CREATE POLICY agent_run_artifacts_select_circle_member', 'member SELECT policy exists');
has(migrationSql, 'FOR SELECT\nTO authenticated', 'member policy is SELECT-only');
has(migrationSql, 'public.user_is_circle_member(circle_id)', 'SELECT and INSERT require current circle membership');
has(migrationSql, 'CREATE POLICY agent_run_artifacts_insert_run_owner', 'run-owner INSERT policy exists');
has(migrationSql, 'FOR INSERT\nTO authenticated', 'owner policy is INSERT-only');
has(migrationSql, 'owning_run.id = agent_run_artifacts.run_id', 'INSERT binds the exact run');
has(migrationSql, 'owning_run.circle_id = agent_run_artifacts.circle_id', 'INSERT binds exact run/circle equality');
has(migrationSql, 'owning_run.user_id = auth.uid()', 'INSERT requires the authenticated run owner');
has(migrationSql, 'owning_step.run_id = agent_run_artifacts.run_id', 'optional step lineage stays in the exact run');
has(migrationSql, 'owning_step.circle_id = agent_run_artifacts.circle_id', 'optional step lineage stays in the exact circle');
const createdArtifactPolicies = migrationSql.match(
  /CREATE POLICY agent_run_artifacts_[\s\S]*?\n\);/g,
) || [];
check(
  createdArtifactPolicies.every((policy) => !/FOR (?:UPDATE|DELETE|ALL)\b/.test(policy)),
  'authenticated artifact policy has no UPDATE, DELETE, or ALL command',
);
has(migrationSql, 'REVOKE ALL ON TABLE public.agent_run_artifacts FROM PUBLIC, anon, authenticated;', 'broad table grants are revoked');
has(migrationSql, 'GRANT SELECT, INSERT ON TABLE public.agent_run_artifacts TO authenticated;', 'authenticated receives only read/create grants');
has(migrationSql, 'GRANT ALL ON TABLE public.agent_run_artifacts TO service_role;', 'trusted service role maintenance remains available');
has(migrationSql, "NOT has_table_privilege('authenticated', 'public.agent_run_artifacts', 'UPDATE')", 'readiness proves UPDATE grant absent');
has(migrationSql, "NOT has_table_privilege('authenticated', 'public.agent_run_artifacts', 'DELETE')", 'readiness proves DELETE grant absent');

const migrationTransaction = migrationSql.slice(
  migrationSql.indexOf('BEGIN;'),
  migrationSql.indexOf("NOTIFY pgrst, 'reload schema';") + "NOTIFY pgrst, 'reload schema';".length,
);
check(migrationTransaction.startsWith('BEGIN;'), 'migration transaction is locatable');
check(consolidatedSql.includes('-- §38. Agent-run artifact integrity (2026-08-12)'), 'consolidated SQL registers §38');
check(consolidatedSql.includes(migrationTransaction), '§38 mirrors the executable migration transaction exactly');

// ── Exact digest and addArtifact returned-row verification ─────────────────

const artifactRuntimeJavaScript = transpileDeclarations(agentRunSystemAst, [
  'AGENT_RUN_ARTIFACT_CONTENT_DIGEST_VERSION',
  'AGENT_RUN_ARTIFACT_CONTENT_DIGEST_PREFIX',
  'AGENT_RUN_ARTIFACT_CONTENT_DIGEST_RE',
  'AgentRunArtifactContentDigestMetadata',
  'artifactContentUtf8Bytes',
  'buildAgentRunArtifactContentDigest',
  'readAgentRunArtifactContentDigest',
  'verifyAgentRunArtifactContentDigest',
  'metadataValueMatches',
  'addArtifact',
]);

type InsertPayload = Record<string, unknown>;
type ReturnedArtifactRow = Record<string, unknown>;

function loadArtifactRuntime(
  mutateReturnedRow: (row: ReturnedArtifactRow, payload: InsertPayload) => ReturnedArtifactRow = (row) => row,
): {
  addArtifact: (opts: Record<string, unknown>) => Promise<ReturnedArtifactRow | null>;
  buildDigest: (content: string) => string;
  verifyDigest: (content: unknown, rowMetadata: unknown, pointerMetadata: unknown) => boolean;
  inserted: InsertPayload[];
} {
  const inserted: InsertPayload[] = [];
  const supabase = {
    from(table: string) {
      check(table === 'agent_run_artifacts', 'addArtifact writes only the canonical artifact table');
      let payload: InsertPayload = {};
      return {
        insert(value: InsertPayload) {
          payload = structuredClone(value);
          inserted.push(structuredClone(value));
          return this;
        },
        select() { return this; },
        async single() {
          const row: ReturnedArtifactRow = {
            id: '11111111-1111-4111-8111-111111111111',
            run_id: payload.run_id,
            circle_id: payload.circle_id,
            step_id: payload.step_id ?? null,
            artifact_kind: payload.artifact_kind,
            title: payload.title,
            content: payload.content ?? null,
            url: payload.url ?? null,
            file_path: payload.file_path ?? null,
            version: 1,
            is_published: false,
            created_at: '2026-08-12T00:00:00.000Z',
            metadata: structuredClone(payload.metadata),
          };
          return { data: mutateReturnedRow(row, payload), error: null };
        },
      };
    },
  };
  const mapArtifact = (row: ReturnedArtifactRow) => row;
  const factory = new Function(
    'supabase',
    'mapArtifact',
    'console',
    `'use strict';\n${artifactRuntimeJavaScript}\nreturn { addArtifact, buildAgentRunArtifactContentDigest, verifyAgentRunArtifactContentDigest };`,
  );
  const loaded = factory(supabase, mapArtifact, { error: () => undefined }) as {
    addArtifact: (opts: Record<string, unknown>) => Promise<ReturnedArtifactRow | null>;
    buildAgentRunArtifactContentDigest: (content: string) => string;
    verifyAgentRunArtifactContentDigest: (content: unknown, rowMetadata: unknown, pointerMetadata: unknown) => boolean;
  };
  return {
    addArtifact: loaded.addArtifact,
    buildDigest: loaded.buildAgentRunArtifactContentDigest,
    verifyDigest: loaded.verifyAgentRunArtifactContentDigest,
    inserted,
  };
}

async function main(): Promise<void> {
const runtime = loadArtifactRuntime();
for (const content of ['', 'abc', 'OpenSwan 🦢', 'line one\nline two']) {
  check(
    runtime.buildDigest(content) === `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
    `pure runtime SHA-256 matches Node for ${JSON.stringify(content)}`,
  );
}

const exactArtifact = await runtime.addArtifact({
  runId: 'run-exact',
  circleId: 'circle-exact',
  stepId: 'step-exact',
  artifactKind: 'report',
  title: 'Integrity report',
  content: 'trusted canonical content',
  metadata: {
    source: 'openswan_action_artifact',
    actionId: 'A1',
    contentDigestVersion: 999,
    contentDigest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  },
});
check(exactArtifact !== null, 'exact returned artifact row is accepted');
const insertedMetadata = runtime.inserted[0]?.metadata as Record<string, unknown>;
check(insertedMetadata.contentDigestVersion === 1, 'caller cannot spoof the reserved digest version');
check(
  insertedMetadata.contentDigest === runtime.buildDigest('trusted canonical content'),
  'addArtifact computes the exact content digest itself',
);
check(
  exactArtifact?.metadata && runtime.verifyDigest(
    exactArtifact.content,
    exactArtifact.metadata,
    insertedMetadata,
  ),
  'returned content, row digest, and independent pointer digest agree',
);

async function addArtifactMustFail(
  label: string,
  mutate: (row: ReturnedArtifactRow, payload: InsertPayload) => ReturnedArtifactRow,
): Promise<void> {
  const candidate = loadArtifactRuntime(mutate);
  const result = await candidate.addArtifact({
    runId: 'run-exact',
    circleId: 'circle-exact',
    artifactKind: 'report',
    title: 'Integrity report',
    content: 'trusted canonical content',
    metadata: { source: 'openswan_action_artifact', actionId: 'A1' },
  });
  check(result === null, `${label} fails closed`);
}

await addArtifactMustFail('returned content tamper', (row) => ({ ...row, content: 'tampered' }));
await addArtifactMustFail('returned run mismatch', (row) => ({ ...row, run_id: 'run-other' }));
await addArtifactMustFail('returned circle mismatch', (row) => ({ ...row, circle_id: 'circle-other' }));
await addArtifactMustFail('returned title mismatch', (row) => ({ ...row, title: 'Other title' }));
await addArtifactMustFail('missing returned id', (row) => ({ ...row, id: '' }));
await addArtifactMustFail('returned digest tamper', (row) => ({
  ...row,
  metadata: {
    ...(row.metadata as Record<string, unknown>),
    contentDigest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  },
}));
await addArtifactMustFail('unexpected returned metadata', (row) => ({
  ...row,
  metadata: { ...(row.metadata as Record<string, unknown>), injected: true },
}));

// ── Chat hydration requires independent pointer + row digest agreement ─────

const hydrateJavaScript = transpileDeclarations(chatTabAst, [
  'hydrateCanonicalActionArtifacts',
]);
type HydratableMessage = {
  id: string;
  runId?: string;
  artifacts?: Array<Record<string, any>>;
};
function loadHydrator(rows: ReturnedArtifactRow[]) {
  const calls: Array<{ circleId: string; ids: readonly string[] }> = [];
  const getRunArtifactsByIds = async (circleId: string, ids: readonly string[]) => {
    calls.push({ circleId, ids: [...ids] });
    return rows;
  };
  const factory = new Function(
    'getRunArtifactsByIds',
    'verifyAgentRunArtifactContentDigest',
    `'use strict';\n${hydrateJavaScript}\nreturn hydrateCanonicalActionArtifacts;`,
  );
  return {
    hydrate: factory(getRunArtifactsByIds, runtime.verifyDigest) as (
      messages: HydratableMessage[],
      circleId: string,
    ) => Promise<HydratableMessage[]>,
    calls,
  };
}

const canonicalContent = 'full canonical report content';
const canonicalDigest = runtime.buildDigest(canonicalContent);
const pointerMetadata = {
  source: 'openswan_action_artifact',
  actionId: 'A1',
  artifactKind: 'report',
  canonicalArtifactId: '11111111-1111-4111-8111-111111111111',
  contentTruncated: true,
  contentDigestVersion: 1,
  contentDigest: canonicalDigest,
};
const truncatedMessage: HydratableMessage = {
  id: 'message-exact',
  runId: 'run-exact',
  artifacts: [{
    kind: 'summary',
    title: 'Integrity report',
    content: 'full canonical',
    metadata: pointerMetadata,
  }],
};
const canonicalRow: ReturnedArtifactRow = {
  id: pointerMetadata.canonicalArtifactId,
  run_id: 'run-exact',
  circle_id: 'circle-exact',
  artifact_kind: 'report',
  title: 'Integrity report',
  content: canonicalContent,
  metadata: {
    source: 'openswan_action_artifact',
    actionId: 'A1',
    artifactKind: 'report',
    contentDigestVersion: 1,
    contentDigest: canonicalDigest,
  },
};

const exactHydrator = loadHydrator([canonicalRow]);
const hydrated = await exactHydrator.hydrate([truncatedMessage], 'circle-exact');
check(exactHydrator.calls.length === 1, 'exact hydration uses one bounded batch read');
check(hydrated[0]?.artifacts?.[0]?.content === canonicalContent, 'matching pointer and row digest hydrate full content');
check(hydrated[0]?.artifacts?.[0]?.metadata?.contentTruncated === false, 'verified hydration clears the truncated marker');

async function hydrationMustStayTruncated(
  label: string,
  row: ReturnedArtifactRow,
  message: HydratableMessage = truncatedMessage,
): Promise<void> {
  const hydrator = loadHydrator([row]);
  const result = await hydrator.hydrate([message], 'circle-exact');
  check(
    result[0]?.artifacts?.[0]?.content === message.artifacts?.[0]?.content,
    `${label} preserves only the bounded saved copy`,
  );
  check(
    result[0]?.artifacts?.[0]?.metadata?.contentTruncated === true,
    `${label} remains visibly truncated`,
  );
}

await hydrationMustStayTruncated('tampered content', { ...canonicalRow, content: `${canonicalContent}!` });
await hydrationMustStayTruncated('tampered row digest', {
  ...canonicalRow,
  metadata: { ...(canonicalRow.metadata as Record<string, unknown>), contentDigest: runtime.buildDigest('other') },
});
await hydrationMustStayTruncated('missing row digest', {
  ...canonicalRow,
  metadata: { source: 'openswan_action_artifact', actionId: 'A1', artifactKind: 'report' },
});
await hydrationMustStayTruncated('tampered pointer digest', canonicalRow, {
  ...truncatedMessage,
  artifacts: [{
    ...truncatedMessage.artifacts![0],
    metadata: { ...pointerMetadata, contentDigest: runtime.buildDigest('other') },
  }],
});
await hydrationMustStayTruncated('legacy pointer without digest', canonicalRow, {
  ...truncatedMessage,
  artifacts: [{
    ...truncatedMessage.artifacts![0],
    metadata: {
      source: 'openswan_action_artifact',
      actionId: 'A1',
      artifactKind: 'report',
      canonicalArtifactId: pointerMetadata.canonicalArtifactId,
      contentTruncated: true,
    },
  }],
});

console.log(`agent-run artifact integrity smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
