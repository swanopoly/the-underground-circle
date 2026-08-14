/**
 * Red-first pure/source smoke for Chat assign-target identity.
 *
 * Picker selection carries an immutable agent id. Human-typed names are a
 * separate quoted/name selector and must resolve uniquely before dispatch.
 * A live OpenSwan session may be named "OpenSwan" without becoming the
 * canonical default target or losing its exact connection/session identity.
 *
 * No provider, bridge, or database is contacted.
 *
 * Run: npx tsx scripts/chat-agent-target-identity-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as chatAgentTargetsModule from '../src/lib/chatAgentTargets';
import {
  DEFAULT_CHAT_AGENT_TARGET_ID,
  buildChatAgentTargets,
  resolveChatAgentTarget,
  type ChatAgentLike,
} from '../src/lib/chatAgentTargets';

const chatPath = fileURLToPath(
  new URL('../src/screens/circles/tabs/ChatTab.tsx', import.meta.url),
);
const pickerPath = fileURLToPath(
  new URL('../src/screens/circles/tabs/chat/AssignPickerCard.tsx', import.meta.url),
);
const targetsPath = fileURLToPath(
  new URL('../src/lib/chatAgentTargets.ts', import.meta.url),
);
const chatSource = readFileSync(chatPath, 'utf8');
const pickerSource = readFileSync(pickerPath, 'utf8');
const targetsSource = readFileSync(targetsPath, 'utf8');

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label);
  return false;
}

function expectMatch(source: string, pattern: RegExp, label: string): void {
  check(pattern.test(source), label);
}

function expectNoMatch(source: string, pattern: RegExp, label: string): void {
  check(!pattern.test(source), label);
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  if (!check(start >= 0, `${label}: start marker exists`)) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (!check(end > start, `${label}: end marker exists`)) return '';
  return source.slice(start, end);
}

type AssignmentAgent = ChatAgentLike & {
  connectionId?: string | null;
};

type AssignmentParseResult = {
  ok?: boolean;
  task?: unknown;
  selector?: unknown;
  selectorKind?: unknown;
  agentId?: unknown;
  name?: unknown;
  reason?: unknown;
};

type AssignmentResolution<TAgent> = {
  ok?: boolean;
  agent?: TAgent;
  reason?: unknown;
};

type BuildAssignmentCommand = (agentId: string) => string;
type ParseAssignmentCommand = (input: string) => AssignmentParseResult | null;
type ResolveAssignmentTarget = <TAgent extends ChatAgentLike>(
  agents: readonly TAgent[],
  parsed: AssignmentParseResult | null,
) => AssignmentResolution<TAgent>;

const dynamicExports = chatAgentTargetsModule as unknown as Record<string, unknown>;
const buildAssignmentCommand = dynamicExports.buildChatAgentAssignmentCommand as BuildAssignmentCommand | undefined;
const parseAssignmentCommand = dynamicExports.parseChatAgentAssignmentCommand as ParseAssignmentCommand | undefined;
const resolveAssignmentTarget = dynamicExports.resolveChatAgentAssignmentTarget as ResolveAssignmentTarget | undefined;

check(typeof buildAssignmentCommand === 'function', 'target core exports the immutable-id assignment command builder');
check(typeof parseAssignmentCommand === 'function', 'target core exports the assignment command parser');
check(typeof resolveAssignmentTarget === 'function', 'target core exports the ambiguity-aware assignment resolver');

function parsedSelectorKind(parsed: AssignmentParseResult | null): string | null {
  if (!parsed) return null;
  if (typeof parsed.selectorKind === 'string') return parsed.selectorKind;
  const selector = parsed.selector;
  if (selector && typeof selector === 'object') {
    const kind = (selector as Record<string, unknown>).kind;
    return typeof kind === 'string' ? kind : null;
  }
  if (typeof parsed.agentId === 'string') return 'id';
  if (typeof parsed.name === 'string') return 'name';
  return null;
}

function parsedSelectorValue(parsed: AssignmentParseResult | null): string | null {
  if (!parsed) return null;
  if (typeof parsed.selector === 'string') return parsed.selector;
  const selector = parsed.selector;
  if (selector && typeof selector === 'object') {
    const record = selector as Record<string, unknown>;
    const value = record.value ?? record.id ?? record.name;
    return typeof value === 'string' ? value : null;
  }
  if (typeof parsed.agentId === 'string') return parsed.agentId;
  if (typeof parsed.name === 'string') return parsed.name;
  return null;
}

const PICKED_ID = 'session::conn-alpha::agent:main:release#1';
const UNIQUE_ID = '77777777-7777-4777-8777-777777777777';
const DUPLICATE_A_ID = '88888888-8888-4888-8888-888888888888';
const DUPLICATE_B_ID = '99999999-9999-4999-8999-999999999999';
const assignmentAgents: AssignmentAgent[] = [
  {
    id: PICKED_ID,
    name: 'Renamed after picker selection',
    provider: 'codex',
    status: 'idle',
  },
  {
    id: UNIQUE_ID,
    name: 'Release #1 Agent With Spaces',
    provider: 'claude-code',
    status: 'active',
  },
  {
    id: DUPLICATE_A_ID,
    name: 'Duplicate #Ops Agent',
    provider: 'codex',
    status: 'active',
  },
  {
    id: DUPLICATE_B_ID,
    name: 'duplicate #ops agent',
    provider: 'cursor',
    status: 'active',
  },
];

if (buildAssignmentCommand && parseAssignmentCommand && resolveAssignmentTarget) {
  const seed = buildAssignmentCommand(PICKED_ID);
  check(typeof seed === 'string' && /^\/assign\s+--id\s+/i.test(seed), 'picker command carries an explicit id selector');
  check(!seed.includes('Renamed after picker selection'), 'picker command never serializes the display name as identity');
  const pickedCommand = `${seed}${/\s$/.test(seed) ? '' : ' '}finish the release`;
  const pickedParsed = parseAssignmentCommand(pickedCommand);
  check(Boolean(pickedParsed), 'encoded picker command parses');
  check(parsedSelectorKind(pickedParsed) === 'id', 'picker command parses as an id selector');
  check(parsedSelectorValue(pickedParsed) === PICKED_ID, 'encoded picker id round-trips exactly');
  check(pickedParsed?.task === 'finish the release', 'picker command preserves the task text');
  const pickedResolution = resolveAssignmentTarget(assignmentAgents, pickedParsed);
  check(pickedResolution.ok === true, 'picker id resolves');
  check(pickedResolution.agent?.id === PICKED_ID, 'picker resolves the immutable id despite a changed display label');

  const quotedParsed = parseAssignmentCommand(
    '/assign @"Release #1 Agent With Spaces" verify the quoted target',
  );
  check(Boolean(quotedParsed), 'quoted spaced/hash label parses');
  check(parsedSelectorKind(quotedParsed) === 'name', 'quoted label remains an explicit name selector');
  check(parsedSelectorValue(quotedParsed) === 'Release #1 Agent With Spaces', 'quoted label preserves spaces and hash');
  check(quotedParsed?.task === 'verify the quoted target', 'quoted-label command preserves task text');
  const quotedResolution = resolveAssignmentTarget(assignmentAgents, quotedParsed);
  check(quotedResolution.ok === true, 'one quoted label resolves uniquely');
  check(quotedResolution.agent?.id === UNIQUE_ID, 'quoted label resolves to the exact immutable agent id');

  const duplicateParsed = parseAssignmentCommand(
    '/assign @"Duplicate #Ops Agent" do not choose the first match',
  );
  check(Boolean(duplicateParsed), 'duplicate quoted label still parses structurally');
  const duplicateResolution = resolveAssignmentTarget(assignmentAgents, duplicateParsed);
  check(duplicateResolution.ok === false, 'duplicate typed names fail closed');
  check(duplicateResolution.reason === 'ambiguous', 'duplicate typed names return the typed ambiguous reason');
  let dispatches = 0;
  if (duplicateResolution.ok === true && duplicateResolution.agent) dispatches += 1;
  check(dispatches === 0, 'ambiguous typed name makes zero dispatches');

  const missingResolution = resolveAssignmentTarget(
    assignmentAgents,
    parseAssignmentCommand('/assign @"Missing #Agent" do nothing'),
  );
  check(missingResolution.ok === false, 'missing typed name fails closed');
  check(missingResolution.reason === 'not_found', 'missing typed name returns not_found');
}

// Default identity is structural, never inferred from a label or substring.
const CANONICAL_DEFAULT_AGENT_ID = 'default::blackswan';
const LIVE_SESSION_ID = 'openswan::conn-live::agent:main:live';
const LIVE_CONNECTION_ID = 'conn-live';
const LIVE_SESSION_KEY = 'agent:main:live';
const targetAgents: AssignmentAgent[] = [
  {
    id: CANONICAL_DEFAULT_AGENT_ID,
    name: 'OpenSwan',
    provider: 'blackswan-local',
    status: 'active',
  },
  {
    id: LIVE_SESSION_ID,
    name: 'OpenSwan',
    provider: 'openswan',
    status: 'active',
    source: 'openswan-session',
    sessionKey: LIVE_SESSION_KEY,
    connectionId: LIVE_CONNECTION_ID,
  },
  {
    id: 'my-default-looking-worker',
    name: 'Not the default',
    provider: 'openswan',
    status: 'idle',
    source: 'openswan-session',
    sessionKey: 'agent:main:not-default',
    connectionId: 'conn-other',
  },
];
const targets = buildChatAgentTargets(targetAgents);
const defaultTargets = targets.filter((target) => target.isDefault === true);
check(defaultTargets.length === 1, 'target list contains one and only one default');
check(defaultTargets[0]?.id === DEFAULT_CHAT_AGENT_TARGET_ID, 'only the canonical Chat target id isDefault');
check(defaultTargets[0]?.agent?.id === CANONICAL_DEFAULT_AGENT_ID, 'canonical default target comes only from exact default::blackswan');
check(
  targets.every((target) => target.isDefault !== true || target.id === DEFAULT_CHAT_AGENT_TARGET_ID),
  'no noncanonical target can carry isDefault',
);

const liveTargetId = `agent::${LIVE_SESSION_ID}`;
const liveTarget = targets.find((target) => target.id === liveTargetId);
check(Boolean(liveTarget), 'live session named OpenSwan remains a distinct target');
check(liveTarget?.isDefault !== true, 'live session named OpenSwan is not default');
check(liveTarget?.agent?.id === LIVE_SESSION_ID, 'live target preserves its immutable agent id');
check(liveTarget?.agent?.connectionId === LIVE_CONNECTION_ID, 'live target preserves its exact connection id');
check(liveTarget?.agent?.sessionKey === LIVE_SESSION_KEY, 'live target preserves its exact session key');
const selectedLiveTarget = resolveChatAgentTarget(targets, liveTargetId);
check(selectedLiveTarget.id === liveTargetId, 'live OpenSwan session resolves by exact target id');
check(selectedLiveTarget.agent?.id === LIVE_SESSION_ID, 'resolved live target returns the exact original agent object');
const defaultLooking = targets.find((target) => target.agent?.id === 'my-default-looking-worker');
check(defaultLooking?.isDefault !== true, 'an id containing default does not become the canonical default');

// Source wiring: picker -> encoded id command -> pure parse/resolve -> exact
// resolved agent. The old display-name round trip and first-match lookup are
// forbidden. Selected live-session dispatch likewise forwards the target's
// original agent object and the exact connection/session identities.
const assignCommandRoute = section(
  chatSource,
  '// /assign — single-target dispatch.',
  '// /v2loop',
  '/assign command route',
);
const assignPickerRender = section(
  chatSource,
  '{item.assignPickerAgents ? (',
  '{item.bridgeDiagResults ? (',
  'AssignPickerCard render wiring',
);
const selectedAgentRoute = section(
  chatSource,
  '// ─── Selected connected-agent route',
  '// ─── Governance commands',
  'selected connected-agent route',
);
const assignedDispatch = section(
  chatSource,
  'const dispatchAssignedAgentTask = useCallback',
  'const spawnDedicatedOpenSwanSession = useCallback',
  'assigned-agent transport',
);

for (const helper of [
  'buildChatAgentAssignmentCommand',
  'parseChatAgentAssignmentCommand',
  'resolveChatAgentAssignmentTarget',
]) {
  expectMatch(targetsSource, new RegExp(`export\\s+function\\s+${helper}(?:\\s*<[^>{}]+>)?\\s*\\(`), `target core owns ${helper}`);
  expectMatch(chatSource.slice(0, 20_000), new RegExp(`\\b${helper}\\b`), `Chat imports ${helper}`);
}
expectMatch(assignPickerRender, /buildChatAgentAssignmentCommand\s*\(\s*agent\.id\s*\)/, 'picker seeds assignment from the picked immutable id');
expectNoMatch(assignPickerRender, /setInput\(\s*`\/assign\s+@\$\{agent\.name\}/, 'picker never round-trips identity through the display name');
expectMatch(assignCommandRoute, /parseChatAgentAssignmentCommand\s*\(/, '/assign delegates syntax to the pure parser');
expectMatch(assignCommandRoute, /resolveChatAgentAssignmentTarget\s*\(/, '/assign delegates identity/cardinality to the pure resolver');
expectNoMatch(assignCommandRoute, /liveAgents\.find\([\s\S]{0,180}\.name/, '/assign never chooses the first display-name match');
expectMatch(assignCommandRoute, /\.reason\s*===\s*['"]ambiguous['"]|case\s+['"]ambiguous['"]/, '/assign surfaces ambiguous typed names explicitly');

expectMatch(pickerSource, /\bid:\s*string\s*;/, 'picker row contract retains immutable agent id');
expectMatch(pickerSource, /onPick:\s*\(agent:\s*AssignPickerAgent\)/, 'picker callback returns the exact picked agent record');
expectMatch(pickerSource, /key=\{agent\.id\}/, 'picker rows are keyed by immutable agent id');

expectMatch(
  targetsSource,
  /const\s+DEFAULT_CHAT_AGENT_RUNTIME_ID\s*=\s*['"]default::blackswan['"][\s\S]{0,12000}agent\.id\s*===\s*DEFAULT_CHAT_AGENT_RUNTIME_ID/,
  'default detection checks only the exact canonical runtime id',
);
expectNoMatch(targetsSource, /agent\.id\.includes\(\s*['"]default['"]\s*\)/, 'default detection never uses an id substring');
expectNoMatch(targetsSource, /agent\.name\.toLowerCase\(\)\s*===\s*['"]openswan['"]/, 'default detection never uses the OpenSwan display label');

expectMatch(selectedAgentRoute, /selectedChatAgentTarget\.agent\s+as\s+AssignableAgent/, 'selected target forwards its exact retained agent object');
expectMatch(selectedAgentRoute, /dispatchAssignedAgentTask\(\s*selectedDispatchAgent\s*,/, 'selected route dispatches that exact retained agent');
expectMatch(assignedDispatch, /resolveOpenSwanConnection\(\s*agent\.connectionId\s*\)/, 'live OpenSwan dispatch resolves the exact retained connection id');
expectMatch(
  assignedDispatch,
  /sendSessionMessage\(\s*[A-Za-z_$][\w$]*\s*,\s*agent\.sessionKey\s*,/,
  'live OpenSwan dispatch sends to the exact retained session key',
);
expectMatch(assignedDispatch, /externalDispatchKind:\s*['"]sessions_send['"]/, 'live OpenSwan session is stamped sessions_send');
expectMatch(assignedDispatch, /externalConnectionId\s*[,}]/, 'live OpenSwan session stamps the exact external connection id');

if (failures.length > 0) {
  console.error(`chat agent target-identity smoke: ${failures.length} failed, ${passed} passed`);
  failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`chat agent target-identity smoke: all ${passed} assertions passed`);
}
