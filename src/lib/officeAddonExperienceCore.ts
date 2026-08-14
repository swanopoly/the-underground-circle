/**
 * Pure experience helpers for the Office item catalog and floor editor.
 *
 * This module deliberately accepts the canonical catalog and current floor as
 * inputs. It does not create a second catalog or persistence path. UI owners
 * can use the helpers for searchable/status-aware catalog views, reversible
 * local editing, and deterministic room-kit placement before the existing
 * Office persistence layer saves the resulting floor.
 */

import {
  OFFICE_ADDON_TYPES,
  getOfficeAddonDefinition,
  getOfficeAddonRuntimeState,
  isOfficeAddonType,
  type OfficeAddonDataState,
  type FurnitureCatalogEntry,
  type FurnitureCategory,
  type FurnitureItem,
  type FurnitureType,
  type OfficeFloor,
} from './officeConfig';

export const OFFICE_ADDON_QUERY_LIMITS = Object.freeze({
  catalogEntries: 500,
  queryCharacters: 120,
  tagsPerItem: 24,
  tagCharacters: 80,
});

export const OFFICE_ADDON_PREFERENCES_STORAGE_KEY = '@office_addon_catalog_preferences_v1';
export const OFFICE_ADDON_PREFERENCES_VERSION = 1 as const;
export const OFFICE_ADDON_PREFERENCE_LIMITS = Object.freeze({
  favoriteTypes: OFFICE_ADDON_TYPES.length,
  recentTypes: 20,
  inputEntries: 500,
  serializedCharacters: 16_384,
});

export interface OfficeServiceAsyncScope {
  generation: number;
  circleId: string;
  floorId: string;
  targetId: string;
  serviceType: string;
  provider: string;
}

/**
 * Pure stale-result gate for Office service/OAuth work. Every identity field
 * must still match; generation alone cannot prevent cross-target/provider
 * updates after a modal or floor switch.
 */
export function isOfficeServiceAsyncScopeCurrent(
  requested: OfficeServiceAsyncScope,
  current: OfficeServiceAsyncScope & { modalVisible: boolean },
): boolean {
  return current.modalVisible
    && requested.generation === current.generation
    && requested.circleId === current.circleId
    && requested.floorId === current.floorId
    && requested.targetId === current.targetId
    && requested.serviceType === current.serviceType
    && requested.provider === current.provider;
}

export type OfficeOAuthWidgetType = 'calendar_widget' | 'email_hub';

/**
 * Clear provider-owned payload whenever a widget changes provider or the
 * selected credential is explicitly disconnected. A connected credential is
 * not evidence that content from the previous provider belongs to it; the
 * next successful provider read is the only path back to `live`.
 */
export function buildOfficeOAuthWidgetReset(input: {
  serviceType: OfficeOAuthWidgetType;
  providerValue: string;
  connected: boolean;
}): Record<string, unknown> {
  if (input.serviceType === 'calendar_widget') {
    return {
      calendarProvider: input.providerValue,
      calendarEvent: input.connected ? 'Refresh calendar' : 'Connect a calendar',
      calendarTime: '',
      calendarEvents: 0,
      dataState: input.connected ? 'stale' : 'setup',
      dataUpdatedAt: undefined,
    };
  }
  return {
    emailProvider: input.providerValue,
    emailConnected: input.connected,
    emailSender: undefined,
    emailSubject: undefined,
    emailTime: undefined,
    emailUnread: 0,
    dataState: input.connected ? 'stale' : 'setup',
    dataUpdatedAt: undefined,
  };
}

export interface OfficeAddonCatalogPreferences {
  version: typeof OFFICE_ADDON_PREFERENCES_VERSION;
  favoriteTypes: readonly FurnitureType[];
  /** Most-recent type first. */
  recentTypes: readonly FurnitureType[];
}

const OFFICE_ADDON_TYPE_RANK = new Map<FurnitureType, number>(
  OFFICE_ADDON_TYPES.map((type, index) => [type, index]),
);

function emptyOfficeAddonCatalogPreferences(): OfficeAddonCatalogPreferences {
  return {
    version: OFFICE_ADDON_PREFERENCES_VERSION,
    favoriteTypes: [],
    recentTypes: [],
  };
}

