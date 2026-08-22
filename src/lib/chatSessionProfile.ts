import { storage } from './storage';
import { detectAgenticCodingProfile, detectAgenticCodingProfileWithConfidence, type AgenticCodingProfile, type AgenticCodingSurface } from './agenticCodingProfile';
import type { OpenSwanChatMode } from './openswanModePolicy';
import {
  chatPersonalThreadStorageKey,
  type ChatPersonalStorageScope,
} from './chatSessionStatePersistence';

export type SessionCodingProfile = AgenticCodingProfile | 'auto';
export type SessionDelegationMode = 'auto' | 'parallel' | 'focused';
export type ThreadChatMode = OpenSwanChatMode;

// OpenSwan is framed as a service the user calls on — not a persona it
// pretends to be. Each mode is a different kind of work the service does.
export const SESSION_PROFILE_OPTIONS: Array<{
  id: SessionCodingProfile;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}> = [
  { id: 'auto',      label: 'Auto',      shortLabel: 'AUTO',   color: '#6366f1', description: 'OpenSwan decides whether this is build, review, debug, or architecture work from the request.' },
  { id: 'senior',    label: 'Build',     shortLabel: 'BUILD',  color: '#22c55e', description: 'OpenSwan ships working code — implements features, scaffolds endpoints, wires UI.' },
  { id: 'review',    label: 'Review',    shortLabel: 'REVIEW', color: '#f59e0b', description: 'OpenSwan audits a diff or file — findings, risks, style, security.' },
  { id: 'debug',     label: 'Debug',     shortLabel: 'DEBUG',  color: '#ef4444', description: 'OpenSwan roots out a bug — reproduce, bisect, explain, propose a fix.' },
  { id: 'architect', label: 'Architect', shortLabel: 'ARCH',   color: '#38bdf8', description: 'OpenSwan designs — trade-offs, structure, boundaries, integrations; no code yet.' },
  { id: 'research',  label: 'Research',  shortLabel: 'RES',    color: '#a855f7', description: 'OpenSwan investigates deeply — compares options, gathers evidence, recommends the best path.' },
  { id: 'design',    label: 'Design',    shortLabel: 'DESIGN', color: '#ec4899', description: 'OpenSwan shapes UI and product experience — layout, interaction, accessibility, handoff.' },
  { id: 'support',   label: 'Support',   shortLabel: 'HELP',   color: '#3b82f6', description: 'OpenSwan troubleshoots and guides — fastest path to unblock, configure, or recover.' },
];

const DEFAULT_PROFILE: SessionCodingProfile = 'auto';
const DEFAULT_DELEGATION_MODE: SessionDelegationMode = 'auto';
const DEFAULT_CHAT_MODE: ThreadChatMode = 'none';

export const SESSION_DELEGATION_MODE_OPTIONS: Array<{
  id: SessionDelegationMode;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}> = [
  { id: 'auto',     label: 'Auto',     shortLabel: 'AUTO',  color: '#6366f1', description: 'OpenSwan decides when to fan out to specialist sub-agents.' },
  { id: 'parallel', label: 'Parallel', shortLabel: 'PAR',   color: '#f59e0b', description: 'Prefer a multi-agent specialist crew for substantial tasks.' },
  { id: 'focused',  label: 'Solo',     shortLabel: 'FOCUS', color: '#94a3b8', description: 'Single OpenSwan context, no delegation — fastest and cheapest.' },
];

function normalizeProfile(value: string | null | undefined): SessionCodingProfile {
  if (!value) return DEFAULT_PROFILE;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'review' || normalized === 'debug' || normalized === 'architect' || normalized === 'senior' || normalized === 'research' || normalized === 'design' || normalized === 'support') {
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

function legacyThreadProfileKey(threadId: string): string {
  return `uc_chat_session_profile_${threadId}`;
}

function roomProfileKey(roomId: string): string {
  return `uc_room_chat_profile_${roomId}`;
}

function legacyThreadDelegationModeKey(threadId: string): string {
  return `uc_chat_delegation_mode_${threadId}`;
}

function legacyThreadChatModeKey(threadId: string): string {
  return `uc_chat_mode_${threadId}`;
}

function roomDelegationModeKey(roomId: string): string {
  return `uc_room_chat_delegation_mode_${roomId}`;
}

function normalizeChatMode(value: string | null | undefined): ThreadChatMode {
  if (!value) return DEFAULT_CHAT_MODE;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'none' ||
    normalized === 'talk' ||
    normalized === 'build' ||
    normalized === 'plan' ||
    normalized === 'execute' ||
    normalized === 'review' ||
    normalized === 'research' ||
    normalized === 'support' ||
    normalized === 'design'
  ) {
    return normalized as ThreadChatMode;
  }
  return DEFAULT_CHAT_MODE;
}

export type ThreadSessionStorageScope = ChatPersonalStorageScope & Readonly<{
  threadId?: unknown;
}>;

