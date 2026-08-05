/**
 * browser-credential-policy-smoketest — pins Lane C: per-domain, opt-in
 * session reuse with ISOLATED browser profiles, and the model-safe vault fill
 * contract. Covers profile isolation, the opt-in lifecycle (create → reuse →
 * expire/revoke), the fresh-login floor (session reuse ≠ first login), and the
 * secret-never-in-model invariant.
 *
 * Run: npx tsx scripts/browser-credential-policy-smoketest.ts
 */

import {
  buildVaultFillContract,
  canReuseSession,
  compactDomainCredentialOptIns,
  createDomainCredentialOptIn,
  describeDomainOptIn,
  DOMAIN_OPT_IN_MAX_RECORDS,
  isDomainOptedIn,
  normalizeDomain,
  profileKeyForDomain,
  requiresFreshLoginConfirmation,
  revokeDomainOptIn,
  type DomainCredentialOptIn,
} from '../src/lib/browserCredentialPolicy';
import { normalizeScopeKey } from '../src/lib/computerGrantGate';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, name: string, detail?: string) {
  if (condition) pass(name);
  else fail(`${name}${detail ? ' - ' + detail : ''}`);
}

const NOW = '2026-06-10T12:00:00Z';
const NOW_MS = Date.parse(NOW);
const DAY = 24 * 60 * 60 * 1000;