function boundedPreferenceTypes(value: unknown, limit: number): FurnitureType[] {
  if (!Array.isArray(value)) return [];
  const result: FurnitureType[] = [];
  const seen = new Set<FurnitureType>();
  for (const candidate of value.slice(0, OFFICE_ADDON_PREFERENCE_LIMITS.inputEntries)) {
    if (!isOfficeAddonType(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Normalize untrusted persisted preference data into the current bounded
 * contract. Favorites use canonical catalog order because their input order
 * has no meaning; recents preserve first-seen (most-recent-first) order.
 */
export function normalizeOfficeAddonCatalogPreferences(input: unknown): OfficeAddonCatalogPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return emptyOfficeAddonCatalogPreferences();
  }
  const candidate = input as {
    version?: unknown;
    favoriteTypes?: unknown;
    recentTypes?: unknown;
  };
  if (
    candidate.version !== undefined
    && candidate.version !== OFFICE_ADDON_PREFERENCES_VERSION
  ) {
    return emptyOfficeAddonCatalogPreferences();
  }
  const favoriteTypes = boundedPreferenceTypes(
    candidate.favoriteTypes,
    OFFICE_ADDON_PREFERENCE_LIMITS.favoriteTypes,
  ).sort((a, b) => (OFFICE_ADDON_TYPE_RANK.get(a) ?? 0) - (OFFICE_ADDON_TYPE_RANK.get(b) ?? 0));
  const recentTypes = boundedPreferenceTypes(
    candidate.recentTypes,
    OFFICE_ADDON_PREFERENCE_LIMITS.recentTypes,
  );
  return {
    version: OFFICE_ADDON_PREFERENCES_VERSION,
    favoriteTypes,
    recentTypes,
  };
}

/** Parse either AsyncStorage/localStorage JSON or an already-decoded value. */
export function parseOfficeAddonCatalogPreferences(raw: unknown): OfficeAddonCatalogPreferences {
  if (raw == null || raw === '') return emptyOfficeAddonCatalogPreferences();
  if (typeof raw !== 'string') return normalizeOfficeAddonCatalogPreferences(raw);
  if (raw.length > OFFICE_ADDON_PREFERENCE_LIMITS.serializedCharacters) {
    return emptyOfficeAddonCatalogPreferences();
  }
  try {
    return normalizeOfficeAddonCatalogPreferences(JSON.parse(raw));
  } catch {
    return emptyOfficeAddonCatalogPreferences();
  }
}

/** Stable JSON suitable for AsyncStorage or localStorage. */
export function serializeOfficeAddonCatalogPreferences(input: unknown): string {
  const preferences = normalizeOfficeAddonCatalogPreferences(input);
  return JSON.stringify({
    version: preferences.version,
    favoriteTypes: preferences.favoriteTypes,
    recentTypes: preferences.recentTypes,
  });
}

export function setOfficeAddonFavorite(
  input: unknown,
  type: FurnitureType,
  favorite?: boolean,
): OfficeAddonCatalogPreferences {
  const preferences = normalizeOfficeAddonCatalogPreferences(input);
  if (!isOfficeAddonType(type)) return preferences;
  const favorites = new Set(preferences.favoriteTypes);
  const shouldFavorite = favorite ?? !favorites.has(type);
  if (shouldFavorite) favorites.add(type);
  else favorites.delete(type);
  return normalizeOfficeAddonCatalogPreferences({
    ...preferences,
    favoriteTypes: [...favorites],
  });
}

export function recordOfficeAddonRecentType(
  input: unknown,
  type: FurnitureType,
): OfficeAddonCatalogPreferences {
  const preferences = normalizeOfficeAddonCatalogPreferences(input);
  if (!isOfficeAddonType(type)) return preferences;
  return normalizeOfficeAddonCatalogPreferences({
    ...preferences,
    recentTypes: [type, ...preferences.recentTypes.filter((candidate) => candidate !== type)],
  });
}

/**
 * Merge a persisted snapshot with actions completed while storage was loading.
 * The in-memory recency order wins, while favorites are the bounded union. A
 * scope owner must still decide whether the overlay belongs to the same user
 * and circle before calling this helper.
 */
export function mergeOfficeAddonCatalogPreferences(
  persistedInput: unknown,
  inMemoryInput: unknown,
): OfficeAddonCatalogPreferences {
  const persisted = normalizeOfficeAddonCatalogPreferences(persistedInput);
  const inMemory = normalizeOfficeAddonCatalogPreferences(inMemoryInput);
  return normalizeOfficeAddonCatalogPreferences({
    version: OFFICE_ADDON_PREFERENCES_VERSION,
    favoriteTypes: [...persisted.favoriteTypes, ...inMemory.favoriteTypes],
    recentTypes: [...inMemory.recentTypes, ...persisted.recentTypes],
  });
}

export type OfficeAddonKind = 'decorative' | 'interactive' | 'connected';

export type OfficeAddonStatus =
  | 'decorative'
  | 'local'
  | 'demo'
  | 'setup_required'
  | 'connecting'
  | 'ready'
  | 'stale'
  | 'error';

export interface OfficeAddonCatalogMetadata {
  kind?: OfficeAddonKind;
  tags?: readonly string[];
  primaryAction?: string;
}

export interface OfficeAddonCatalogRuntimeState {
  status: OfficeAddonStatus;
  detail?: string;
  updatedAt?: number;
  /** A ready item becomes stale when `nowMs - updatedAt` exceeds this value. */
  staleAfterMs?: number;
}

type FurnitureTypeCollection = readonly FurnitureType[] | ReadonlySet<FurnitureType>;

export interface OfficeAddonCatalogQuery {
  searchText?: string;
  categories?: readonly FurnitureCategory[];
  kinds?: readonly OfficeAddonKind[];
  statuses?: readonly OfficeAddonStatus[];
  favoriteTypes?: FurnitureTypeCollection;
  /** Most-recent type first. Duplicate values are ignored. */
  recentTypes?: readonly FurnitureType[];
  interactiveTypes?: FurnitureTypeCollection;
  metadataByType?: Partial<Record<FurnitureType, OfficeAddonCatalogMetadata>>;
  runtimeByType?: Partial<Record<FurnitureType, OfficeAddonCatalogRuntimeState>>;
  onlyFavorites?: boolean;
  nowMs?: number;
  limit?: number;
}

export interface OfficeAddonCatalogViewItem {
  entry: FurnitureCatalogEntry;
  kind: OfficeAddonKind;
  status: OfficeAddonStatus;
  statusDetail: string | null;
  primaryAction: string | null;
  favorite: boolean;
  recentRank: number | null;
  searchScore: number;
}

export interface OfficeAddonStatusSummary {
  total: number;
  favorites: number;
  recentlyUsed: number;
  byKind: Record<OfficeAddonKind, number>;
  byStatus: Record<OfficeAddonStatus, number>;
}

const EMPTY_STATUS_COUNTS: Record<OfficeAddonStatus, number> = {
  decorative: 0,
  local: 0,
  demo: 0,
  setup_required: 0,
  connecting: 0,
  ready: 0,
  stale: 0,
  error: 0,
};

function normalizeSearchText(
  value: unknown,
  max: number = OFFICE_ADDON_QUERY_LIMITS.queryCharacters,
): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, max);
}

function boundedLabel(value: unknown, max = 80): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function typeSet(values?: FurnitureTypeCollection): ReadonlySet<FurnitureType> {
  if (!values) return new Set<FurnitureType>();
  return values instanceof Set ? values : new Set(values);
}

function resolveAddonKind(
  entry: FurnitureCatalogEntry,
  metadata: OfficeAddonCatalogMetadata | undefined,
  interactiveTypes: ReadonlySet<FurnitureType>,
): OfficeAddonKind {
  if (metadata?.kind) return metadata.kind;
  if (entry.category === 'connected') return 'connected';
  if (entry.interactive || interactiveTypes.has(entry.type)) return 'interactive';
  return 'decorative';
}

function resolveDefaultAddonStatus(entry: FurnitureCatalogEntry, kind: OfficeAddonKind): OfficeAddonStatus {
  if (entry.readiness === 'decorative') return 'decorative';
  if (entry.readiness === 'setup-required') return 'setup_required';
  switch (entry.defaultDataState) {
    case 'demo': return 'demo';
    case 'setup': return 'setup_required';
    case 'live': return 'ready';
    case 'stale': return 'stale';
    case 'error': return 'error';
    case 'local':
    default:
      if (kind === 'decorative') return 'decorative';
      return 'local';
  }
}

