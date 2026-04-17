import { storage } from './storage';
import { detectAgenticCodingProfile, type AgenticCodingProfile, type AgenticCodingSurface } from './agenticCodingProfile';

export type SessionCodingProfile = AgenticCodingProfile | 'auto';
export type SessionDelegationMode = 'auto' | 'parallel' | 'focused';

// OpenSwan is framed as a service the user calls on — not a persona it
// pretends to be. Each mode is a different kind of work the service does.
export const SESSION_PROFILE_OPTIONS: Array<{
  id: SessionCodingProfile;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}> = [
  { id: 'auto',      label: 'Auto',      shortLabel: 'AUTO',   color: '#22d3ee', description: 'OpenSwan decides whether this is build, review, debug, or architecture work from the request.' },
  { id: 'senior',    label: 'Build',     shortLabel: 'BUILD',  color: '#22c55e', description: 'OpenSwan ships working code — implements features, scaffolds endpoints, wires UI.' },
  { id: 'review',    label: 'Review',    shortLabel: 'REVIEW', color: '#f59e0b', description: 'OpenSwan audits a diff or file — findings, risks, style, security.' },
  { id: 'debug',     label: 'Debug',     shortLabel: 'DEBUG',  color: '#ef4444', description: 'OpenSwan roots out a bug — reproduce, bisect, explain, propose a fix.' },
  { id: 'architect', label: 'Architect', shortLabel: 'ARCH',   color: '#38bdf8', description: 'OpenSwan designs — trade-offs, structure, boundaries, integrations; no code yet.' },
];

const DEFAULT_PROFILE: SessionCodingProfile = 'auto';
const DEFAULT_DELEGATION_MODE: SessionDelegationMode = 'auto';

export const SESSION_DELEGATION_MODE_OPTIONS: Array<{
  id: SessionDelegationMode;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}> = [
  { id: 'auto',     label: 'Auto',     shortLabel: 'AUTO',  color: '#22d3ee', description: 'OpenSwan decides when to fan out to specialist sub-agents.' },
  { id: 'parallel', label: 'Parallel', shortLabel: 'PAR',   color: '#f59e0b', description: 'Prefer a multi-agent specialist crew for substantial tasks.' },
  { id: 'focused',  label: 'Solo',     shortLabel: 'FOCUS', color: '#94a3b8', description: 'Single OpenSwan context, no delegation — fastest and cheapest.' },
];

function normalizeProfile(value: string | null | undefined): SessionCodingProfile {
  if (!value) return DEFAULT_PROFILE;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'review' || normalized === 'debug' || normalized === 'architect' || normalized === 'senior') {
    return normalized;
  }
  return DEFAULT_PROFILE;
}

function normalizeDelegationMode(value: string | null | undefined): SessionDelegationMode {
  if (!value) return DEFAULT_DELEGATION_MODE;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'parallel' || normalized === 'focused') {
    return normalized;
  }
  return DEFAULT_DELEGATION_MODE;
}

function threadProfileKey(threadId: string): string {
  return `uc_chat_session_profile_${threadId}`;
}

function roomProfileKey(roomId: string): string {
  return `uc_room_chat_profile_${roomId}`;
}

function threadDelegationModeKey(threadId: string): string {
  return `uc_chat_delegation_mode_${threadId}`;
}

function roomDelegationModeKey(roomId: string): string {
  return `uc_room_chat_delegation_mode_${roomId}`;
}

export async function loadThreadSessionProfile(threadId: string | null): Promise<SessionCodingProfile> {
  if (!threadId) return DEFAULT_PROFILE;
  return normalizeProfile(await storage.getItem(threadProfileKey(threadId)));
}

export async function saveThreadSessionProfile(threadId: string | null, profile: SessionCodingProfile): Promise<void> {
  if (!threadId) return;
  await storage.setItem(threadProfileKey(threadId), normalizeProfile(profile));
}

export async function loadRoomSessionProfile(roomId: string): Promise<SessionCodingProfile> {
  return normalizeProfile(await storage.getItem(roomProfileKey(roomId)));
}

export async function saveRoomSessionProfile(roomId: string, profile: SessionCodingProfile): Promise<void> {
  await storage.setItem(roomProfileKey(roomId), normalizeProfile(profile));
}

export async function loadThreadDelegationMode(threadId: string | null): Promise<SessionDelegationMode> {
  if (!threadId) return DEFAULT_DELEGATION_MODE;
  return normalizeDelegationMode(await storage.getItem(threadDelegationModeKey(threadId)));
}

export async function saveThreadDelegationMode(threadId: string | null, mode: SessionDelegationMode): Promise<void> {
  if (!threadId) return;
  await storage.setItem(threadDelegationModeKey(threadId), normalizeDelegationMode(mode));
}

export async function loadRoomDelegationMode(roomId: string): Promise<SessionDelegationMode> {
  return normalizeDelegationMode(await storage.getItem(roomDelegationModeKey(roomId)));
}

export async function saveRoomDelegationMode(roomId: string, mode: SessionDelegationMode): Promise<void> {
  await storage.setItem(roomDelegationModeKey(roomId), normalizeDelegationMode(mode));
}

export function getSessionProfileMeta(profile: SessionCodingProfile) {
  return SESSION_PROFILE_OPTIONS.find(option => option.id === profile) || SESSION_PROFILE_OPTIONS[0];
}

export function resolveSessionCodingProfile(
  profile: SessionCodingProfile,
  message: string,
  surface: AgenticCodingSurface,
): AgenticCodingProfile {
  return profile === 'auto' ? detectAgenticCodingProfile(message, surface) : profile;
}

export function getSessionDelegationModeMeta(mode: SessionDelegationMode) {
  return SESSION_DELEGATION_MODE_OPTIONS.find(option => option.id === mode) || SESSION_DELEGATION_MODE_OPTIONS[0];
}
