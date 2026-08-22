import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0, `missing source boundary: ${start}`);
  assert(endIndex > startIndex, `missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

const secondBrainSource = readFileSync('src/lib/secondBrain.ts', 'utf8');
const noteProjection = secondBrainSource.match(
  /const SECOND_BRAIN_NOTE_READ_COLUMNS = \[([\s\S]*?)\]\.join\(','\);/,
)?.[1] || '';

assert(noteProjection, 'second brain exposes a shared note read projection');
assert(!noteProjection.includes("'embedding'"), 'routine note reads exclude the pgvector embedding payload');
assert(noteProjection.includes("'embedding_model'"), 'routine note reads retain embedding metadata');

const listRead = between(
  secondBrainSource,
  'export async function loadSecondBrainNotes(',
  'export async function loadSecondBrainLinks(',
);
assert(
  listRead.includes('.select(SECOND_BRAIN_NOTE_READ_COLUMNS)'),
  'second brain list reads use the lightweight projection',
);
assert(!listRead.includes(".select('*')"), 'second brain list reads never select every column');

const keywordRead = between(
  secondBrainSource,
  'async function keywordSearchNotes(',
  'export async function searchSecondBrain(',
);
assert(
  keywordRead.includes('.select(SECOND_BRAIN_NOTE_READ_COLUMNS)'),
  'second brain keyword reads use the lightweight projection',
);
assert(!keywordRead.includes(".select('*')"), 'second brain keyword reads never select every column');

const semanticSearch = between(
  secondBrainSource,
  'export async function searchSecondBrain(',
  'export async function buildSecondBrainGraph(',
);
assert(
  semanticSearch.includes(".rpc('match_second_brain_notes'"),
  'semantic note search remains on the dedicated vector RPC',
);

const rewardSource = readFileSync('src/services/rewardService.ts', 'utf8');
const getUserPointsBody = between(
  rewardSource,
  'export async function getUserPoints(',
  'export async function getUserBadges(',
);
assert(
  getUserPointsBody.includes(".from('user_points')")
    && getUserPointsBody.includes('.maybeSingle()')
    && !getUserPointsBody.includes('.single()'),
  'a legitimately missing first user_points row remains an uninitialized reward state without a 406 response',
);
const whiteboardSource = readFileSync('src/screens/circles/tabs/office/Whiteboard.tsx', 'utf8');
const whiteboardRewardHook = between(
  whiteboardSource,
  'function useRewardState(): RewardState {',
  '// ── MAIN COMPONENT',
);
assert(
  whiteboardRewardHook.includes(".from('user_points')")
    && whiteboardRewardHook.includes(".select('lifetime_points')")
    && whiteboardRewardHook.includes('.maybeSingle()')
    && !whiteboardRewardHook.includes('.single()'),
  'the Office whiteboard accepts an empty first reward row without a lifetime-points 406 response',
);
const awardPointsBody = between(
  rewardSource,
  'export async function awardPoints(',
  'export async function awardAgentTurnPoints(',
);
assert(!awardPointsBody.includes('.rpc('), 'client point awarding performs no RPC');
assert(!rewardSource.includes(".rpc('award_points'"), 'the client service never invokes award_points');
assert(
  awardPointsBody.includes('return { newTotal: 0, newBadges: [] };'),
  'dormant client awards return the stable empty receipt',
);

console.log('client data boundaries smoketest passed');