function resolveAddonStatus(
  entry: FurnitureCatalogEntry,
  kind: OfficeAddonKind,
  runtime: OfficeAddonCatalogRuntimeState | undefined,
  nowMs: number,
): { status: OfficeAddonStatus; detail: string | null } {
  if (!runtime) {
    return { status: resolveDefaultAddonStatus(entry, kind), detail: null };
  }

  let status = runtime.status;
  if (
    status === 'ready'
    && Number.isFinite(runtime.updatedAt)
    && Number.isFinite(runtime.staleAfterMs)
    && (runtime.staleAfterMs as number) > 0
    && nowMs - (runtime.updatedAt as number) > (runtime.staleAfterMs as number)
  ) {
    status = 'stale';
  }
  return { status, detail: boundedLabel(runtime.detail, 240) || null };
}

const DATA_STATE_TO_CATALOG_STATUS: Record<OfficeAddonDataState, OfficeAddonStatus> = {
  local: 'local',
  demo: 'demo',
  setup: 'setup_required',
  live: 'ready',
  stale: 'stale',
  error: 'error',
};

/**
 * Adapt the canonical per-item truth resolver to the catalog's filter labels.
 * This is the only data-state mapping used by Office UI callers, which keeps
 * a missing timestamp or stale live read consistent with the floor badge.
 */
export function getOfficeAddonCatalogRuntimeState(
  item: Pick<FurnitureItem, 'type' | 'dataState' | 'dataUpdatedAt'>,
  options: { nowMs?: number; staleAfterMs?: number } = {},
): OfficeAddonCatalogRuntimeState {
  const definition = getOfficeAddonDefinition(item.type);
  const runtime = getOfficeAddonRuntimeState(item, options);
  return {
    status: definition?.readiness === 'decorative'
      ? 'decorative'
      : DATA_STATE_TO_CATALOG_STATUS[runtime.state],
    detail: runtime.label,
    updatedAt: runtime.dataUpdatedAt,
    staleAfterMs: options.staleAfterMs,
  };
}

const CATALOG_STATUS_PRIORITY: Record<OfficeAddonStatus, number> = {
  decorative: 0,
  ready: 1,
  local: 2,
  demo: 3,
  setup_required: 4,
  stale: 5,
  connecting: 6,
  error: 7,
};

/** Aggregate placed instances by type, preferring the state that needs the
 * most attention when duplicate widgets have different runtime evidence. */
export function buildOfficeAddonCatalogRuntimeByType(
  items: readonly Pick<FurnitureItem, 'type' | 'dataState' | 'dataUpdatedAt'>[],
  options: { nowMs?: number; staleAfterMs?: number } = {},
): Partial<Record<FurnitureType, OfficeAddonCatalogRuntimeState>> {
  const result: Partial<Record<FurnitureType, OfficeAddonCatalogRuntimeState>> = {};
  for (const item of items) {
    const candidate = getOfficeAddonCatalogRuntimeState(item, options);
    const current = result[item.type];
    if (!current || CATALOG_STATUS_PRIORITY[candidate.status] > CATALOG_STATUS_PRIORITY[current.status]) {
      result[item.type] = candidate;
    }
  }
  return result;
}

function scoreCatalogMatch(entry: FurnitureCatalogEntry, metadata: OfficeAddonCatalogMetadata | undefined, query: string): number {
  if (!query) return 0;
  const name = normalizeSearchText(entry.name, 160);
  const type = normalizeSearchText(entry.type, 160);
  const category = normalizeSearchText(entry.category, 80);
  const description = normalizeSearchText(entry.description, 400);
  const tags = [...new Set([...(entry.tags || []), ...(metadata?.tags || [])])]
    .slice(0, OFFICE_ADDON_QUERY_LIMITS.tagsPerItem)
    .map((tag) => normalizeSearchText(tag, OFFICE_ADDON_QUERY_LIMITS.tagCharacters))
    .filter(Boolean)
    .join(' ');
  const action = normalizeSearchText(metadata?.primaryAction || entry.primaryAction, 120);
  const haystack = `${name} ${type} ${category} ${description} ${tags} ${action}`;
  const tokens = query.split(' ').filter(Boolean);
  if (!tokens.every((token) => haystack.includes(token))) return -1;

  let score = 0;
  if (name === query) score += 200;
  else if (name.startsWith(query)) score += 120;
  else if (name.includes(query)) score += 80;
  for (const token of tokens) {
    if (name.startsWith(token)) score += 30;
    else if (name.includes(token)) score += 20;
    if (type.includes(token)) score += 15;
    if (tags.includes(token)) score += 12;
    if (description.includes(token)) score += 5;
    if (action.includes(token)) score += 5;
  }
  return score;
}

/**
 * Build a stable, non-mutating catalog view. Search relevance is followed by
 * favorites, recent-use order, and finally canonical catalog order.
 */
