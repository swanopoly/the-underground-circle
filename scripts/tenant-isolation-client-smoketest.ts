import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCircleImageStoragePath,
  circleImageStoragePathFromValue,
  persistedCircleImageValue,
  toCircleImageStorageReference,
} from '../src/lib/circleImageStorage';
import {
  buildTaskImageStoragePath,
  taskImageStoragePathFromValue,
  toTaskImageStorageReference,
} from '../src/lib/taskImageStorage';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const sourceFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .filter((entry): entry is string => typeof entry === 'string' && /\.(?:ts|tsx)$/.test(entry));

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertions += 1;
};

const circleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const projectUrl = 'https://tenant-test.supabase.co';
const circlePath = buildCircleImageStoragePath(circleId, 'PNG');
const circleRef = toCircleImageStorageReference(circlePath);
check(circlePath === `circles/${circleId}/icon.png`, 'Circle image path binds the exact Circle');
check(persistedCircleImageValue(circleRef) === circleRef, 'Circle image persistence remains opaque');
check(circleImageStoragePathFromValue(circleRef, projectUrl) === circlePath, 'Circle opaque reference round-trips');
check(circleImageStoragePathFromValue(
  `${projectUrl}/storage/v1/object/public/circle-images/${circlePath}`,
  projectUrl,
) === circlePath, 'legacy project Circle image URLs migrate to private paths');
check(circleImageStoragePathFromValue(
  `https://attacker.example/storage/v1/object/public/circle-images/${circlePath}`,
  projectUrl,
) === null, 'foreign Circle image URLs never gain project authorization');

const taskPath = buildTaskImageStoragePath(taskId, 'proof.png');
const taskRef = toTaskImageStorageReference(taskPath);
check(taskImageStoragePathFromValue(taskRef, projectUrl) === taskPath, 'task attachment reference round-trips');
check(taskImageStoragePathFromValue(
  `https://attacker.example/storage/v1/object/public/task-images/${taskPath}`,
  projectUrl,
) === null, 'foreign task URLs never gain project authorization');

const app = read('App.tsx');
check(app.includes('clearLocalAuthResidualAuthority(userId)'), 'account cleanup retires exact outgoing local authority');
check(app.includes('await accountCleanupPromise;'), 'new sessions await any preceding sign-out cleanup');
check(app.includes('await queueAccountCleanup(outgoingUserId);'), 'account replacement serializes local retirement');
check(
  app.indexOf('await queueAccountCleanup(outgoingUserId);') < app.indexOf('commitValidatedSession(validation.session, event)'),
  'old account cleanup completes before publishing the new session',
);

const detail = read('src/screens/circles/CircleDetailScreen.tsx');
check(detail.includes("key={`workspace:${authUser?.id || 'signed-out'}:${circleId}`}") , 'all Circle dashboards remount by exact account and Circle');
check(detail.includes("circleAccessState !== 'allowed'"), 'dashboard render is gated on fresh Circle access');
check(detail.includes('getSupabaseClientForAccessToken(accessToken)'), 'Circle access reads use the captured bearer client');

const circles = read('src/screens/circles/CirclesScreen.tsx');
check(circles.includes('A device cache is never membership authority'), 'Circle list cache requires fresh membership proof');
check(circles.includes('authorizedCache = cached.filter'), 'departed Circles are removed before cached metadata renders');

const rooms = read('src/screens/circles/tabs/RoomsTab.tsx');
check(rooms.includes('hydratePrivateRoomFiles'), 'room binaries are resolved through private signed URLs');
check(rooms.includes('roomFileReference(storagePath)'), 'room rows persist opaque storage references');
check(rooms.includes('isRoomAuthorityCurrent(authority)'), 'room file work is fenced to exact current authority');
check(!rooms.includes("storage.from('room-files').getPublicUrl"), 'Rooms never publish room-files URLs');
check(rooms.includes(".eq('created_by', authority.userId)"), 'room secret rows are filtered to their exact owner');
check(rooms.includes("onConflict:'room_id,created_by,key'"), 'room secret names are unique per owner rather than shared across users');
check(!rooms.includes("key: 'OPENAI_KEY'"), 'Room API examples never encourage pasting personal API keys into shared code');