async function retireLegacyThreadValue(key: string): Promise<void> {
  try { await storage.removeItem(key); } catch {}
}

export async function loadThreadSessionProfile(scope: ThreadSessionStorageScope): Promise<SessionCodingProfile> {
  const key = chatPersonalThreadStorageKey('session_profile', scope, scope.threadId);
  if (!key) return DEFAULT_PROFILE;
  if (typeof scope.threadId === 'string' && scope.threadId) {
    await retireLegacyThreadValue(legacyThreadProfileKey(scope.threadId));
  }
  return normalizeProfile(await storage.getItem(key));
}

export async function saveThreadSessionProfile(scope: ThreadSessionStorageScope, profile: SessionCodingProfile): Promise<void> {
  const key = chatPersonalThreadStorageKey('session_profile', scope, scope.threadId);
  if (!key) return;
  await storage.setItem(key, normalizeProfile(profile));
}

export async function loadRoomSessionProfile(roomId: string): Promise<SessionCodingProfile> {
  return normalizeProfile(await storage.getItem(roomProfileKey(roomId)));
}

export async function saveRoomSessionProfile(roomId: string, profile: SessionCodingProfile): Promise<void> {
  await storage.setItem(roomProfileKey(roomId), normalizeProfile(profile));
}

export async function loadThreadDelegationMode(scope: ThreadSessionStorageScope): Promise<SessionDelegationMode> {
  const key = chatPersonalThreadStorageKey('delegation_mode', scope, scope.threadId);
  if (!key) return DEFAULT_DELEGATION_MODE;
  if (typeof scope.threadId === 'string' && scope.threadId) {
    await retireLegacyThreadValue(legacyThreadDelegationModeKey(scope.threadId));
  }
  return normalizeDelegationMode(await storage.getItem(key));
}

export async function saveThreadDelegationMode(scope: ThreadSessionStorageScope, mode: SessionDelegationMode): Promise<void> {
  const key = chatPersonalThreadStorageKey('delegation_mode', scope, scope.threadId);
  if (!key) return;
  await storage.setItem(key, normalizeDelegationMode(mode));
}

export async function loadThreadChatMode(scope: ThreadSessionStorageScope): Promise<ThreadChatMode> {
  const key = chatPersonalThreadStorageKey('mode', scope, scope.threadId);
  if (!key) return DEFAULT_CHAT_MODE;
  if (typeof scope.threadId === 'string' && scope.threadId) {
    await retireLegacyThreadValue(legacyThreadChatModeKey(scope.threadId));
  }
  return normalizeChatMode(await storage.getItem(key));
}

export async function saveThreadChatMode(scope: ThreadSessionStorageScope, mode: ThreadChatMode): Promise<void> {
  const key = chatPersonalThreadStorageKey('mode', scope, scope.threadId);
  if (!key) return;
  await storage.setItem(key, normalizeChatMode(mode));
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
  if (profile === 'auto') return detectAgenticCodingProfile(message, surface);
  if (profile === 'research') return 'research';
  if (profile === 'design') return 'design';
  if (profile === 'support') return 'support';
  return profile;
}

/** Resolve the profile and return detection metadata for UI feedback */
export function resolveSessionCodingProfileWithDetails(
  profile: SessionCodingProfile,
  message: string,
  surface: AgenticCodingSurface,
): { resolved: AgenticCodingProfile; autoDetected: boolean; confidence: 'high' | 'medium' | 'low'; label: string } {
  if (profile !== 'auto') {
    const meta = SESSION_PROFILE_OPTIONS.find(o => o.id === profile);
    return { resolved: profile, autoDetected: false, confidence: 'high', label: meta?.shortLabel || profile.toUpperCase() };
  }
  const detection = detectAgenticCodingProfileWithConfidence(message, surface);
  const meta = SESSION_PROFILE_OPTIONS.find(o => o.id === detection.profile);
  return {
    resolved: detection.profile,
    autoDetected: true,
    confidence: detection.confidence,
    label: meta?.shortLabel || detection.profile.toUpperCase(),
  };
}

export function getSessionDelegationModeMeta(mode: SessionDelegationMode) {
  return SESSION_DELEGATION_MODE_OPTIONS.find(option => option.id === mode) || SESSION_DELEGATION_MODE_OPTIONS[0];
}

export function getDefaultDelegationModeForProfile(profile: SessionCodingProfile): SessionDelegationMode {
  switch (profile) {
    case 'research':
      return 'parallel';
    case 'review':
    case 'architect':
    case 'design':
    case 'support':
      return 'focused';
    case 'auto':
    case 'debug':
    case 'senior':
    default:
      return 'auto';
  }
}

export function resolveEffectiveDelegationMode(
  selectedMode: SessionDelegationMode,
  profile: SessionCodingProfile,
): SessionDelegationMode {
  return selectedMode === 'auto' ? getDefaultDelegationModeForProfile(profile) : selectedMode;
}
