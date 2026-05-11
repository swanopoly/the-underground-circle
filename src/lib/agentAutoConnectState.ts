import type { AgentConnection } from './connectionManager';

type Listener = () => void;

let running = false;
let connections: AgentConnection[] = [];
let sessionsMap = new Map<string, any[]>();
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
  circleId?: string | null;
}) {
  running = next.running;
  connections = next.connections;
  sessionsMap = next.sessionsMap;
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