const settings = read('src/screens/circles/CircleSettingsScreen.tsx');
check(settings.includes('toCircleImageStorageReference(path)'), 'Circle settings persist an opaque image reference');
check(settings.includes('createSignedUrl(path, CIRCLE_IMAGE_PRIVATE_SIGN_TTL_SECONDS)'), 'Circle settings display a short signed image URL');
check(!settings.includes("storage.from('circle-images').getPublicUrl"), 'Circle settings never publish image URLs');

const github = read('src/lib/github.ts');
check(github.includes("readLocalSecret('github_pat_v2', githubPatSecretId(userId, circleId))"), 'GitHub PAT lookup binds user and Circle');
check(github.includes("deleteLocalSecret('github_pat', circleId)"), 'unattributed legacy GitHub PATs retire fail closed');

const netlify = read('src/lib/netlifyDeploy.ts');
check(netlify.includes('netlifySecretId(userId, circleId)'), 'Netlify PAT lookup binds user and Circle');
check(netlify.includes('safeGetUserId()'), 'Netlify token lookup requires current authenticated user');

const discord = read('src/lib/discord.ts');
check(discord.includes(".select('discord_guild_id, discord_connected_at')"), 'Discord member reads request only non-secret Circle metadata');
check(discord.includes(".rpc('get_circle_capability_secrets_v1'"), 'retained Discord secrets use the current-creator capability RPC');
check(discord.includes("const DISCORD_TOKEN_NAMESPACE = 'discord_bot_token_v2'"), 'Discord device secrets use the account-scoped namespace');
check(discord.includes('discordTokenSecretId(authority.userId, circleId)'), 'Discord device secrets bind exact user and Circle');
check(!discord.includes("readLocalSecret('discord_bot_token', circleId)"), 'unattributed legacy Discord tokens are never read');
check(discord.includes('getSupabaseClientForAccessToken(accessToken)'), 'Discord Circle reads and writes use the captured bearer client');
check(discord.includes(".select('id').maybeSingle()"), 'Discord writes require an affected Circle receipt');

const unsafeCircleWildcardReaders = sourceFiles.filter((entry) => (
  /\.from\(['"]circles['"]\)[\s\S]{0,220}?\.select\(\s*(?:['"]\*|\))/m
    .test(read(path.join('src', entry)))
));
check(
  unsafeCircleWildcardReaders.length === 0,
  `Circle browser reads never expand denied capability-secret columns (${unsafeCircleWildcardReaders.join(', ')})`,
);

const unsafeGithubConnectionWildcardReaders = sourceFiles.filter((entry) => (
  /\.from\(['"]circle_github_connections['"]\)[\s\S]{0,220}?\.select\(\s*(?:['"]\*|\))/m
    .test(read(path.join('src', entry)))
));
check(
  unsafeGithubConnectionWildcardReaders.length === 0,
  `GitHub connection reads never expand webhook_secret (${unsafeGithubConnectionWildcardReaders.join(', ')})`,
);

const logout = read('src/lib/authLogout.ts');
check(logout.includes('github-personal-access-tokens'), 'logout clears account-scoped GitHub PAT authority');

const officeTerminal = read('src/lib/officeTerminal.ts');
check(
  (officeTerminal.match(/private:\s*true/g) || []).length >= 4,
  'Office command and response Broadcast channels are private',
);
check(
  officeTerminal.includes('Realtime notifications are advisory'),
  'Office Realtime notifications require an exact-authority durable refetch',
);

const agentPresence = read('src/lib/agentPresence.ts');
check(
  agentPresence.includes('config: { private: true, presence: { key: authority.userId } }'),
  'Office presence uses a private account-authenticated Circle channel',
);

const statusPicker = read('src/components/office/StatusPicker.tsx');
check(!statusPicker.includes('.channel('), 'presence edits do not broadcast profile data on an unguarded channel');
check(!statusPicker.includes('status_update'), 'the retired public presence payload is not emitted');

const publicUrlCallers = sourceFiles.filter((entry) => read(path.join('src', entry)).includes('.getPublicUrl('));
check(publicUrlCallers.length === 0, `no source component publishes Storage objects (${publicUrlCallers.join(', ')})`);

console.log(`tenant-isolation client smoke: PASS (${assertions} assertions)`);