export function queryOfficeAddonCatalog(
  catalogInput: readonly FurnitureCatalogEntry[],
  query: OfficeAddonCatalogQuery = {},
): OfficeAddonCatalogViewItem[] {
  const catalog = catalogInput.slice(0, OFFICE_ADDON_QUERY_LIMITS.catalogEntries);
  const search = normalizeSearchText(query.searchText);
  const categoryFilter = new Set(query.categories || []);
  const kindFilter = new Set(query.kinds || []);
  const statusFilter = new Set(query.statuses || []);
  const favorites = typeSet(query.favoriteTypes);
  const interactiveTypes = typeSet(query.interactiveTypes);
  const recentRank = new Map<FurnitureType, number>();
  (query.recentTypes || []).forEach((type, index) => {
    if (!recentRank.has(type)) recentRank.set(type, index);
  });
  const nowMs = Number.isFinite(query.nowMs) ? (query.nowMs as number) : Date.now();
  const requestedLimit = Number.isFinite(query.limit) ? Math.floor(query.limit as number) : catalog.length;
  const limit = Math.max(0, Math.min(OFFICE_ADDON_QUERY_LIMITS.catalogEntries, requestedLimit));

  return catalog
    .map((entry, catalogIndex) => {
      const metadata = query.metadataByType?.[entry.type];
      const kind = resolveAddonKind(entry, metadata, interactiveTypes);
      const runtime = resolveAddonStatus(entry, kind, query.runtimeByType?.[entry.type], nowMs);
      const score = scoreCatalogMatch(entry, metadata, search);
      const primaryAction = boundedLabel(metadata?.primaryAction || entry.primaryAction, 120);
      return {
        item: {
          entry,
          kind,
          status: runtime.status,
          statusDetail: runtime.detail,
          primaryAction: primaryAction && primaryAction !== 'none' ? primaryAction : null,
          favorite: favorites.has(entry.type),
          recentRank: recentRank.get(entry.type) ?? null,
          searchScore: score,
        } satisfies OfficeAddonCatalogViewItem,
        catalogIndex,
      };
    })
    .filter(({ item }) => item.searchScore >= 0)
    .filter(({ item }) => categoryFilter.size === 0 || categoryFilter.has(item.entry.category))
    .filter(({ item }) => kindFilter.size === 0 || kindFilter.has(item.kind))
    .filter(({ item }) => statusFilter.size === 0 || statusFilter.has(item.status))
    .filter(({ item }) => !query.onlyFavorites || item.favorite)
    .sort((a, b) => {
      if (search && b.item.searchScore !== a.item.searchScore) return b.item.searchScore - a.item.searchScore;
      if (a.item.favorite !== b.item.favorite) return a.item.favorite ? -1 : 1;
      const aRecent = a.item.recentRank ?? Number.POSITIVE_INFINITY;
      const bRecent = b.item.recentRank ?? Number.POSITIVE_INFINITY;
      if (aRecent !== bRecent) return aRecent - bRecent;
      return a.catalogIndex - b.catalogIndex;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}

export function summarizeOfficeAddonStatuses(items: readonly OfficeAddonCatalogViewItem[]): OfficeAddonStatusSummary {
  const summary: OfficeAddonStatusSummary = {
    total: 0,
    favorites: 0,
    recentlyUsed: 0,
    byKind: { decorative: 0, interactive: 0, connected: 0 },
    byStatus: { ...EMPTY_STATUS_COUNTS },
  };
  for (const item of items) {
    summary.total += 1;
    summary.byKind[item.kind] += 1;
    summary.byStatus[item.status] += 1;
    if (item.favorite) summary.favorites += 1;
    if (item.recentRank !== null) summary.recentlyUsed += 1;
  }
  return summary;
}

/**
 * Restore editor-owned layout fields while retaining the newest non-layout
 * state for an item. `latestItems` may include bounded tombstones for items
 * temporarily removed by Undo so Redo does not resurrect stale configuration.
 */
export function mergeOfficeEditorFurnitureState(
  snapshotItems: readonly FurnitureItem[],
  latestItems: readonly FurnitureItem[],
): FurnitureItem[] {
  const latestById = new Map(latestItems.map((item) => [item.id, item]));
  return snapshotItems.map((snapshotItem) => {
    const latest = latestById.get(snapshotItem.id);
    if (!latest || latest.type !== snapshotItem.type) return { ...snapshotItem };
    return {
      ...snapshotItem,
      ...latest,
      id: snapshotItem.id,
      type: snapshotItem.type,
      x: snapshotItem.x,
      y: snapshotItem.y,
      itemWidth: snapshotItem.itemWidth,
      itemHeight: snapshotItem.itemHeight,
      rotation: snapshotItem.rotation,
    };
  });
}

// ─── Reversible Office editor history ──────────────────────────────────────

export const OFFICE_EDITOR_HISTORY_LIMITS = Object.freeze({
  defaultEntries: 30,
  minEntries: 2,
  maxEntries: 60,
  furniturePerFloor: 100,
  agentIdsPerFloor: 100,
  serializedBytes: 512_000,
  labelCharacters: 80,
});

export interface OfficeEditorHistoryEntry {
  label: string;
  floor: OfficeFloor;
}

export interface OfficeEditorHistory {
  past: OfficeEditorHistoryEntry[];
  present: OfficeEditorHistoryEntry;
  future: OfficeEditorHistoryEntry[];
  limit: number;
  sequence: number;
}

function encodeOfficeFloor(input: unknown): { encoded: string; floor: OfficeFloor } | null {
  try {
    const encoded = JSON.stringify(input);
    if (!encoded || encoded.length > OFFICE_EDITOR_HISTORY_LIMITS.serializedBytes) return null;
    const floor = JSON.parse(encoded) as Partial<OfficeFloor>;
    if (
      !floor
      || typeof floor !== 'object'
      || typeof floor.id !== 'string'
      || !floor.id
      || typeof floor.name !== 'string'
      || typeof floor.themeId !== 'string'
      || typeof floor.order !== 'number'
      || !Number.isFinite(floor.order)
      || !Array.isArray(floor.agentIds)
      || floor.agentIds.length > OFFICE_EDITOR_HISTORY_LIMITS.agentIdsPerFloor
      || floor.agentIds.some((id) => typeof id !== 'string')
      || !Array.isArray(floor.furniture)
      || floor.furniture.length > OFFICE_EDITOR_HISTORY_LIMITS.furniturePerFloor
    ) return null;
    for (const item of floor.furniture) {
      if (
        !item
        || typeof item !== 'object'
        || typeof item.id !== 'string'
        || !item.id
        || typeof item.type !== 'string'
        || typeof item.x !== 'number'
        || !Number.isFinite(item.x)
        || typeof item.y !== 'number'
        || !Number.isFinite(item.y)
      ) return null;
    }
    return { encoded, floor: floor as OfficeFloor };
  } catch {
    return null;
  }
}

export function cloneOfficeFloorSnapshot(input: unknown): OfficeFloor | null {
  return encodeOfficeFloor(input)?.floor || null;
}

function normalizeHistoryLimit(value: unknown): number {
  if (!Number.isFinite(value)) return OFFICE_EDITOR_HISTORY_LIMITS.defaultEntries;
  return Math.max(
    OFFICE_EDITOR_HISTORY_LIMITS.minEntries,
    Math.min(OFFICE_EDITOR_HISTORY_LIMITS.maxEntries, Math.floor(value as number)),
  );
}

function historyEntry(floor: OfficeFloor, label: unknown): OfficeEditorHistoryEntry | null {
  const snapshot = cloneOfficeFloorSnapshot(floor);
  if (!snapshot) return null;
  return {
    label: boundedLabel(label, OFFICE_EDITOR_HISTORY_LIMITS.labelCharacters) || 'Edit floor',
    floor: snapshot,
  };
}

export function createOfficeEditorHistory(
  initialFloor: OfficeFloor,
  options: { limit?: number; label?: string } = {},
): OfficeEditorHistory | null {
  const present = historyEntry(initialFloor, options.label || 'Initial floor');
  if (!present) return null;
  return {
    past: [],
    present,
    future: [],
    limit: normalizeHistoryLimit(options.limit),
    sequence: 0,
  };
}

/** Commit a detached snapshot, truncate old history, and clear the redo branch. */
export function commitOfficeEditorSnapshot(
  history: OfficeEditorHistory,
  nextFloor: OfficeFloor,
  label: string,
): OfficeEditorHistory | null {
  const next = historyEntry(nextFloor, label);
  if (!next) return null;
  const presentEncoded = encodeOfficeFloor(history.present.floor)?.encoded;
  const nextEncoded = encodeOfficeFloor(next.floor)?.encoded;
  if (!presentEncoded || !nextEncoded) return null;
  if (presentEncoded === nextEncoded) return history;
  const limit = normalizeHistoryLimit(history.limit);
  return {
    past: [...history.past, history.present].slice(-limit),
    present: next,
    future: [],
    limit,
    sequence: Math.max(0, Math.floor(history.sequence || 0)) + 1,
  };
}

export function undoOfficeEditorHistory(history: OfficeEditorHistory): OfficeEditorHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const limit = normalizeHistoryLimit(history.limit);
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, limit),
    limit,
    sequence: Math.max(0, Math.floor(history.sequence || 0)) + 1,
  };
}

