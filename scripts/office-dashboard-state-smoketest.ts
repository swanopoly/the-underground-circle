/** Focused contract for truthful Office runs, durable dashboard state, and complete floor presets. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyOfficeFloorPreset,
  buildOfficeFloorPresetSnapshot,
  readOfficeFloorPresetSnapshot,
  reconcileAutomaticOfficeFloorAssignments,
} from '../src/lib/officeFloorPresetCore';
import { validateOfficeLayout } from '../src/lib/officeValidation';
import { interpretOfficeLayoutSaveReceipt } from '../src/lib/officeLayoutSaveReceiptCore';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');

const floor: any = {
  id: 'floor-a',
  name: 'Build Deck',
  themeId: 'cyber-grid',
  order: 3,
  agentIds: ['agent-a', 'agent-b'],
  furniture: [
    { id: 'desk-a', type: 'desk', x: 20, y: 30, rotation: 90, label: 'Ship desk' },
    {
      id: 'tool-a', type: 'github_feed', x: 90, y: 50,
      githubRepo: 'circle/repo', githubCommits: 12, githubPRs: 2,
      buttonPresets: ['Status update', 'Ship it'],
    },
    {
      id: 'tool-b', type: 'smart_tv', x: 150, y: 60,
      tvApp: 'youtube', tvContentUrl: 'https://youtube.com/embed/demo', tvPoweredOn: true,
    },
  ],
};

const snapshot = buildOfficeFloorPresetSnapshot(floor);
assert(snapshot, 'complete floor snapshot builds');
assert.equal(snapshot!.schemaVersion, 1, 'snapshot schema is versioned');
assert.equal(snapshot!.floor.themeId, floor.themeId, 'theme survives');
assert.deepEqual(snapshot!.floor.agentIds, floor.agentIds, 'assigned agents survive');
assert.equal(snapshot!.floor.furniture.length, 3, 'every item/tool survives');
assert.equal((snapshot!.floor.furniture[1] as any).githubRepo, 'circle/repo', 'connected tool configuration survives');
assert.deepEqual((snapshot!.floor.furniture[1] as any).buttonPresets, ['Status update', 'Ship it'], 'interactive state survives');
floor.furniture[0].label = 'mutated after save';
assert.equal(snapshot!.floor.furniture[0].label, 'Ship desk', 'snapshot is detached from live floor state');

const destination: any = { id: 'floor-dest', name: 'Customer Floor', order: 8, themeId: 'old', agentIds: [], furniture: [] };
const applied = applyOfficeFloorPreset(snapshot, destination, 'seed_123');
assert(applied, 'valid preset applies');
assert.equal(applied!.id, destination.id, 'apply preserves destination floor id');
assert.equal(applied!.name, destination.name, 'apply preserves destination floor name');
assert.equal(applied!.order, destination.order, 'apply preserves destination order');
assert.equal(applied!.themeId, snapshot!.floor.themeId, 'apply replaces theme');
assert.equal(applied!.agentAssignmentMode, 'manual', 'preset application makes its captured roster durable user-owned state');
assert.deepEqual(applied!.agentIds, snapshot!.floor.agentIds, 'apply replaces agent assignments');
assert.equal(applied!.furniture.length, snapshot!.floor.furniture.length, 'apply replaces all items/tools');
assert(applied!.furniture.every((item, index) => item.id === `preset_seed_123_${index}`), 'apply assigns fresh deterministic item ids');
assert.equal(readOfficeFloorPresetSnapshot({ schemaVersion: 2, floor: snapshot!.floor }), null, 'unknown snapshot version fails closed');
assert.equal(buildOfficeFloorPresetSnapshot({ ...floor, furniture: Array.from({ length: 101 }, () => ({})) }), null, 'oversized floor fails closed');
const sanitizedPreset = readOfficeFloorPresetSnapshot({
  schemaVersion: 1,
  floor: {
    name: '<b>Unsafe</b>',
    themeId: 'underground',
    agentIds: [],
    furniture: [{ id: 'tv-a', type: 'smart_tv', x: 1, y: 2, label: '<b>TV</b>', tvContentUrl: 'javascript:alert(1)' }],
  },
});
assert(sanitizedPreset, 'structurally valid server preset is readable');
assert.equal(sanitizedPreset!.floor.name, 'Unsafe', 'preset floor name is sanitized before apply');
assert.equal(sanitizedPreset!.floor.furniture[0].label, 'TV', 'preset item label is sanitized before apply');
assert.equal((sanitizedPreset!.floor.furniture[0] as any).tvContentUrl, null, 'unsafe preset tool URL is removed before apply');

const automaticRoster = reconcileAutomaticOfficeFloorAssignments([
  { ...destination, id: 'manual', order: 0, agentAssignmentMode: 'manual', agentIds: ['agent-b'] },
  { ...destination, id: 'auto-a', order: 1, agentAssignmentMode: 'auto', agentIds: [] },
  { ...destination, id: 'auto-b', order: 2, agentIds: [] },
], ['agent-a', 'agent-b', 'agent-c', 'agent-c'], 1);
assert.deepEqual(automaticRoster[0].agentIds, ['agent-b'], 'automatic reconciliation never overwrites a manual floor');
assert.deepEqual(automaticRoster[1].agentIds, ['agent-a'], 'manual assignments are removed from the automatic pool');
assert.deepEqual(automaticRoster[2].agentIds, ['agent-c'], 'remaining live agents distribute uniquely by automatic floor order');
assert.equal(automaticRoster[2].agentAssignmentMode, 'auto', 'legacy floors become explicit automatic assignments');
assert.equal(
  reconcileAutomaticOfficeFloorAssignments(automaticRoster, ['agent-a', 'agent-b', 'agent-c'], 1),
  automaticRoster,
  'an already reconciled roster preserves reference identity and cannot churn persistence versions',
);
assert.equal(
  reconcileAutomaticOfficeFloorAssignments(automaticRoster, ['agent-c', 'agent-b', 'agent-a'], 1),
  automaticRoster,
  'status-only display reordering preserves stable automatic occupancy and cannot churn persistence versions',
);
const replacedDepartedAgent = reconcileAutomaticOfficeFloorAssignments(
  automaticRoster,
  ['agent-b', 'agent-c', 'agent-d'],
  1,
);
assert.deepEqual(replacedDepartedAgent[1].agentIds, ['agent-d'], 'a departed automatic occupant is replaced from the live roster');
assert.deepEqual(replacedDepartedAgent[2].agentIds, ['agent-c'], 'another automatic floor retains its live occupant during vacancy repair');
const manualClaimWins = reconcileAutomaticOfficeFloorAssignments([
  { ...destination, id: 'manual', order: 0, agentAssignmentMode: 'manual', agentIds: ['agent-c'] },
  { ...destination, id: 'auto-a', order: 1, agentAssignmentMode: 'auto', agentIds: ['agent-c'] },
  { ...destination, id: 'auto-b', order: 2, agentAssignmentMode: 'auto', agentIds: ['agent-d'] },
], ['agent-c', 'agent-d', 'agent-e'], 1);
assert.deepEqual(manualClaimWins[1].agentIds, ['agent-e'], 'manual claims evict duplicate automatic occupants before vacancies refill');
assert.deepEqual(manualClaimWins[2].agentIds, ['agent-d'], 'manual claim repair retains unrelated automatic occupancy');

const dirtyLayout: any = { floors: [{ ...destination, name: '<b>Safe</b>', furniture: [{ id: 'x', type: 'desk', x: 1, y: 2, label: '<b>Desk</b>' }] }], currentFloorId: destination.id, updatedAt: 1 };
const validated = validateOfficeLayout(dirtyLayout);
assert(validated.valid, 'valid layout sanitizes');
assert.equal(dirtyLayout.floors[0].name, '<b>Safe</b>', 'validation does not mutate caller state');
assert.equal(validated.sanitizedLayout.floors[0].name, 'Safe', 'server payload is sanitized clone');

const officeTab = read('src/screens/circles/tabs/OfficeTab.tsx');
const customizePanel = read('src/screens/circles/tabs/office/CustomizePanel.tsx');
const officeSections = read('src/screens/circles/tabs/office/OfficeSections.tsx');
const attention = read('src/lib/chatAttentionQueue.ts');
const historyCore = read('src/lib/runHistoryFilterCore.ts');
const historyDrawer = read('src/components/chat/RunHistoryDrawer.tsx');
const agentRunsPanel = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');
const persistence = read('src/lib/officeDashboardPersistence.ts');
const saveQueueCore = read('src/lib/officeLayoutSaveQueueCore.ts');
const migration = read('supabase/migrations/20260811120000_office_dashboard_state_and_floor_presets.sql');
const exactReceiptMigration = read('supabase/migrations/20260813140000_office_layout_exact_save_receipt.sql');
const consolidatedSql = read('docs/RUN_THIS_SQL.sql');

assert(
  officeTab.includes('listOfficeAttentionAcknowledgements(')
    && officeTab.includes('toOfficeDashboardAuthority(requestedAuthority)')
    && officeTab.includes('requestIsCurrent'),
  'Office loads durable attention acknowledgements through exact current authority',
);
assert(
  officeTab.includes('acknowledgeOfficeAttention(')
    && officeTab.includes('item.kind === \'run_blocked\' ? item.refId : null'),
  'Office persists a dismissal through the exact-authority path',
);
assert(attention.includes('blockedVisibilityMs') && attention.includes("id: `run:${run.id}:${revision}`"), 'attention ages out stale blockers and keys revisions');
assert(officeTab.includes(".freshness !== 'stale'"), 'Office poll excludes stale blocked runs');

assert(historyCore.includes('PROCESSING_HISTORY_STATUSES') && historyCore.includes("if (!PROCESSING_HISTORY_STATUSES.has(status)) return 'other'"), 'ACTIVE bucket requires actually processing statuses');
assert(
  !historyDrawer.includes('reapRun(')
    && historyDrawer.includes('Run history is presentation-only')
    && historyDrawer.includes('cancelStaleRunExact('),
  'opening the drawer is read-only; only its explicit exact-receipt Cancel may mutate',
);
assert(historyDrawer.includes('CLOSE AS CANCELLED'), 'stale legacy runs have an honest explicit close action');
assert(historyDrawer.includes('has not been marked completed'), 'stale copy never fabricates completion');
assert(historyDrawer.includes('setFreshnessTick') && historyDrawer.includes('30_000'), 'open Circle Runs ages freshness without a remount');
assert(agentRunsPanel.includes('bucketRunForHistory(run, nowMs)'), 'per-agent ACTIVE uses the shared freshness bucket');
assert(agentRunsPanel.includes('UPDATE MISSING · NOT ACTIVE'), 'stale connected-agent handoffs are not presented as active');

assert(!officeTab.includes('OfficeRunningCostStrip'), 'Office top dashboard omits the running-cost/reset strip');
assert(!officeTab.includes('<StatusPicker'), 'Office top dashboard omits the presence and timer picker');
assert(!officeTab.includes("components/office/StatusPicker"), 'Office no longer loads the removed header-only presence control');

assert(officeTab.includes('pendingLayoutSaveRef') && officeTab.includes('layoutSaveInFlightRef'), 'layout writes are coalesced and serialized');
assert(officeTab.includes('Math.max(Date.now(), layoutVersionRef.current + 1)'), 'layout writes use monotonic client versions');
assert(officeTab.includes("layoutRes.source === 'none' || localUpdatedAt > remoteLayoutUpdatedAt"), 'a successful no-row read or newer owned cache seeds the exact circle row');
assert(officeTab.includes('drainLatestOfficeLayoutSaveQueue') && officeTab.includes('queueLatestOfficeLayoutSave'), 'layout saves use the executable newest-snapshot queue');
assert(officeTab.includes('active: activeLayoutSaveRef'), 'queue freshness includes the active save, not only waiting work');
assert(!officeTab.includes('if (result.conflict) {\n            authoritativeLayoutReadRef.current = false;\n            pendingLayoutSaveRef.current = null;'), 'an older conflict cannot erase a newer pending layout');
assert(officeTab.includes('officeLayoutLocalCacheKey(currentUserId, circleId)'), 'local floor cache is user-and-circle scoped');
assert(officeTab.includes('createOfficeLayoutLocalWriteQueue(storage)'), 'local floors/current-floor/version persist through one ordered verified envelope queue');
assert(
  officeTab.includes('scope: floorLayoutScope!')
    && officeTab.includes('getActiveScope: () => layoutSaveScopeRef.current')
    && saveQueueCore.includes('handlers.getActiveScope() !== item.scope'),
  'queued server saves are bound to the authenticated user-and-circle scope',
);
assert(
  officeTab.includes('const { session: authSession, user: authUser, loading: authLoading } = useAuth()')
    && officeTab.includes('authUser.id === authSession.user.id')
    && !officeTab.slice(officeTab.indexOf('// ─── Current user')).includes('setCurrentUserId('),
  'Office identity comes from the single app-owned authenticated session',
);
assert(
  persistence.includes('authScope: OfficeLayoutAuthScope')
    && (persistence.match(/\.setHeader\('Authorization', `Bearer \$\{authority\.accessToken\}`\)/g) || []).length >= 2,
  'layout reads and writes carry one captured authenticated authority',
);
assert(
  officeTab.includes('runOfficeLayoutRequestWithDeadline(() => storage.getItem')
    && officeTab.includes('Connection discovery is enrichment, never a layout-hydration')
    && officeTab.includes('Office layout initialization timed out. Local editing is available'),
  'optional storage, private-preference, and bridge work cannot strand Office hydration forever',
);
assert(
  officeTab.includes('floorLayoutMutationEpochRef.current === pending.mutationEpoch'),
  'an older receipt cannot label a newer rendered mutation as saved',
);
assert(
  officeTab.includes('prefsP.then(')
    && officeTab.includes("status: 'rejected' as const")
    && officeTab.includes('private preference enrichment are independent')
    && officeTab.includes('loadOfficeUserPreferences(circleId, requestedAuthScope)'),
  'optional private-preference timeouts cannot discard a successful authoritative layout read',
);
assert(
  officeTab.includes('{ ...waiting, authScope: retryAuthScope }')
    && officeTab.includes('const retryMutationEpoch = floorLayoutMutationEpochRef.current')
    && officeTab.includes('floorLayoutMutationEpochRef.current !== retryMutationEpoch'),
  'Retry refreshes the pending credential and rejects a snapshot changed during local verification',
);
assert(
  officeTab.includes("@office_private_v2:${kind}:${userId}:${circleId}")
    && !officeTab.includes("const STORAGE_KEY_TELEGRAM = '@office_telegram_config'")
    && !officeTab.includes("const STORAGE_KEY_AGENT_NAMES = '@office_agent_names'")
    && !officeTab.includes("const STORAGE_KEY_APPEARANCES = '@office_appearances'")
    && !officeTab.includes("const STORAGE_KEY_WHITEBOARD_NOTES = '@office_whiteboard_notes'"),
  'Office private local state is namespaced to the exact authenticated user and circle',
);
assert(
  officeTab.includes('Ownerless legacy local keys are intentionally not')
    && officeTab.includes("setTelegramConfig({ botToken: '', chatId: '' })")
    && officeTab.includes('tgPollerRef.current = null')
    && officeTab.includes('setAppearances({})')
    && officeTab.includes('setWhiteboardNotes([])')
    && officeTab.includes("setAgentFilterMode('all')")
    && officeTab.includes('setSelectedAgent(null)')
    && officeTab.includes('setUserNfts([])')
    && !officeTab.includes('loadBudgetConfig()')
    && !officeTab.includes('loadIdleConfig()'),
  'private and transient Office state is cleared before a new authenticated scope hydrates',
);
const idleSchedulerEffectStart = officeTab.indexOf('// Idle work owns a dedicated exact-authority lifecycle.');
const idleSchedulerEffectEnd = officeTab.indexOf('const mutateFloorsDurably', idleSchedulerEffectStart);
assert(idleSchedulerEffectStart >= 0 && idleSchedulerEffectEnd > idleSchedulerEffectStart, 'dedicated idle scheduler effect is present');
const idleSchedulerEffect = officeTab.slice(idleSchedulerEffectStart, idleSchedulerEffectEnd);
assert(
  idleSchedulerEffect.includes('const requestedAuthority = committedAuthAuthority')
    && idleSchedulerEffect.includes('idleConfigReadyAuthorityKey !== requestedReadyKey')
    && idleSchedulerEffect.includes('!requestedAuthority || !floorLayoutHydrated')
    && idleSchedulerEffect.includes('authorityGeneration: requestedAuthority.generation'),
  'idle scheduling requires the committed generation plus exact config and membership hydration',
);
assert(
  idleSchedulerEffect.includes('startIdleScheduler(')
    && !idleSchedulerEffect.includes('connections.filter')
    && !idleSchedulerEffect.includes('currentUserName')
    && !idleSchedulerEffect.includes('startHeartbeat(')
    && !idleSchedulerEffect.includes('joinPresenceChannel('),
  'bridge and presence churn cannot restart the dedicated idle scheduler',
);
assert.equal(
  (officeTab.match(/startIdleScheduler\(/g) || []).length,
  1,
  'Office owns exactly one scheduler start site',
);
assert(
  officeTab.includes('loadIdleConfigExact(idleSchedulerAuthority)')
    && officeTab.includes('idlePreferencesResolved = prefsRes.ok === true')
    && officeTab.includes('mergeRemoteIdleConfigWithExactRunHistory(')
    && officeTab.includes('setIdleConfigReadyAuthorityKey(idleConfigAuthorityKey(idleSchedulerAuthority))'),
  'idle readiness follows exact local load plus a resolved remote preference read',
);
assert(
  officeTab.includes('Remote preferences own user choices. The exact local receipt may only')
    && officeTab.includes('remoteRanAt >= localRanAt')
    && officeTab.includes('localRanAt > Date.now() + 5 * 60_000'),
  'remote idle settings stay primary while only sensible newer exact run history advances',
);
assert(
  officeTab.includes('setIdleConfigReadyAuthorityKey(null)')
    && officeTab.includes('idleConfigReadyAuthorityKey !== idleConfigAuthorityKey({')
    && officeTab.includes('remoteIdleAppliedRef.current = false;'),
  'authority changes reset idle readiness and hydration cannot echo stale settings',
);
assert(
  officeTab.includes('`${committedAuthScopeKey}:generation:${requestedAuthority.generation}:retry:${officeAccessRetry}`')
    && officeTab.includes('requestedAuthority.generation !== authAuthorityRef.current?.generation')
    && officeTab.includes('[authReady, circleId, committedAuthAuthority, committedAuthScopeKey'),
  'an auth retry hydrates and starts one replacement scheduler for the new committed generation',
);
assert(
  customizePanel.includes('SHARED CHAT · OWNER OPT-IN')
    && customizePanel.includes('b.writesToSharedChat && nextEnabled')
    && customizePanel.includes('? true\n                                : idleConfig.sharedChatOptIn')
    && customizePanel.includes('const ownerOnlyBehavior = b.ownerOnly || b.writesToSharedChat')
    && customizePanel.includes('const ownerRestricted = ownerOnlyBehavior && !isOwner')
    && customizePanel.includes('disabled={ownerRestricted}')
    && customizePanel.includes('Only the owner can enable this'),
  'Customize makes shared Chat authority an explicit owner-only opt-in',
);
const tierTwoIdleStart = customizePanel.indexOf('{/* Tier 2 — AI-Powered */}');
const tierTwoIdleEnd = customizePanel.indexOf('{/* Tier 3 — Owner Only */}', tierTwoIdleStart);
assert(tierTwoIdleStart >= 0 && tierTwoIdleEnd > tierTwoIdleStart, 'Tier 2 idle controls are present');
const tierTwoIdleControls = customizePanel.slice(tierTwoIdleStart, tierTwoIdleEnd);
assert(
  tierTwoIdleControls.includes('const ownerOnlyBehavior = b.ownerOnly || b.writesToSharedChat')
    && tierTwoIdleControls.includes('const ownerRestricted = ownerOnlyBehavior && !isOwner')
    && tierTwoIdleControls.includes('idleConfig.sharedChatOptIn && isOwner')
    && tierTwoIdleControls.includes('sharedChatOptIn: b.writesToSharedChat && nextEnabled')
    && tierTwoIdleControls.includes('disabled={ownerRestricted}')
    && tierTwoIdleControls.includes('accessibilityState={{ checked: effectivelyEnabled, disabled: ownerRestricted }}'),
  'every AI-powered shared Chat writer uses the same explicit owner opt-in control',
);
const tierThreeIdleStart = customizePanel.indexOf('{/* Tier 3 — Owner Only */}');
const tierThreeIdleEnd = customizePanel.indexOf('</ScrollView>', tierThreeIdleStart);
assert(tierThreeIdleStart >= 0 && tierThreeIdleEnd > tierThreeIdleStart, 'Tier 3 idle controls are present');
const tierThreeIdleControls = customizePanel.slice(tierThreeIdleStart, tierThreeIdleEnd);
assert(
  tierThreeIdleControls.includes('!b.writesToSharedChat || idleConfig.sharedChatOptIn')
    && tierThreeIdleControls.includes("b.writesToSharedChat ? ' · SHARED CHAT · OWNER ONLY' : ''")
    && tierThreeIdleControls.includes("b.writesToSharedChat && !idleConfig.sharedChatOptIn ? ' · Opt-in required' : ''")
    && tierThreeIdleControls.includes('const nextEnabled = !effectivelyEnabled')
    && tierThreeIdleControls.includes('sharedChatOptIn: b.writesToSharedChat && nextEnabled')
    && tierThreeIdleControls.includes('accessibilityState={{ checked: effectivelyEnabled }}')
    && !tierThreeIdleControls.includes('enabled: !state.enabled'),
  'owner-only Tier 3 shared writers cannot appear enabled or toggle on without explicit Chat opt-in',
);
assert.equal(
  (customizePanel.match(/sharedChatOptIn: b\.writesToSharedChat && nextEnabled/g) || []).length,
  3,
  'Tier 1, Tier 2, and Tier 3 all grant shared Chat opt-in only on an explicit enabling toggle',
);
assert(
  !officeTab.includes("localStorage.getItem('uc_office_agent_filter_v1')")
    && !officeTab.includes("localStorage?.setItem('uc_office_agent_filter_v1'")
    && !officeTab.includes('supabase.auth.getUser()'),
  'Office filter and action authority no longer use global browser state or a second raw auth lookup',
);
assert(
  officeTab.includes('const requestedAuthority = authAuthorityRef.current')
    && officeTab.includes('createOfficePreferenceWriteQueue({')
    && officeTab.includes('getCurrentScope: () => authAuthorityRef.current')
    && officeTab.includes('currentScope?.generation !== item.authorityGeneration')
    && persistence.includes(".rpc('patch_my_office_preferences_v1'")
    && persistence.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
  'deferred Office preference writes retain exact captured authority and reject a retired user',
);
assert(officeTab.includes('layoutVersionRef.current !== version'), 'stale async local-write completions cannot enqueue an older server snapshot');
assert(!officeTab.includes('setFloors(prev =>') && !officeTab.includes('setFloors((current) =>'), 'widget and integration mutations cannot bypass synchronous floor authority');
assert(officeTab.includes('if (!authoritativeLayoutReadRef.current)'), 'failed authoritative reads pause server writes');
assert(officeTab.includes('if (skipNextLayoutPersistenceRef.current)'), 'hydration itself does not churn layout versions');
assert(
  officeTab.includes('Boolean(floorLayoutScope)')
    && officeTab.includes('floorLayoutHydratedCircleId === floorLayoutScope'),
  'null auth scope cannot masquerade as a hydrated Office layout',
);
assert(officeTab.includes('if (floorId === currentFloorId) return'), 'switching to the active floor is an inert no-op');
assert(persistence.includes(".from('office_layouts')") && persistence.includes(".rpc('save_office_layout_v2'"), 'canonical per-circle server layout path is wired');
assert(!persistence.includes("source: 'legacy_profile'"), 'ambiguous global profile layouts cannot seed another circle');
assert(!persistence.includes(".select('office_layout')") && !officeTab.includes('loadLegacyOfficeLayoutSeed'), 'unowned legacy layouts are never auto-imported into a circle');
assert(persistence.includes('Per-circle Office storage is unavailable.'), 'missing per-circle SQL fails visibly');
assert.deepEqual(
  interpretOfficeLayoutSaveReceipt({ accepted: true, layoutVersion: 41 }, 41),
  { ok: true, version: 41 },
  'an exact accepted RPC receipt succeeds',
);
assert.equal(interpretOfficeLayoutSaveReceipt({ accepted: false, layoutVersion: 42 }, 41).conflict, true, 'an explicit stale RPC receipt is a conflict');
assert.equal(interpretOfficeLayoutSaveReceipt({ accepted: true, layoutVersion: 42 }, 41).ok, false, 'an accepted receipt for the wrong version fails closed');
assert.equal(interpretOfficeLayoutSaveReceipt({ layoutVersion: 41 }, 41).ok, false, 'a receipt without literal acceptance fails closed');
assert.equal(interpretOfficeLayoutSaveReceipt('malformed', 41).ok, false, 'a malformed save receipt fails closed');
assert(
  exactReceiptMigration.includes('stored_version = p_layout_version AND stored_layout = p_layout')
    && migration.includes('stored_version = p_layout_version AND stored_layout = p_layout')
    && consolidatedSql.includes('stored_version = p_layout_version AND stored_layout = p_layout'),
  'equal-version Office saves are accepted only for an identical idempotent payload',
);
for (const sql of [migration, exactReceiptMigration, consolidatedSql]) {
  assert(sql.includes('SECURITY DEFINER'), 'layout save RPC can remain the sole mutation path after raw DML is revoked');
  assert(sql.includes('office_circle_membership_required'), 'layout save RPC explicitly verifies current circle membership');
  assert(sql.includes('p_layout_version > server_now_ms + 300000'), 'layout save rejects far-future client version poisoning');
  assert(sql.includes('p_layout_version > 9007199254740991'), 'layout save versions stay exactly representable in JavaScript');
  assert(sql.includes('REVOKE INSERT, UPDATE, DELETE ON TABLE public.office_layouts FROM authenticated'), 'authenticated layout mutation is RPC-only');
  assert(sql.includes('CREATE TRIGGER office_attention_ack_scope_guard'), 'attention acknowledgement writes run through the circle-scope guard');
  assert(sql.includes('run_circle_id <> NEW.circle_id'), 'an attention acknowledgement cannot reference another circle run');
  assert(sql.includes("NEW.expires_at := NEW.acknowledged_at + interval '30 days'"), 'attention expiry is server-stamped');
}
assert(
  persistence.includes('if (HAS_OFFICE_ATTENTION_SERVER_CLOCK_V1 && !attentionRpcMissingThisSession)')
    && persistence.includes(".rpc('list_active_office_attention_acknowledgements'")
    && persistence.includes('Compatibility for a target that has the historical §37 table'),
  'attention expiry uses the database clock only when declared ready and retains an explicit pre-migration compatibility path',
);
assert(
  persistence.includes('const acknowledgedAt = new Date()')
    && persistence.includes('acknowledged_at: acknowledgedAt.toISOString()')
    && persistence.includes('expires_at: expiresAt.toISOString()')
    && persistence.includes('The hardened trigger overwrites both values'),
  'a pre-migration upsert renews an expired acknowledgement while the hardened trigger retains server-clock authority',
);
assert(!persistence.includes('updated_at: new Date().toISOString()'), 'preset ordering timestamps are server-controlled');
assert(persistence.includes('Number.isSafeInteger(version) && version > 0'), 'client save rejects unsafe layout versions before RPC dispatch');

