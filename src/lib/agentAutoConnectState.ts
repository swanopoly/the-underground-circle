import type { AgentConnection } from './connectionManager';
import type { OpenSwanConnectionFingerprint } from './officeAgentSessionBindingCore';

type Listener = () => void;

let running = false;
let connections: AgentConnection[] = [];
let sessionsMap = new Map<string, any[]>();
let sessionFingerprints = new Map<string, OpenSwanConnectionFingerprint>();
let circleId: string | null = null;

const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) {
    try { listener(); } catch {}
  }
}

export function isAutoConnectRunning(): boolean {
  return running;
}

export function getAutoConnectConnections(): AgentConnection[] {
  return connections;
}

export function getAutoConnectSessions(): Map<string, any[]> {
  return sessionsMap;
}

export function getAutoConnectSessionFingerprints(): Map<string, OpenSwanConnectionFingerprint> {
  return sessionFingerprints;
}

export function getAutoConnectCircleId(): string | null {
  return circleId;
}

export function subscribeAutoConnect(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishAutoConnectSnapshot(next: {
  running: boolean;
  connections: AgentConnection[];
  sessionsMap: Map<string, any[]>;
  sessionFingerprints: Map<string, OpenSwanConnectionFingerprint>;
  circleId?: string | null;
}) {
  running = next.running;
  connections = next.connections;
  sessionsMap = next.sessionsMap;
  sessionFingerprints = next.sessionFingerprints;
  if ('circleId' in next) circleId = next.circleId ?? null;
  notify();
}

export function setAutoConnectCircleContext(nextCircleId: string | null) {
  circleId = nextCircleId;
  notify();
}

export function clearAutoConnectStateListeners() {
  listeners.clear();
}
