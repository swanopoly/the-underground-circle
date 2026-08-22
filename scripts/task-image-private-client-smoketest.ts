import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTaskImageStoragePath,
  redactUnresolvedTaskImageValue,
  taskImageStoragePathFromValue,
  toTaskImageStorageReference,
} from '../src/lib/taskImageStorage';

const taskId = '11111111-1111-4111-8111-111111111111';
const projectUrl = 'https://project-ref.supabase.co';
const path = buildTaskImageStoragePath(taskId, '../private image.png');
assert.match(path, new RegExp(`^${taskId}/[0-9]+-_?private_image\\.png$`));
assert.equal(path.split('/').length, 2, 'task image paths remain one exact task folder and filename');

const reference = toTaskImageStorageReference(path);
assert.equal(taskImageStoragePathFromValue(reference, projectUrl), path);
assert.equal(redactUnresolvedTaskImageValue(reference), null, 'opaque private references never render before signing');

const legacyPublic = `${projectUrl}/storage/v1/object/public/task-images/${path}`;
assert.equal(taskImageStoragePathFromValue(legacyPublic, projectUrl), path, 'legacy same-project public URL migrates to a private path');
assert.equal(
  taskImageStoragePathFromValue(`https://attacker.example/storage/v1/object/public/task-images/${path}`, projectUrl),
  null,
  'a foreign host cannot be converted into authorized Storage access',
);
assert.equal(taskImageStoragePathFromValue('task-image:%2Fetc%2Fpasswd', projectUrl), null);
assert.throws(() => buildTaskImageStoragePath('not-a-task', 'file.png'));

const hookSource = readFileSync('src/hooks/useKanbanData.ts', 'utf8');
const modalSource = readFileSync('src/screens/circles/tabs/kanban/TaskDetailModal.tsx', 'utf8');
const helperSource = readFileSync('src/lib/taskImageStorage.ts', 'utf8');
const combinedClient = `${hookSource}\n${modalSource}\n${helperSource}`;
assert.equal(
  /from\(['"]task-images['"]\)[\s\S]{0,240}getPublicUrl/.test(combinedClient),
  false,
  'task image clients never mint or persist public bucket URLs',
);
for (const marker of [
  'resolveTaskImageValues',
  'createTaskImageSignedUrl',
  'toTaskImageStorageReference',
  'attachment.storage_path',
]) {
  assert.ok(combinedClient.includes(marker), `private task image client keeps ${marker}`);
}
assert.ok(
  hookSource.includes('exactReadClient.storage') && helperSource.includes(".createSignedUrls(batch"),
  'private object upload and reads use the captured-account client and short signed URLs',
);

const circleSource = readFileSync('src/screens/circles/CircleDetailScreen.tsx', 'utf8');
assert.ok(circleSource.includes("type CircleAccessState = 'checking' | 'allowed' | 'denied' | 'error'"));
assert.ok(circleSource.includes(".select(CIRCLE_SHELL_READ_COLUMNS)"));
assert.equal(circleSource.includes("from('circles').select('*')"), false, 'Circle shell never reads secret-bearing wildcard columns');
assert.ok(circleSource.includes("if (circleAccessState !== 'allowed')"));
assert.ok(circleSource.includes('A device cache, route parameter, or prior Realtime event never is.'));
assert.ok(circleSource.includes('circleCacheKey(userId, circleId)'), 'Circle cache is exact user and Circle scoped');

const appSource = readFileSync('App.tsx', 'utf8');
assert.ok(appSource.includes('outgoingUserId !== validation.session.user.id'));
assert.ok(appSource.includes('const queueAccountCleanup = (userId: string | null)'));
assert.ok(appSource.includes('clearLocalAuthResidualAuthority(userId)'));
assert.ok(appSource.includes('await queueAccountCleanup(outgoingUserId)'));
assert.ok(appSource.includes('clearPersistedAccountUiState()'));

const logoutSource = readFileSync('src/lib/authLogout.ts', 'utf8');
const profileNavigationSource = readFileSync('src/lib/profileNavigation.ts', 'utf8');
assert.ok(logoutSource.includes("'profile-circle-context'"));
assert.ok(profileNavigationSource.includes('lastProfileCircleContext = null'));

console.log('task image + browser account tenant-isolation smoke passed');