export function redoOfficeEditorHistory(history: OfficeEditorHistory): OfficeEditorHistory {
  if (history.future.length === 0) return history;
  const [next, ...remaining] = history.future;
  const limit = normalizeHistoryLimit(history.limit);
  return {
    past: [...history.past, history.present].slice(-limit),
    present: next,
    future: remaining,
    limit,
    sequence: Math.max(0, Math.floor(history.sequence || 0)) + 1,
  };
}

export function getOfficeEditorHistoryAvailability(history: OfficeEditorHistory): {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
} {
  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoLabel: history.past.length > 0 ? history.present.label : null,
    redoLabel: history.future[0]?.label || null,
  };
}

// ─── Built-in room kits ────────────────────────────────────────────────────

export type OfficeRoomKitId = 'agent_ops' | 'focus_lab' | 'launch_room' | 'review_room' | 'social_lounge';

export interface OfficeRoomKitItem {
  type: FurnitureType;
  offsetX: number;
  offsetY: number;
  label?: string;
  rotation?: number;
}

export interface OfficeRoomKitTemplate {
  id: OfficeRoomKitId;
  name: string;
  description: string;
  items: readonly OfficeRoomKitItem[];
}

function defineRoomKit(template: OfficeRoomKitTemplate): OfficeRoomKitTemplate {
  return Object.freeze({
    ...template,
    items: Object.freeze(template.items.map((item) => Object.freeze({ ...item }))),
  });
}

export const OFFICE_ROOM_KITS: readonly OfficeRoomKitTemplate[] = Object.freeze([
  defineRoomKit({
    id: 'agent_ops',
    name: 'Agent Ops',
    description: 'Live agent status, commands, repository activity, time, and runtime infrastructure.',
    items: [
      { type: 'status_board', offsetX: 0, offsetY: 0, label: 'Agent status' },
      { type: 'command_console', offsetX: 128, offsetY: 0, label: 'Agent commands' },
      { type: 'github_feed', offsetX: 240, offsetY: 0, label: 'Repository activity' },
      { type: 'server', offsetX: 352, offsetY: 8, label: 'Runtime bridge' },
      { type: 'world_clock', offsetX: 0, offsetY: 96, label: 'Team timezones' },
      { type: 'calendar_widget', offsetX: 128, offsetY: 88, label: 'Team schedule' },
    ],
  }),
  defineRoomKit({
    id: 'focus_lab',
    name: 'Focus Lab',
    description: 'A quiet workstation with a focus timer, progress signal, and low-motion ambience.',
    items: [
      { type: 'rug', offsetX: 0, offsetY: 0 },
      { type: 'standingdesk', offsetX: 16, offsetY: 64, label: 'Focus desk' },
      { type: 'pomodoro_room', offsetX: 128, offsetY: 64, label: 'Focus timer' },
      { type: 'progress_bar', offsetX: 224, offsetY: 72, label: 'Session progress' },
      { type: 'focus_candle', offsetX: 352, offsetY: 72 },
      { type: 'plant', offsetX: 400, offsetY: 72 },
    ],
  }),
  defineRoomKit({
    id: 'launch_room',
    name: 'Launch Room',
    description: 'A guarded command area for launch actions, readiness, progress, and celebration.',
    items: [
      { type: 'scoreboard', offsetX: 0, offsetY: 0, label: 'Launch readiness' },
      { type: 'github_feed', offsetX: 128, offsetY: 0, label: 'Release activity' },
      { type: 'launch_pad', offsetX: 240, offsetY: 0, label: 'Launch tasks' },
      { type: 'button_panel', offsetX: 336, offsetY: 8, label: 'Launch checklist' },
      { type: 'alarm_bell', offsetX: 448, offsetY: 8, label: 'Attention' },
      { type: 'confetti_cannon', offsetX: 512, offsetY: 8, label: 'Celebrate' },
    ],
  }),
  defineRoomKit({
    id: 'review_room',
    name: 'Review Room',
    description: 'Shared visual review space for plans, designs, demos, and team discussion.',
    items: [
      { type: 'whiteboard', offsetX: 0, offsetY: 0, label: 'Review notes' },
      { type: 'figma_board', offsetX: 144, offsetY: 0, label: 'Design review' },
      { type: 'smart_tv', offsetX: 272, offsetY: 0, label: 'Demo screen' },
      { type: 'couch', offsetX: 80, offsetY: 112 },
      { type: 'beanbag', offsetX: 176, offsetY: 112 },
      { type: 'plant', offsetX: 240, offsetY: 112 },
    ],
  }),
  defineRoomKit({
    id: 'social_lounge',
    name: 'Social Lounge',
    description: 'A relaxed team area with seating, refreshments, music, games, and ambient life.',
    items: [
      { type: 'couch', offsetX: 0, offsetY: 0 },
      { type: 'beanbag', offsetX: 96, offsetY: 8 },
      { type: 'coffee', offsetX: 144, offsetY: 8 },
      { type: 'jukebox', offsetX: 192, offsetY: 0 },
      { type: 'aquarium', offsetX: 272, offsetY: 8 },
      { type: 'arcade', offsetX: 384, offsetY: 8 },
      { type: 'plant', offsetX: 432, offsetY: 8 },
    ],
  }),
]);

