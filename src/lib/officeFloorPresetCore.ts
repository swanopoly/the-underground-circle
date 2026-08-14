/**
 * Pure trust boundary for complete Office-floor presets.
 *
 * A preset intentionally captures the whole user-authored floor configuration:
 * theme, assigned agent ids, furniture/tools, labels, integrations, and the
 * JSON-safe interactive state stored on each furniture row. Applying a preset
 * preserves the destination floor's durable identity/name/order and assigns
 * fresh furniture ids so the same preset can safely be used on several floors.
 */

import type { FurnitureItem, OfficeFloor } from './officeConfig';
import { validateOfficeLayout } from './officeValidation';

export const OFFICE_FLOOR_PRESET_LIMITS = Object.freeze({
  name: 80,
  description: 240,
  floorName: 120,
  themeId: 120,
  agentId: 200,
  agents: 30,
  furniture: 100,
  serializedBytes: 256_000,
});

export interface OfficeFloorPresetSnapshot {
  schemaVersion: 1;
  floor: {
    name: string;
    themeId: string;
    agentIds: string[];
    furniture: FurnitureItem[];
  };
}

export interface OfficeFloorPresetRecord {
  id: string;
  circleId: string;
  userId: string;
  name: string;
  description: string | null;
  snapshot: OfficeFloorPresetSnapshot;
  createdAt: string;
  updatedAt: string;
}

/**
 * Reconcile only automatically managed floor rosters. A preset-applied or
 * explicitly assigned manual floor is immutable here, and its live agent ids
 * are removed from the pool before remaining agents are distributed.
 */
