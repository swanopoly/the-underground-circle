/**
 * useAutoConnectLiveAgents — shared hook that exposes the live agent roster
 * from the agent-auto-connect singleton as a memoized array, applying custom
 * names and colors from the identity store plus legacy name overrides.
 *
 * FeedTab used to inline this logic directly (~55 lines of OfficeAgent
 * conversion plus a subscribe/resubscribe dance). OfficeTab has its own,
 * more elaborate, roster pipeline (`buildOfficeRoster`), but the session →
 * OfficeAgent conversion at its core is the same work. Consolidating here
 * means custom-name and color resolution stays consistent across surfaces.
 *
 * Consumers typically want either:
 *   - `liveAgents` (OfficeAgent[]) to compose into a bespoke roster
 *   - `liveCircleAgents` (CircleOfficeAgent[]) to show alongside DB rows
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getAutoConnectConnections,
  getAutoConnectSessions,
  subscribeAutoConnect,
} from '../lib/agentAutoConnectState';
import { loadAgentIdentities, type AgentIdentity } from '../lib/agentIdentity';
import { storage } from '../lib/storage';
import { sessionsToAgents, type OfficeAgent } from '../lib/officeAgents';
import type { OpenSwanSession } from '../lib/openswanService';
import { PROVIDER_DISPLAY, type CircleOfficeAgent, type AgentStatus } from '../lib/circleOffice';

type Options = {
  /** If set, tells the auto-connect singleton which circle to publish to. */
  circleId?: string;
};

export type UseAutoConnectLiveAgentsResult = {
  /** Live agents as OfficeAgent[] with custom name/color applied. */
  liveAgents: OfficeAgent[];
  /** Same agents mapped into the CircleOfficeAgent shape for DB-merging UIs. */
  liveCircleAgents: CircleOfficeAgent[];
  /** Raw identity map — useful for downstream resolution (scoring, pinning). */
  agentIdentities: Map<string, AgentIdentity>;
  /** Legacy `@office_agent_names` override map. */
  legacyNames: Record<string, string>;
};

export function useAutoConnectLiveAgents(opts: Options = {}): UseAutoConnectLiveAgentsResult {
  const { circleId } = opts;
  const [tick, setTick] = useState(0);
  const [agentIdentities, setAgentIdentities] = useState<Map<string, AgentIdentity>>(new Map());
  const [legacyNames, setLegacyNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (circleId) {
      import('../lib/agentAutoConnect')
        .then((mod) => mod.setAutoConnectCircleId(circleId))
        .catch(() => {});
    }
    const unsub = subscribeAutoConnect(() => setTick(t => t + 1));
    loadAgentIdentities().then(setAgentIdentities).catch(() => {});
    storage.getItem('@office_agent_names').then(raw => {
      if (raw) {
        try { setLegacyNames(JSON.parse(raw)); } catch {}
      }
    }).catch(() => {});
    return () => { unsub(); };
  }, [circleId]);

  const liveAgents = useMemo(() => {
    const connections = getAutoConnectConnections();
    const sessionsMap = getAutoConnectSessions();
    const out: OfficeAgent[] = [];
    for (const [connId, sessions] of sessionsMap) {
      if (connId === 'claude-code-auto') {
        const ccAgents = sessions as unknown as OfficeAgent[];
        if (ccAgents?.length) out.push(...ccAgents);
        continue;
      }
      const conn = connections.find(c => c.id === connId);
      if (!conn || !sessions?.length) continue;
      const converted = sessionsToAgents(
        sessions as OpenSwanSession[],
        connId,
        conn.name,
        conn.provider as any,
      );
      out.push(...converted);
    }
    return out.map(agent => {
      const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
      const identity = agentIdentities.get(sessionKey);
      const legacy = legacyNames[agent.id];
      return {
        ...agent,
        name: identity?.customName || legacy || agent.name,
        color: identity?.customColor || agent.color,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, agentIdentities, legacyNames]);

  const liveCircleAgents = useMemo<CircleOfficeAgent[]>(() => {
    return liveAgents.map(oa => {
      const providerInfo = PROVIDER_DISPLAY[oa.providerType] || PROVIDER_DISPLAY['generic-agent'];
      return {
        id: oa.id,
        circleId: circleId || '',
        ownerId: '',
        ownerDisplayName: '',
        ownerUsername: '',
        provider: oa.providerType || 'generic-agent',
        name: oa.name,
        color: oa.color || providerInfo?.color || '#e8e8e8',
        toolIcon: providerInfo?.icon || 'AI',
        status: (oa.status || 'idle') as AgentStatus,
        currentTask: undefined,
        isPublished: true,
        createdAt: '',
        updatedAt: '',
      };
    });
  }, [liveAgents, circleId]);

  return { liveAgents, liveCircleAgents, agentIdentities, legacyNames };
}

/**
 * Merge a DB-persisted circle-agent list with a live session-derived list so
 * downstream task-assignment UIs can see the full roster. DB rows win for
 * identity; live status wins for presence.
 */
export function mergeDbAndLiveCircleAgents(
  dbAgents: CircleOfficeAgent[],
  liveAgents: CircleOfficeAgent[],
): CircleOfficeAgent[] {
  const merged = dbAgents.map(a => {
    const live = liveAgents.find(l =>
      l.name.toLowerCase() === a.name.toLowerCase() || l.id === a.id,
    );
    return live ? { ...a, status: live.status } : a;
  });
  const taken = new Set(merged.map(a => a.name.toLowerCase()));
  for (const live of liveAgents) {
    if (!taken.has(live.name.toLowerCase())) {
      taken.add(live.name.toLowerCase());
      merged.push(live);
    }
  }
  return merged;
}
