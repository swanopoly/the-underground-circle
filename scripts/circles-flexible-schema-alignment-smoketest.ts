/** Source-level regression guard for the live circles/create-circle contract. */

import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve('supabase/migrations/20260806193000_circles_flexible_schema_alignment.sql'),
  'utf8',
);
const createScreen = fs.readFileSync(
  path.resolve('src/screens/circles/CreateCircleScreen.tsx'),
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

for (const column of ['circle_type', 'icon', 'accent_color', 'check_in_format', 'tags']) {
  assert(createScreen.includes(`${column}:`), `create flow writes ${column}`);
  assert(
    new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}\\b`, 'i').test(migration),
    `canonical migration adds ${column}`,
  );
  assert(
    new RegExp(`ALTER COLUMN ${column} SET NOT NULL`, 'i').test(migration),
    `canonical migration makes ${column} non-null after backfill`,
  );
}

assert(/BEGIN;[\s\S]*COMMIT;/i.test(migration), 'migration is atomic');
assert(migration.includes('COALESCE(circle_type'), 'existing rows are backfilled without overwriting populated fields');
assert(migration.includes('circles_accent_color_hex_check'), 'accent colors are shape constrained');
assert(migration.includes('circles_check_in_format_shape_check'), 'check-in JSON is object-shaped and bounded');
assert(migration.includes('circles_tags_count_check'), 'tag arrays are bounded');
assert(migration.includes('CREATE INDEX IF NOT EXISTS idx_circles_circle_type'), 'circle type index is idempotent');
assert(migration.includes('CREATE INDEX IF NOT EXISTS idx_circles_tags'), 'tag index is idempotent');

console.log(`circles-flexible-schema-alignment-smoketest: ${assertions} assertions passed`);