export function reconcileAutomaticOfficeFloorAssignments(
  floors: OfficeFloor[],
  orderedAgentIds: string[],
  capacity: number,
): OfficeFloor[] {
  if (!Array.isArray(floors) || floors.length === 0 || !Number.isSafeInteger(capacity) || capacity <= 0) {
    return floors;
  }
  const uniqueLiveIds = Array.from(new Set(orderedAgentIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const manualIds = new Set(floors
    .filter((floor) => floor.agentAssignmentMode === 'manual')
    .flatMap((floor) => floor.agentIds || []));
  const availableIds = uniqueLiveIds.filter((id) => !manualIds.has(id));
  const availableIdSet = new Set(availableIds);
  const automaticFloors = [...floors]
    .filter((floor) => floor.agentAssignmentMode !== 'manual')
    .sort((left, right) => left.order - right.order);
  const assignments = new Map<string, string[]>();
  const reservedIds = new Set<string>();

  // Preserve stable occupancy before considering the newest runtime ranking.
  // Status and last-active changes are allowed to reorder displayAgents, but
  // they are not user layout mutations and must not churn durable versions.
  automaticFloors.forEach((floor) => {
    const retainedIds: string[] = [];
    for (const id of floor.agentIds || []) {
      if (
        retainedIds.length >= capacity
        || !availableIdSet.has(id)
        || reservedIds.has(id)
      ) continue;
      retainedIds.push(id);
      reservedIds.add(id);
    }
    assignments.set(floor.id, retainedIds);
  });

  const unassignedIds = availableIds.filter((id) => !reservedIds.has(id));
  let nextUnassignedIndex = 0;
  automaticFloors.forEach((floor) => {
    const nextIds = assignments.get(floor.id) || [];
    while (nextIds.length < capacity && nextUnassignedIndex < unassignedIds.length) {
      nextIds.push(unassignedIds[nextUnassignedIndex]);
      nextUnassignedIndex += 1;
    }
  });
  let changed = false;
  const reconciled = floors.map((floor) => {
    if (floor.agentAssignmentMode === 'manual') return floor;
    const nextIds = assignments.get(floor.id) || [];
    const currentIds = floor.agentIds || [];
    if (
      floor.agentAssignmentMode === 'auto'
      && currentIds.length === nextIds.length
      && currentIds.every((id, index) => id === nextIds[index])
    ) return floor;
    changed = true;
    return { ...floor, agentAssignmentMode: 'auto' as const, agentIds: nextIds };
  });
  return changed ? reconciled : floors;
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function jsonClone(value: unknown): unknown | null {
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length > OFFICE_FLOOR_PRESET_LIMITS.serializedBytes) return null;
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readFurniture(value: unknown): FurnitureItem[] | null {
  if (!Array.isArray(value) || value.length > OFFICE_FLOOR_PRESET_LIMITS.furniture) return null;
  const cloned = jsonClone(value);
  if (!Array.isArray(cloned)) return null;
  const result: FurnitureItem[] = [];
  for (const raw of cloned) {
    if (!isRecord(raw)) return null;
    const id = boundedText(raw.id, 200);
    const type = boundedText(raw.type, 80);
    const x = typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : null;
    const y = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : null;
    if (!id || !type || x === null || y === null) return null;
    result.push(raw as unknown as FurnitureItem);
  }
  return result;
}

/** Build a bounded, detached snapshot from one current floor. */
export function buildOfficeFloorPresetSnapshot(input: unknown): OfficeFloorPresetSnapshot | null {
  if (!isRecord(input)) return null;
  const name = boundedText(input.name, OFFICE_FLOOR_PRESET_LIMITS.floorName) || 'Saved floor';
  const themeId = boundedText(input.themeId, OFFICE_FLOOR_PRESET_LIMITS.themeId) || 'underground';
  if (!Array.isArray(input.agentIds) || input.agentIds.length > OFFICE_FLOOR_PRESET_LIMITS.agents) return null;
  const agentIds = Array.from(new Set(input.agentIds
    .map((value) => boundedText(value, OFFICE_FLOOR_PRESET_LIMITS.agentId))
    .filter(Boolean)));
  const furniture = readFurniture(input.furniture);
  if (!furniture) return null;
  // Preset rows are untrusted server input when read back. Reuse the canonical
  // detached layout sanitizer before a tool URL, label, note, or media field
  // can enter live floor state. Structural SQL checks alone are not a content
  // authorization boundary.
  const validation = validateOfficeLayout({
    floors: [{
      id: 'preset_snapshot',
      name,
      themeId,
      order: 0,
      agentIds,
      furniture,
    }],
    currentFloorId: 'preset_snapshot',
    updatedAt: 1,
  });
  const sanitizedFloor = validation.valid && validation.sanitizedLayout?.floors?.[0];
  if (!sanitizedFloor || !Array.isArray(sanitizedFloor.furniture)) return null;
  const snapshot: OfficeFloorPresetSnapshot = {
    schemaVersion: 1,
    floor: {
      name: sanitizedFloor.name,
      themeId: sanitizedFloor.themeId,
      agentIds: sanitizedFloor.agentIds,
      furniture: sanitizedFloor.furniture,
    },
  };
  return jsonClone(snapshot) as OfficeFloorPresetSnapshot | null;
}

/** Parse an untrusted DB snapshot through the same bounds as local creation. */
export function readOfficeFloorPresetSnapshot(input: unknown): OfficeFloorPresetSnapshot | null {
  if (!isRecord(input) || input.schemaVersion !== 1 || !isRecord(input.floor)) return null;
  return buildOfficeFloorPresetSnapshot(input.floor);
}

/**
 * Replace a destination floor's configurable contents with a preset while
 * preserving the destination id/name/order. `idSeed` is caller-provided so
 * tests stay deterministic and runtime can use a monotonic timestamp.
 */
export function applyOfficeFloorPreset(
  presetInput: unknown,
  destinationInput: unknown,
  idSeed: string,
): OfficeFloor | null {
  const preset = readOfficeFloorPresetSnapshot(presetInput);
  if (!preset || !isRecord(destinationInput)) return null;
  const id = boundedText(destinationInput.id, 200);
  const name = boundedText(destinationInput.name, OFFICE_FLOOR_PRESET_LIMITS.floorName);
  const order = typeof destinationInput.order === 'number' && Number.isFinite(destinationInput.order)
    ? destinationInput.order
    : null;
  const seed = boundedText(idSeed, 80).replace(/[^A-Za-z0-9_-]/g, '_');
  if (!id || !name || order === null || !seed) return null;

  const furniture = preset.floor.furniture.map((item, index) => ({
    ...item,
    id: `preset_${seed}_${index}`.slice(0, 200),
  }));
  return {
    id,
    name,
    order,
    themeId: preset.floor.themeId,
    agentAssignmentMode: 'manual',
    agentIds: [...preset.floor.agentIds],
    furniture,
  };
}

export function normalizeOfficeFloorPresetName(value: unknown): string {
  return boundedText(value, OFFICE_FLOOR_PRESET_LIMITS.name);
}

export function normalizeOfficeFloorPresetDescription(value: unknown): string {
  return boundedText(value, OFFICE_FLOOR_PRESET_LIMITS.description);
}
