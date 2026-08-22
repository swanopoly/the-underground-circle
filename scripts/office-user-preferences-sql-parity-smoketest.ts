/** Byte-exact consolidated-SQL and canonical-ownership contract for Office preferences. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const migrationPath = resolve(
  root,
  'supabase/migrations/20260813220000_office_user_preferences.sql',
);
const consolidatedPath = resolve(root, 'docs/RUN_THIS_SQL.sql');
const migration = readFileSync(migrationPath, 'utf8');
const consolidated = readFileSync(consolidatedPath, 'utf8');
const roadmap = readFileSync(resolve(root, 'docs/AGENTS_ROADMAP.md'), 'utf8');
const stackReference = readFileSync(resolve(root, 'docs/UC_APP_STACK_REFERENCE.md'), 'utf8');
const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

const header = '-- BEGIN SECTION 45: Owner-private Office user preferences';
const source = '-- Source: supabase/migrations/20260813220000_office_user_preferences.sql';
const footer = '-- END SECTION 45: Owner-private Office user preferences';
const prefix = `${header}\n${source}\n`;
const sectionStart = consolidated.indexOf(prefix);
const sectionEnd = consolidated.indexOf(footer, sectionStart + prefix.length);

check(sectionStart >= 0 && sectionEnd > sectionStart, '§45 has exact BEGIN, Source, and END boundaries');
assertions += 1;
assert.equal(
  consolidated.slice(sectionStart + prefix.length, sectionEnd),
  migration,
  '§45 executable body is byte-exact with the canonical migration',
);
for (const marker of [header, source, footer]) {
  assertions += 1;
  assert.equal(
    consolidated.indexOf(marker, consolidated.indexOf(marker) + marker.length),
    -1,
    `${marker} appears exactly once`,
  );
}
check(
  consolidated.indexOf(
    '-- BEGIN SECTION 46: Circle-global idle-behavior claims',
    sectionEnd + footer.length,
  ) > sectionEnd,
  '§46 follows the closed §45 boundary',
);
const nextSectionStart = consolidated.indexOf(
  '-- BEGIN SECTION 46: Circle-global idle-behavior claims',
  sectionEnd + footer.length,
);
check(
  /^\s*$/u.test(consolidated.slice(sectionEnd + footer.length, nextSectionStart)),
  '§45 has no executable drift before §46',
);
check(
  consolidated.includes('--   §45 Owner-private, circle-scoped Office user preferences'),
  'consolidated contents index records §45',
);

const expectedScripts: Record<string, string> = {
  'smoke:office-user-preferences-sql':
    'npx tsx scripts/office-user-preferences-sql-smoketest.ts',
  'smoke:office-user-preferences-sql-behavior':
    'sh scripts/office-user-preferences-sql-behavior-smoketest.sh',
  'smoke:office-user-preferences-sql-parity':
    'npx tsx scripts/office-user-preferences-sql-parity-smoketest.ts',
  'smoke:openswan-office-preference-appearance':
    'npx tsx scripts/openswan-office-preference-appearance-smoketest.ts',
  'smoke:office-session-storage-scope':
    'npx tsx scripts/office-session-storage-scope-smoketest.ts',
  'smoke:circle-office-exact-auth-scope':
    'npx tsx scripts/circle-office-exact-auth-scope-smoketest.ts',
  'smoke:office-presence-heartbeat-authority':
    'npx tsx scripts/office-presence-heartbeat-authority-smoketest.ts',
  'smoke:office-private-runtime-wiring':
    'npx tsx scripts/office-private-runtime-wiring-smoketest.ts',
  'smoke:agent-identity-exact-authority':
    'npx tsx scripts/agent-identity-exact-authority-smoketest.ts',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  assertions += 1;
  assert.equal(packageJson.scripts?.[name], command, `package exposes ${name}`);
}

const aggregate = packageJson.scripts?.['check:office-addons'] || '';
for (const name of Object.keys(expectedScripts).filter((name) => !name.endsWith('-behavior'))) {
  check(aggregate.includes(`npm run ${name}`), `check:office-addons includes ${name}`);
}
check(
  !aggregate.includes('npm run smoke:office-user-preferences-sql-behavior'),
  'the default Office gate does not require a developer-local PostgreSQL owner',
);

for (const [document, name] of [
  [roadmap, 'roadmap'],
  [stackReference, 'stack reference'],
  [claude, 'CLAUDE'],
] as const) {
  check(
    document.includes('20260813220000_office_user_preferences.sql'),
    `${name} names the canonical migration`,
  );
  check(document.includes('§45'), `${name} records consolidated section §45`);
}
check(
  roadmap.includes('| 45 | Owner-private, circle-scoped Office user preferences'),
  'roadmap SQL checklist records §45',
);
const roadmapSection45 = roadmap
  .split(/\r?\n/u)
  .find((line) => line.startsWith('| 45 | Owner-private, circle-scoped Office user preferences'));
check(
  roadmapSection45?.includes('**Applied / catalog-verified 2026-08-20.**')
    && roadmapSection45.includes('910 canonical archive rows')
    && roadmapSection45.includes('simulated nonmember'),
  'roadmap records the exact reviewed target deployment receipts',
);

console.log(`Office user preferences SQL parity smoke passed (${assertions} assertions).`);
