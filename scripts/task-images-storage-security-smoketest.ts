/**
 * Source-contract smoke for task-images Storage ownership and tenant bounds.
 *
 * Run: npx tsx scripts/task-images-storage-security-smoketest.ts
 */

import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260806_task_images_storage_hardening.sql',
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function policySection(name: string): string {
  const start = migration.indexOf(`CREATE POLICY "${name}"`);
  assert(start >= 0, `policy exists: ${name}`);
  const next = migration.indexOf('CREATE POLICY "', start + 1);
  return migration.slice(start, next >= 0 ? next : migration.length);
}

console.log('Bucket limits');
assert(
  migration.includes('file_size_limit = 10485760'),
  'task attachments are capped at 10 MiB',
);
for (const allowed of [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/json',
  'text/plain',
  'text/markdown',
  'text/csv',
]) {
  assert(migration.includes(`'${allowed}'`), `safe compatibility MIME remains allowed: ${allowed}`);
}
for (const executable of [
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/octet-stream',
]) {
  assert(!migration.includes(`'${executable}'`), `active or unbounded MIME is excluded: ${executable}`);
}

console.log('Tenant-bound path helper');
const helperStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.task_image_path_authorized');
const helperEnd = migration.indexOf('REVOKE ALL ON FUNCTION public.task_image_path_authorized', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'authorization helper is present');
const helper = migration.slice(helperStart, helperEnd);
assert(helper.includes('SECURITY DEFINER'), 'membership helper bypasses recursive caller RLS deliberately');
assert(
  helper.includes('SET search_path = pg_catalog, public'),
  'SECURITY DEFINER helper has a fixed search path',
);
assert(
  helper.includes("p_name ~* '^[0-9a-f]{8}-")
    && helper.includes("/[^/]+$'"),
  'only the existing one-folder <task UUID>/<filename> shape is accepted',
);
assert(helper.includes('FROM public.tasks AS task'), 'path first segment resolves to an actual task');
assert(helper.includes('JOIN public.circle_members AS membership'), 'task circle membership is required');
assert(helper.includes('membership.user_id = auth.uid()'), 'membership is bound to the current JWT user');
assert(
  helper.includes("task.id::text = split_part(p_name, '/', 1)"),
  'membership applies to the exact task encoded in the object path',
);
assert(
  migration.includes('REVOKE ALL ON FUNCTION public.task_image_path_authorized(text) FROM PUBLIC')
    && migration.includes('REVOKE ALL ON FUNCTION public.task_image_path_authorized(text) FROM anon')
    && migration.includes('GRANT EXECUTE ON FUNCTION public.task_image_path_authorized(text) TO authenticated'),
  'helper execution is authenticated-only',
);

console.log('Write and delete ownership');
assert(
  migration.includes('DROP POLICY IF EXISTS "Authenticated users can upload task images"'),
  'legacy bucket-only upload policy is removed',
);
assert(
  migration.includes('DROP POLICY IF EXISTS "Users can delete task images"'),
  'legacy bucket-only delete policy is removed',
);
const insertPolicy = policySection('Task members can upload owned task images');
const deletePolicy = policySection('Task image owners can delete own uploads');
for (const [label, policy] of [
  ['insert', insertPolicy],
  ['delete', deletePolicy],
] as const) {
  assert(policy.includes("bucket_id = 'task-images'"), `${label} stays in the exact bucket`);
  assert(policy.includes('owner_id::text = auth.uid()::text'), `${label} binds object ownership to the JWT user`);
  assert(policy.includes('public.task_image_path_authorized(name)'), `${label} requires exact task membership`);
  assert(policy.includes('TO authenticated'), `${label} is unavailable to anon/public roles`);
}
assert(insertPolicy.includes('FOR INSERT') && insertPolicy.includes('WITH CHECK'), 'upload authorization runs on the proposed row');
assert(deletePolicy.includes('FOR DELETE') && deletePolicy.includes('USING'), 'delete authorization runs on the existing row');

console.log(`\ntask-images-storage-security-smoketest: ${assertions} assertions passed.`);