export interface OfficeFloorBounds {
  width: number;
  height: number;
  padding?: number;
  gridSize?: number;
}

export interface ApplyOfficeRoomKitInput {
  floor: OfficeFloor;
  kit: OfficeRoomKitId | OfficeRoomKitTemplate;
  catalog: readonly FurnitureCatalogEntry[];
  idSeed: string;
  origin?: { x: number; y: number };
  bounds: OfficeFloorBounds;
  maxFurniture?: number;
  /** Optional lower scan bound for previews/tests; always capped by the runtime maximum. */
  scanLimit?: number;
}

export interface OfficeRoomKitApplication {
  floor: OfficeFloor;
  kit: OfficeRoomKitTemplate;
  addedItemIds: string[];
  origin: { x: number; y: number };
  clamped: boolean;
}

export const OFFICE_ROOM_KIT_PLACEMENT_LIMITS = Object.freeze({
  maxKitItems: 24,
  maxScanPositions: 4_096,
  maxCoordinate: 100_000,
  maxGridSize: 512,
  maxFurniture: 500,
});

export type OfficeRoomKitPlacementFailureReason =
  | 'capacity'
  | 'invalid_template'
  | 'invalid_floor'
  | 'invalid_bounds'
  | 'invalid_seed'
  | 'no_free_region'
  | 'scan_limit';

export interface OfficeRoomKitPlacementSuccess {
  ok: true;
  application: OfficeRoomKitApplication;
  /** Number of unique candidate origins checked before finding this placement. */
  scannedPositions: number;
  /** True only when the exact requested coordinates required no snap or bounds adjustment. */
  usedRequestedOrigin: boolean;
}

export interface OfficeRoomKitPlacementFailure {
  ok: false;
  reason: OfficeRoomKitPlacementFailureReason;
  detail: string;
  scannedPositions: number;
}

export type OfficeRoomKitPlacementPlan =
  | OfficeRoomKitPlacementSuccess
  | OfficeRoomKitPlacementFailure;