assert(officeSections.includes('COMPLETE FLOOR PRESETS'), 'floor preset UI is reachable from the Office floor bar');
assert(officeSections.includes('SAVE CURRENT FLOOR') && officeSections.includes('APPLY') && officeSections.includes('DELETE'), 'preset save/apply/delete controls are present');
assert(officeSections.includes('connected tools, labels, and interactive state'), 'preset scope is explicit to the user');
assert(officeSections.includes('☁ SAVED') && officeSections.includes('☁ RETRY SAVE'), 'server save status and retry are visible');
assert(officeSections.includes('if (saved !== false) setFloorPresetName'), 'failed preset saves preserve the typed preset name');
assert(
  persistence.includes('row.circleId === authority.circleId')
    && persistence.includes('row.userId === authority.userId'),
  'preset reads discard any row outside the captured owner and circle',
);
assert(
  persistence.includes(".eq('id', normalizedId)")
    && persistence.includes(".eq('user_id', authority.userId)")
    && persistence.includes(".eq('circle_id', authority.circleId)")
    && persistence.includes(".select('id,circle_id,user_id')"),
  'preset deletion binds the mutation and receipt to the captured owner and circle',
);
assert(
  (officeTab.match(/preset\.circleId !== circleId/g) || []).length >= 2
    && officeTab.includes('toOfficeDashboardAuthority(requestedAuthority)'),
  'preset apply and delete reject stale cross-circle UI state before mutation',
);

