/**
 * Source-level contract for the Feed/Missions progressive-disclosure pass.
 *
 * This intentionally avoids importing React Native. It pins the mounted
 * source wiring that prevents task-only chrome, per-card query fan-out, and
 * unverified agent updates from drifting back into the default mission view.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
const feed = read('src/screens/circles/tabs/FeedTab.tsx');
const missionsTab = read('src/screens/circles/tabs/MissionsTab.tsx');
const missionsData = read('src/lib/missions.ts');
const kanban = read('src/hooks/useKanbanData.ts');

assert.match(feed, /const MOBILE_BREAKPOINT = 1180/, 'tablets and zoomed desktop use focused Feed surfaces');
assert.match(feed, /function FeedOverviewBar[\s\S]*accessibilityState=\{\{ expanded \}\}/, 'status detail is disclosed accessibly');
assert.match(feed, /\(mobileTab === 'board' \|\| mobileTab === 'agents'\) && \([\s\S]{0,120}<TaskSearchBar/, 'task search appears only on task-bearing compact views');
assert.match(feed, /refreshAgents\(\)/, 'Office heartbeats refresh only the agent roster');
assert.doesNotMatch(feed, /subscribeToCircleOffice\([\s\S]{0,140}kanban\.refresh\(\)/, 'Office heartbeat no longer triggers full Feed reload');
assert.match(feed, /missions=\{allMissions\}[\s\S]{0,120}onRefresh=\{refreshMissions\}/, 'Feed owns the one mission list query and passes it down');
assert.match(feed, /More Feed views/, 'secondary compact Feed destinations stay under More');

assert.match(missionsTab, /showMissionTools[\s\S]*Filter & view/, 'advanced mission controls are disclosed');
assert.match(missionsTab, /nativeID="btn-mission-more"/, 'mission detail has one secondary-action entry point');
assert.equal((missionsTab.match(/nativeID="btn-mission-archive"/g) || []).length, 1, 'Archive is not duplicated');
assert.match(missionsTab, /result\.completed[\s\S]{0,300}verified this task complete/, 'agent completion copy requires completed truth');
assert.match(missionsTab, /sent an update; the task is still in progress/, 'partial agent work remains visibly incomplete');
assert.match(missionsTab, /const \[step, setStep\] = useState<'templates' \| 'form'>\('form'\)/, 'mission creation starts on the short form');
assert.match(missionsTab, /Use a template/, 'templates remain optional');

const missionCardStart = missionsTab.indexOf('function MissionCard');
const missionDetailStart = missionsTab.indexOf('function MissionDetail');
assert(missionCardStart >= 0 && missionDetailStart > missionCardStart, 'mission-card source boundary exists');
const missionCard = missionsTab.slice(missionCardStart, missionDetailStart);
assert.doesNotMatch(missionCard, /useMissionDetail\(/, 'mission cards do not open one detail query/subscription each');
assert.match(missionCard, /const tasks = mission\.tasks \|\| \[\]/, 'mission cards consume the batched task summary');

assert.match(missionsData, /includeArchived\?: boolean/, 'archived retrieval is an explicit data option');
assert.match(missionsData, /includeTasks\?: boolean/, 'batched task summaries are an explicit data option');
assert.match(missionsData, /if \(!options\.includeArchived\) query = query\.neq\('status', 'archived'\)/, 'UI can retrieve archived missions without changing agent defaults');
assert.match(missionsData, /getTasksForMissionList/, 'mission progress is batch-loaded');
assert.match(kanban, /refreshAgents: fetchAgents/, 'Kanban exposes the narrow roster refresh callback');

console.log('feed mission minimal UI smoketest: all assertions passed');