function main() {
  // ── Domain normalization matches sticky scopes exactly (shared key space) ──
  assert(normalizeDomain('https://WWW.Acme.com/login?x=1') === 'acme.com', 'domain normalizes to acme.com');
  assert(normalizeDomain('shop.acme.com') === normalizeScopeKey('site', 'shop.acme.com'), 'domain normalization mirrors normalizeScopeKey');
  assert(normalizeDomain('deep.shop.acme.co.uk') === 'acme.co.uk', 'multi-part TLD keeps eTLD+1');

  // ── Profile isolation: distinct domains ⇒ distinct filesystem-safe keys ──
  assert(profileKeyForDomain('acme.com') === 'profile_acme_com', 'profile key is stable + filesystem-safe');
  assert(profileKeyForDomain('https://WWW.Acme.com/x') === 'profile_acme_com', 'profile key normalizes host before deriving');
  assert(profileKeyForDomain('shop.acme.com') === profileKeyForDomain('acme.com'), 'same registrable domain shares one isolated profile');
  // Multi-tenant hosting suffixes stay per-tenant so credentials never bleed across tenants.
  assert(profileKeyForDomain('alice.myshopify.com') !== profileKeyForDomain('bob.myshopify.com'), 'per-tenant profile isolation on multi-tenant hosting suffix');
  assert(normalizeDomain('alice.myshopify.com') === 'alice.myshopify.com', 'multi-tenant suffix keeps tenant label (credential isolation)');
  assert(
    profileKeyForDomain('acme.com') !== profileKeyForDomain('other.com'),
    'distinct domains get distinct profiles (isolation)',
  );
  assert(profileKeyForDomain('acme.co.uk') === 'profile_acme_co_uk', 'dotted TLD becomes underscore-safe key');
  // No shared default profile for garbage — fail closed.
  assert(profileKeyForDomain('') === '', 'empty domain yields no profile (fail closed)');
  assert(profileKeyForDomain('   ') === '', 'whitespace domain yields no profile');
  assert(profileKeyForDomain('???') === '', 'garbage domain yields no profile (no shared default)');

  // ── Opt-in creation ──
  const badCreate = createDomainCredentialOptIn({ domain: '???', nowIso: NOW });
  assert(!badCreate.ok, 'creation rejects un-normalizable domain');
  const emptyCreate = createDomainCredentialOptIn({ domain: '   ', nowIso: NOW });
  assert(!emptyCreate.ok, 'creation rejects empty domain');

  const created = createDomainCredentialOptIn({ domain: 'WWW.Acme.com', grantedByUserId: 'user_1', nowIso: NOW });
  if (!created.ok) {
    fail('valid opt-in creation should succeed');
    return;
  }
  const optIn = created.optIn;
  assert(optIn.domain === 'acme.com', 'created opt-in stores normalized domain');
  assert(optIn.profileKey === 'profile_acme_com', 'created opt-in carries isolated profile key');
  assert(optIn.grantedByUserId === 'user_1', 'created opt-in records granting user');
  assert(optIn.expiresAtIso === new Date(NOW_MS + 30 * DAY).toISOString(), 'default 30-day TTL');
  assert(optIn.revoked === null, 'new opt-in is not revoked');

  const shortTtl = createDomainCredentialOptIn({ domain: 'acme.com', ttlDays: 2, nowIso: NOW });
  assert(shortTtl.ok && shortTtl.optIn.expiresAtIso === new Date(NOW_MS + 2 * DAY).toISOString(), 'custom TTL honored');

  const records: DomainCredentialOptIn[] = [optIn];

  // ── Opt-in gating: reuse only for an active, matching opt-in ──
  assert(canReuseSession(records, 'acme.com', NOW_MS) === true, 'opted domain within TTL can reuse session');
  assert(canReuseSession(records, 'shop.acme.com', NOW_MS) === true, 'subdomain of opted domain can reuse (shared registrable domain)');
  assert(isDomainOptedIn(records, 'acme.com', NOW_MS) === true, 'isDomainOptedIn agrees for opted domain');
  assert(canReuseSession(records, 'other.com', NOW_MS) === false, 'non-opted domain cannot reuse session');
  assert(canReuseSession(records, 'evilacme.com', NOW_MS) === false, 'lookalike domain cannot reuse session');
  assert(canReuseSession([], 'acme.com', NOW_MS) === false, 'no records ⇒ no reuse (fail closed)');
  assert(canReuseSession(records, '???', NOW_MS) === false, 'garbage query domain ⇒ no reuse (fail closed)');

  // ── Expiry ──
  assert(canReuseSession(records, 'acme.com', NOW_MS + 31 * DAY) === false, 'expired opt-in cannot reuse session');

  // ── Revocation ──
  const revoked = revokeDomainOptIn(records, 'acme.com', 'user_2', NOW);
  assert(Boolean(revoked[0].revoked) && revoked[0].revoked?.byUserId === 'user_2', 'revocation recorded with actor');
  assert(canReuseSession(revoked, 'acme.com', NOW_MS) === false, 'revoked opt-in cannot reuse session');
  assert(revokeDomainOptIn(records, '???', 'user_2', NOW) === records, 'revoke with garbage domain is a no-op');

  // ── HARD INVARIANT: first login always confirms, even when opted-in ──
  assert(
    requiresFreshLoginConfirmation({ hasStoredSession: false, optedIn: true }) === true,
    'no stored session ⇒ fresh login required EVEN when opted in (first login floor)',
  );
  assert(
    requiresFreshLoginConfirmation({ hasStoredSession: false, optedIn: false }) === true,
    'no stored session + not opted in ⇒ fresh login required',
  );
  assert(
    requiresFreshLoginConfirmation({ hasStoredSession: true, optedIn: false }) === true,
    'stored session but not opted in ⇒ still confirm before reuse',
  );
  assert(
    requiresFreshLoginConfirmation({ hasStoredSession: true, optedIn: true }) === false,
    'stored session + opted in ⇒ reuse without re-confirming',
  );

  // ── Model-safe vault fill contract: never carries a secret ──
  const contract = buildVaultFillContract({ domain: 'https://acme.com/login', fieldRef: 'vault:acme.com/password' });
  if (!contract) {
    fail('vault fill contract should build for a valid domain + fieldRef');
    return;
  }
  assert(contract.domain === 'acme.com', 'contract targets normalized domain');
  assert(contract.profileKey === 'profile_acme_com', 'contract carries isolated profile key');
  assert(contract.fieldRef === 'vault:acme.com/password', 'contract carries opaque field reference');
  assert(contract.neverReturnsSecret === true, 'contract is structurally marked secret-free');
  assert(contract.fillVia === 'bridge', 'contract routes fill through the bridge');
  // The invariant made concrete: the ONLY credential-shaped value on the
  // contract is the opaque fieldRef. `neverReturnsSecret` is a deliberate
  // structural marker (a boolean, not a secret), so it is excluded from the
  // secret-value scan; any OTHER value-bearing credential field is a violation.
  const valueBearingKeys = Object.keys(contract).filter((k) => k !== 'neverReturnsSecret' && k !== 'fieldRef');
  assert(
    !valueBearingKeys.some((k) => /secret|password|token|value|credential/i.test(k)),
    'contract has NO secret-bearing field (model only ever sees fieldRef)',
  );
  assert(typeof contract.neverReturnsSecret === 'boolean', 'neverReturnsSecret marker is a boolean, not a value carrier');
  const serialized = JSON.stringify(contract);
  assert(!/hunter2|s3cr3t|topsecret/i.test(serialized), 'no secret value can appear in a serialized contract');
  // fieldRef is sanitized so a caller cannot smuggle a raw multi-line secret blob through it.
  const smuggled = buildVaultFillContract({ domain: 'acme.com', fieldRef: 'vault:ref\n  actual-secret-hunter2' });
  assert(Boolean(smuggled) && !/\s/.test(smuggled!.fieldRef), 'fieldRef strips whitespace (no smuggled blobs)');
  assert(buildVaultFillContract({ domain: '???', fieldRef: 'vault:x' }) === null, 'contract fails closed on garbage domain');
  assert(buildVaultFillContract({ domain: 'acme.com', fieldRef: '   ' }) === null, 'contract fails closed on empty fieldRef');

  // ── Tolerant compaction ──
  const compacted = compactDomainCredentialOptIns([
    { domain: 'WWW.Acme.com', grantedAtIso: NOW },
    { domain: '', grantedAtIso: NOW },
    { domain: '???' },
    'garbage',
    null,
  ]);
  assert(compacted.length === 1, 'compaction drops malformed + un-normalizable entries');
  assert(compacted[0].domain === 'acme.com' && compacted[0].profileKey === 'profile_acme_com', 'compaction re-derives profile key from domain');

  // A persisted record cannot forge a foreign profile key: the key is re-derived.
  const forged = compactDomainCredentialOptIns([
    { domain: 'acme.com', profileKey: 'profile_evil_com', grantedAtIso: NOW },
  ]);
  assert(forged.length === 1 && forged[0].profileKey === 'profile_acme_com', 'compaction ignores a forged persisted profile key');

  const overflow = Array.from({ length: DOMAIN_OPT_IN_MAX_RECORDS + 25 }, (_, i) => ({ domain: `site${i}.com`, grantedAtIso: NOW }));
  assert(compactDomainCredentialOptIns(overflow).length <= DOMAIN_OPT_IN_MAX_RECORDS, 'compaction bounds record count');

  // ── UI describe copy ──
  const line = describeDomainOptIn(optIn, NOW_MS);
  assert(line.includes('acme.com') && line.includes('profile_acme_com'), 'describe shows domain + isolated profile');
  assert(line.includes('first login still requires confirmation'), 'describe reiterates first-login floor');
  assert(describeDomainOptIn(revoked[0], NOW_MS).includes('revoked'), 'describe reflects revoked state');

  if (failures > 0) {
    console.error(`\n${failures} browser-credential-policy smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll browser-credential-policy smoke cases passed.');
}

main();