for (const sqlContract of [
  'CREATE TABLE IF NOT EXISTS public.office_layouts',
  'CREATE OR REPLACE FUNCTION public.save_office_layout_v2',
  'CREATE TABLE IF NOT EXISTS public.office_attention_acknowledgements',
  'CREATE TABLE IF NOT EXISTS public.office_floor_presets',
  'ALTER TABLE public.office_layouts ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.office_attention_acknowledgements ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.office_floor_presets ENABLE ROW LEVEL SECURITY',
]) assert(migration.includes(sqlContract), `migration contains ${sqlContract}`);
for (const sql of [migration, exactReceiptMigration, consolidatedSql]) {
  assert(sql.includes('WITH repair_clock AS'), 'legacy far-future layout versions are repaired before the new ceiling is enforced');
  assert(sql.includes('office_layouts_version_javascript_safe'), 'the safe-integer layout version ceiling is durable');
  assert(sql.includes('office_attention_acknowledgements_run_circle_fkey'), 'attention acknowledgements have a durable run+circle foreign key');
  assert(
    sql.indexOf('LOCK TABLE public.agent_runs IN SHARE ROW EXCLUSIVE MODE')
      < sql.indexOf('LOCK TABLE public.office_attention_acknowledgements IN SHARE ROW EXCLUSIVE MODE')
      && sql.indexOf('LOCK TABLE public.office_attention_acknowledgements IN SHARE ROW EXCLUSIVE MODE')
        < sql.indexOf('DELETE FROM public.office_attention_acknowledgements AS acknowledgement'),
    'parent and child acknowledgement tables are locked in order before cleanup/FK validation',
  );
  assert(sql.includes('DELETE FROM public.office_attention_acknowledgements AS acknowledgement'), 'legacy cross-circle acknowledgements are removed before the FK is installed');
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.list_active_office_attention_acknowledgements'), 'active acknowledgement reads use the server clock RPC');
  assert(sql.includes('acknowledgement.expires_at > statement_timestamp()'), 'acknowledgement expiry uses the database statement timestamp');
}
assert(migration.includes('office_layouts.layout_version < EXCLUDED.layout_version'), 'SQL rejects out-of-order layout versions');
assert(migration.includes('user_id = auth.uid()'), 'SQL state is owner-scoped');
assert(migration.includes('circle_members'), 'SQL state is circle-membership scoped');
assert(consolidatedSql.includes(migration.trim()), 'RUN_THIS_SQL §37 mirrors the canonical migration exactly');

console.log('office-dashboard-state smoketest: all assertions passed');
