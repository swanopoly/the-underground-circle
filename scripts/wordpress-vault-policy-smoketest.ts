/**
 * wordpress-vault-policy-smoketest — offline guard for the R19 fail-closed
 * vault accessPolicy gate on WordPress REST mutations.
 *
 * Pure module only (no fetch / react-native). Mirrors the pass/FAIL + counter +
 * process.exit pattern of wordpress-schedule-date-smoketest.ts.
 *
 * Run: npm run smoke:wordpress-vault-policy
 */
import { evaluateWpMutationPolicy } from '../src/lib/wordpressVaultPolicy';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`pass: ${msg}`); } else { console.error(`FAIL: ${msg}`); failed++; }
}

const HTTPS = 'https://blog.example.com';
const ORIGINS = ['https://blog.example.com'];

// deny on missing action (taxonomy) — delete not allowed
{
  const d = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['login', 'publish'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'delete',
  });
  assert(!d.allowed, 'deny when required action (delete) absent from taxonomy');
  assert(/does not allow/.test(d.reason || ''), 'deny taxonomy reason mentions disallowed action');
}

// deny on HTTP origin (not HTTPS)
{
  const d = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['publish'], allowedOrigins: ['http://blog.example.com'], siteUrl: 'http://blog.example.com', action: 'publish',
  });
  assert(!d.allowed, 'deny when target origin is HTTP');
  assert(/HTTPS/.test(d.reason || ''), 'http deny reason mentions HTTPS');
}

// deny on origin mismatch
{
  const d = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['publish'], allowedOrigins: ['https://other.example.com'], siteUrl: HTTPS, action: 'publish',
  });
  assert(!d.allowed, 'deny when target origin not in allowed origins');
  assert(/not in the credential/.test(d.reason || ''), 'origin-mismatch reason is honest');
}

// deny on missing / invalid siteUrl
{
  const missing = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['publish'], allowedOrigins: ORIGINS, siteUrl: undefined, action: 'publish',
  });
  assert(!missing.allowed, 'deny when siteUrl missing');
  const invalid = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['publish'], allowedOrigins: ORIGINS, siteUrl: ':::not a url', action: 'publish',
  });
  assert(!invalid.allowed, 'deny when siteUrl unparseable');
}

// allow on HTTPS + action present (origin normalization tolerant of trailing slash / case)
{
  const d = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['login', 'publish', 'delete'], allowedOrigins: ['HTTPS://Blog.Example.com/'], siteUrl: 'https://blog.example.com', action: 'publish',
  });
  assert(d.allowed, 'allow when HTTPS origin matches (case-insensitive) and action present');
}

// schedule requires publish
{
  const ok = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['publish'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'schedule',
  });
  assert(ok.allowed, 'schedule allowed when publish is granted');
  const no = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['edit'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'schedule',
  });
  assert(!no.allowed, 'schedule denied when only edit is granted (needs publish)');
}

// legacy 'post' action satisfies publish/schedule (back-compat) but NOT delete
{
  const pub = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['login', 'post', 'edit'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'publish',
  });
  assert(pub.allowed, "legacy 'post' permits publish (existing rows keep working)");
  const sched = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['post'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'schedule',
  });
  assert(sched.allowed, "legacy 'post' permits schedule");
  const del = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['login', 'post', 'edit'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'delete',
  });
  assert(!del.allowed, "legacy 'post' does NOT permit delete (delete stays explicit opt-in)");
}

// requiresApproval default true, false only when require_approval === false
{
  const dflt = evaluateWpMutationPolicy({
    accessPolicy: {}, allowedActions: ['publish'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'publish',
  });
  assert(dflt.requiresApproval === true, 'requiresApproval defaults to true');
  const off = evaluateWpMutationPolicy({
    accessPolicy: { require_approval: false }, allowedActions: ['publish'], allowedOrigins: ORIGINS, siteUrl: HTTPS, action: 'publish',
  });
  assert(off.requiresApproval === false, 'requiresApproval false when require_approval === false');
  // approval flag is independent of allow/deny.
  assert(off.allowed === true, 'allow still holds when approval is off');
}

if (failed > 0) { console.error(`\nwordpress-vault-policy smoke FAILED (${failed})`); process.exit(1); }
console.log('\nwordpress-vault-policy smoke OK');