export function getOfficeRoomKit(id: OfficeRoomKitId): OfficeRoomKitTemplate | null {
  return OFFICE_ROOM_KITS.find((kit) => kit.id === id) || null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function snapped(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function freshKitItemId(base: string, used: Set<string>): string {
  let candidate = base.slice(0, 200);
  let suffix = 1;
  while (used.has(candidate)) {
    const marker = `_${suffix}`;
    candidate = `${base.slice(0, 200 - marker.length)}${marker}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

interface OfficePlacementRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NormalizedRoomKitItem {
  template: OfficeRoomKitItem;
  relativeX: number;
  relativeY: number;
  width: number;
  height: number;
  collisionOffsetX: number;
  collisionOffsetY: number;
  collisionWidth: number;
  collisionHeight: number;
}

interface GridAxis {
  count: number;
  valueAt: (index: number) => number;
}

function roomKitFailure(
  reason: OfficeRoomKitPlacementFailureReason,
  detail: string,
  scannedPositions = 0,
): OfficeRoomKitPlacementFailure {
  return { ok: false, reason, detail, scannedPositions };
}

function rectanglesOverlap(a: OfficePlacementRectangle, b: OfficePlacementRectangle): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function rotationCollisionBounds(
  width: number,
  height: number,
  rotation: number | undefined,
): { offsetX: number; offsetY: number; width: number; height: number } {
  const normalizedRotation = Number.isFinite(rotation)
    ? ((((rotation as number) % 360) + 360) % 360)
    : 0;
  if (normalizedRotation === 0 || normalizedRotation === 180) {
    return { offsetX: 0, offsetY: 0, width, height };
  }
  const radians = normalizedRotation * (Math.PI / 180);
  const cosine = Math.abs(Math.cos(radians)) < 1e-10 ? 0 : Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians)) < 1e-10 ? 0 : Math.abs(Math.sin(radians));
  const collisionWidth = (width * cosine) + (height * sine);
  const collisionHeight = (width * sine) + (height * cosine);
  return {
    offsetX: (width - collisionWidth) / 2,
    offsetY: (height - collisionHeight) / 2,
    width: collisionWidth,
    height: collisionHeight,
  };
}

function hasInternalCollision(items: readonly NormalizedRoomKitItem[]): boolean {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const rectangle: OfficePlacementRectangle = {
      x: item.relativeX + item.collisionOffsetX,
      y: item.relativeY + item.collisionOffsetY,
      width: item.collisionWidth,
      height: item.collisionHeight,
    };
    for (let comparison = index + 1; comparison < items.length; comparison += 1) {
      const other = items[comparison];
      if (rectanglesOverlap(rectangle, {
        x: other.relativeX + other.collisionOffsetX,
        y: other.relativeY + other.collisionOffsetY,
        width: other.collisionWidth,
        height: other.collisionHeight,
      })) return true;
    }
  }
  return false;
}

/**
 * A lazy, sorted axis keeps the search memory-bounded even for a very large
 * floor. Non-grid-aligned edges remain candidates so a tight but valid floor
 * can still accept a kit without silently moving it outside its bounds.
 */
function createGridAxis(min: number, max: number, gridSize: number): GridAxis | null {
  if (max < min) return null;
  const firstGridValue = Math.ceil(min / gridSize) * gridSize;
  const lastGridValue = Math.floor(max / gridSize) * gridSize;
  const gridCount = firstGridValue <= lastGridValue
    ? Math.floor((lastGridValue - firstGridValue) / gridSize) + 1
    : 0;
  const includesMin = gridCount > 0 && firstGridValue === min;
  const includesMax = gridCount > 0 && lastGridValue === max;
  const count = gridCount + (includesMin ? 0 : 1) + (includesMax || max === min ? 0 : 1);
  return {
    count,
    valueAt: (index: number) => {
      if (!includesMin) {
        if (index === 0) return min;
        index -= 1;
      }
      if (index < gridCount) return firstGridValue + (index * gridSize);
      return max;
    },
  };
}

function nearestGridAxisValue(value: number, min: number, max: number, gridSize: number): number {
  const onceClamped = clamp(snapped(value, gridSize), min, max);
  return clamp(snapped(onceClamped, gridSize), min, max);
}

function normalizedFurnitureSize(
  item: FurnitureItem,
  catalogByType: ReadonlyMap<FurnitureType, FurnitureCatalogEntry>,
): { width: number; height: number } | null {
  const entry = catalogByType.get(item.type);
  if (!entry) return null;
  const width = item.itemWidth === undefined ? entry.width : item.itemWidth;
  const height = item.itemHeight === undefined ? entry.height : item.itemHeight;
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
    || height > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
  ) return null;
  return { width, height };
}

/**
 * Produce a complete, detached room-kit preview without mutating the floor,
 * template, or catalog. The requested origin is tried first, followed by a
 * deterministic row-major grid scan. A scan-limit result is distinct from
 * `no_free_region`, so a bounded search never claims exhaustive failure when
 * unexplored candidates remain.
 */
export function planOfficeRoomKit(input: ApplyOfficeRoomKitInput): OfficeRoomKitPlacementPlan {
  const floor = cloneOfficeFloorSnapshot(input.floor);
  if (!floor) return roomKitFailure('invalid_floor', 'The floor snapshot is malformed or exceeds editor limits.');

  const seed = boundedLabel(input.idSeed, 80).replace(/[^A-Za-z0-9_-]/g, '_');
  if (!seed) return roomKitFailure('invalid_seed', 'A deterministic room-kit id seed is required.');

  const width = Number.isFinite(input.bounds?.width) ? Math.floor(input.bounds.width) : 0;
  const height = Number.isFinite(input.bounds?.height) ? Math.floor(input.bounds.height) : 0;
  const padding = Number.isFinite(input.bounds?.padding)
    ? Math.max(0, Math.floor(input.bounds.padding as number))
    : 0;
  const gridSize = Number.isFinite(input.bounds?.gridSize)
    ? Math.max(1, Math.min(
      OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxGridSize,
      Math.floor(input.bounds.gridSize as number),
    ))
    : 1;
  if (
    width <= padding * 2
    || height <= padding * 2
    || width > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
    || height > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
  ) {
    return roomKitFailure('invalid_bounds', 'Floor bounds must contain a finite padded placement region.');
  }

  const kit = typeof input.kit === 'string' ? getOfficeRoomKit(input.kit) : input.kit;
  if (
    !kit
    || typeof kit !== 'object'
    || !getOfficeRoomKit(kit.id)
    || !Array.isArray(kit.items)
    || kit.items.length === 0
    || kit.items.length > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxKitItems
  ) {
    return roomKitFailure('invalid_template', 'The room-kit template is unknown, empty, or too large.');
  }
  if (!Array.isArray(input.catalog)) {
    return roomKitFailure('invalid_template', 'A canonical furniture catalog is required to size the room kit.');
  }

  const catalogByType = new Map<FurnitureType, FurnitureCatalogEntry>();
  input.catalog.slice(0, OFFICE_ADDON_QUERY_LIMITS.catalogEntries).forEach((entry) => {
    if (isOfficeAddonType(entry?.type) && !catalogByType.has(entry.type)) catalogByType.set(entry.type, entry);
  });

  const normalizedItems: NormalizedRoomKitItem[] = [];
  for (const template of kit.items) {
    if (
      !template
      || typeof template !== 'object'
      || !isOfficeAddonType(template.type)
      || !Number.isFinite(template.offsetX)
      || !Number.isFinite(template.offsetY)
      || template.offsetX < 0
      || template.offsetY < 0
      || template.offsetX > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
      || template.offsetY > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
      || (template.rotation !== undefined && !Number.isFinite(template.rotation))
    ) {
      return roomKitFailure('invalid_template', 'Every room-kit item needs a canonical type and finite non-negative offsets.');
    }
    const entry = catalogByType.get(template.type);
    const itemWidth = entry ? Math.floor(entry.width) : 0;
    const itemHeight = entry ? Math.floor(entry.height) : 0;
    if (
      !entry
      || !Number.isFinite(entry.width)
      || !Number.isFinite(entry.height)
      || itemWidth <= 0
      || itemHeight <= 0
      || entry.width > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
      || entry.height > OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxCoordinate
    ) {
      return roomKitFailure('invalid_template', `The ${template.type} template item has no valid catalog dimensions.`);
    }
    const collision = rotationCollisionBounds(itemWidth, itemHeight, template.rotation);
    normalizedItems.push({
      template,
      relativeX: snapped(template.offsetX, gridSize),
      relativeY: snapped(template.offsetY, gridSize),
      width: itemWidth,
      height: itemHeight,
      collisionOffsetX: collision.offsetX,
      collisionOffsetY: collision.offsetY,
      collisionWidth: collision.width,
      collisionHeight: collision.height,
    });
  }
  if (hasInternalCollision(normalizedItems)) {
    return roomKitFailure('invalid_template', 'Room-kit items overlap each other after grid snapping.');
  }

  const maxFurniture = Number.isFinite(input.maxFurniture)
    ? Math.max(1, Math.min(
      OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxFurniture,
      Math.floor(input.maxFurniture as number),
    ))
    : OFFICE_EDITOR_HISTORY_LIMITS.furniturePerFloor;
  if (floor.furniture.length + normalizedItems.length > maxFurniture) {
    return roomKitFailure('capacity', 'The floor does not have capacity for every room-kit item.');
  }

  const existingRectangles: OfficePlacementRectangle[] = [];
  for (const item of floor.furniture) {
    if (!isOfficeAddonType(item.type)) {
      return roomKitFailure('invalid_floor', 'The floor contains an unknown furniture type.');
    }
    const size = normalizedFurnitureSize(item, catalogByType);
    if (!size) return roomKitFailure('invalid_floor', `The ${item.type} floor item has invalid dimensions.`);
    if (item.rotation !== undefined && !Number.isFinite(item.rotation)) {
      return roomKitFailure('invalid_floor', `The ${item.type} floor item has an invalid rotation.`);
    }
    const collision = rotationCollisionBounds(size.width, size.height, item.rotation);
    existingRectangles.push({
      x: item.x + collision.offsetX,
      y: item.y + collision.offsetY,
      width: collision.width,
      height: collision.height,
    });
  }

  const footprintMinX = normalizedItems.reduce(
    (min, item) => Math.min(
      min,
      item.relativeX,
      item.relativeX + item.collisionOffsetX,
    ),
    Number.POSITIVE_INFINITY,
  );
  const footprintMaxX = normalizedItems.reduce(
    (max, item) => Math.max(
      max,
      item.relativeX + item.width,
      item.relativeX + item.collisionOffsetX + item.collisionWidth,
    ),
    Number.NEGATIVE_INFINITY,
  );
  const footprintMinY = normalizedItems.reduce(
    (min, item) => Math.min(
      min,
      item.relativeY,
      item.relativeY + item.collisionOffsetY,
    ),
    Number.POSITIVE_INFINITY,
  );
  const footprintMaxY = normalizedItems.reduce(
    (max, item) => Math.max(
      max,
      item.relativeY + item.height,
      item.relativeY + item.collisionOffsetY + item.collisionHeight,
    ),
    Number.NEGATIVE_INFINITY,
  );
  const minOriginX = padding - footprintMinX;
  const minOriginY = padding - footprintMinY;
  const maxOriginX = width - padding - footprintMaxX;
  const maxOriginY = height - padding - footprintMaxY;
  const xAxis = createGridAxis(minOriginX, maxOriginX, gridSize);
  const yAxis = createGridAxis(minOriginY, maxOriginY, gridSize);
  if (!xAxis || !yAxis) {
    return roomKitFailure('no_free_region', 'The room kit is larger than the padded floor region.');
  }

  const requestedOrigin = {
    x: Number.isFinite(input.origin?.x) ? (input.origin?.x as number) : padding,
    y: Number.isFinite(input.origin?.y) ? (input.origin?.y as number) : padding,
  };
  const preferredOrigin = {
    x: nearestGridAxisValue(requestedOrigin.x, minOriginX, maxOriginX, gridSize),
    y: nearestGridAxisValue(requestedOrigin.y, minOriginY, maxOriginY, gridSize),
  };
  const scanLimit = Number.isFinite(input.scanLimit)
    ? Math.max(1, Math.min(
      OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxScanPositions,
      Math.floor(input.scanLimit as number),
    ))
    : OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxScanPositions;
  const visited = new Set<string>();
  let scannedPositions = 0;
  let selectedOrigin: { x: number; y: number } | null = null;

  const originIsFree = (origin: { x: number; y: number }): boolean => {
    const key = `${origin.x}:${origin.y}`;
    if (visited.has(key) || scannedPositions >= scanLimit) return false;
    visited.add(key);
    scannedPositions += 1;
    const blocked = normalizedItems.some((item) => {
      const candidate: OfficePlacementRectangle = {
        x: origin.x + item.relativeX + item.collisionOffsetX,
        y: origin.y + item.relativeY + item.collisionOffsetY,
        width: item.collisionWidth,
        height: item.collisionHeight,
      };
      return existingRectangles.some((existing) => rectanglesOverlap(candidate, existing));
    });
    return !blocked;
  };

  if (originIsFree(preferredOrigin)) selectedOrigin = preferredOrigin;
  outer: for (let yIndex = 0; !selectedOrigin && yIndex < yAxis.count; yIndex += 1) {
    for (let xIndex = 0; xIndex < xAxis.count; xIndex += 1) {
      if (scannedPositions >= scanLimit) break outer;
      const candidateOrigin = { x: xAxis.valueAt(xIndex), y: yAxis.valueAt(yIndex) };
      if (originIsFree(candidateOrigin)) {
        selectedOrigin = candidateOrigin;
        break outer;
      }
    }
  }

  if (!selectedOrigin) {
    const totalCandidates = xAxis.count * yAxis.count;
    if (visited.size < totalCandidates) {
      return roomKitFailure(
        'scan_limit',
        'The bounded placement scan ended before every candidate region could be checked.',
        scannedPositions,
      );
    }
    return roomKitFailure(
      'no_free_region',
      'No collision-free region can hold the complete room kit.',
      scannedPositions,
    );
  }

  const usedIds = new Set(floor.furniture.map((item) => item.id));
  const addedItemIds: string[] = [];
  const added: FurnitureItem[] = normalizedItems.map((item, index) => {
    const base = `kit_${seed}_${kit.id}_${index}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const id = freshKitItemId(base, usedIds);
    addedItemIds.push(id);
    return {
      id,
      type: item.template.type,
      x: selectedOrigin!.x + item.relativeX,
      y: selectedOrigin!.y + item.relativeY,
      itemWidth: item.width,
      itemHeight: item.height,
      ...(item.template.label ? { label: boundedLabel(item.template.label, 120) } : {}),
      ...(Number.isFinite(item.template.rotation) ? { rotation: item.template.rotation } : {}),
    };
  });
  const offsetSnapped = normalizedItems.some((item) => (
    item.relativeX !== item.template.offsetX || item.relativeY !== item.template.offsetY
  ));
  const application: OfficeRoomKitApplication = {
    floor: { ...floor, furniture: [...floor.furniture, ...added] },
    kit,
    addedItemIds,
    origin: selectedOrigin,
    clamped: offsetSnapped
      || selectedOrigin.x !== requestedOrigin.x
      || selectedOrigin.y !== requestedOrigin.y,
  };
  const usedRequestedOrigin = selectedOrigin.x === requestedOrigin.x
    && selectedOrigin.y === requestedOrigin.y;
  return {
    ok: true,
    application,
    scannedPositions,
    usedRequestedOrigin,
  };
}

/**
 * Compatibility wrapper for callers that only consume success/null. New UI
 * previews should call `planOfficeRoomKit` to surface the typed failure reason
 * before applying the returned detached floor.
 */
export function applyOfficeRoomKit(input: ApplyOfficeRoomKitInput): OfficeRoomKitApplication | null {
  const plan = planOfficeRoomKit(input);
  return plan.ok ? plan.application : null;
}
