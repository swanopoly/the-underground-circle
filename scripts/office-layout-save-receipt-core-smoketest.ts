import assert from 'node:assert/strict';
import { interpretOfficeLayoutSaveReceipt } from '../src/lib/officeLayoutSaveReceiptCore';

assert.deepEqual(
  interpretOfficeLayoutSaveReceipt({ accepted: true, layoutVersion: 41 }, 41),
  { ok: true, version: 41 },
  'only the exact accepted version succeeds',
);

const conflict = interpretOfficeLayoutSaveReceipt({ accepted: false, layoutVersion: 42 }, 41);
assert.equal(conflict.ok, false);
assert.equal(conflict.conflict, true, 'literal rejection is a conflict');
assert.equal(conflict.version, 42, 'the conflict retains the authoritative stored version');

for (const malformed of [
  null,
  'accepted',
  [],
  {},
  { accepted: true },
  { accepted: 1, layoutVersion: 41 },
  { accepted: true, layoutVersion: '41' },
  { accepted: true, layoutVersion: 42 },
  { accepted: true, layoutVersion: Number.NaN },
]) {
  assert.equal(
    interpretOfficeLayoutSaveReceipt(malformed, 41).ok,
    false,
    `malformed or mismatched receipt fails closed: ${JSON.stringify(malformed)}`,
  );
}

assert.equal(
  interpretOfficeLayoutSaveReceipt({ accepted: true, layoutVersion: 41 }, Number.NaN).ok,
  false,
  'a non-finite requested version cannot be verified',
);
for (const invalidVersion of [0, -1, 41.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.deepEqual(
    interpretOfficeLayoutSaveReceipt({ accepted: true, layoutVersion: 1 }, invalidVersion),
    {
      ok: false,
      version: 0,
      error: 'The Office layout save used an invalid version and was not verified.',
    },
    `invalid requested version fails closed: ${invalidVersion}`,
  );
}
assert.equal(
  interpretOfficeLayoutSaveReceipt({ accepted: false, layoutVersion: 0 }, 41).conflict,
  undefined,
  'a rejection without a valid authoritative version is malformed rather than a conflict',
);

console.log('office-layout-save-receipt-core smoketest: all assertions passed');
