/**
 * FileLeasePanel — visible Office panel for the multi-agent file-lease system
 * (src/lib/agentFileLeaseCore.ts + src/lib/agentFileCoordination.ts). Answers
 * the user's repeated concern about agents working in the same files: which
 * paths are currently claimed, by which agent, since when, for how much
 * longer, and lets a human release a claim that is no longer legitimate.
 *
 * Collapsed by default (silent when there is nothing to see — the common
 * case, since leases only exist while an agent is actively mid-edit) with a
 * count badge on the header so activity is still discoverable without
 * expanding. Self-polls the on-disk lease registry via the coordination
 * runtime, which already fails soft to an empty list when the desktop
 * bridge is offline or no lease file exists yet.
 *
 * Status is derived from the REAL lease fields (no separate "status" field
 * exists on FileLease): a lease nearing the end of its TTL window (little
 * time left relative to when it was last renewed) is shown as "Expiring
 * soon" — the practical proxy for a likely-abandoned/stale claim, since
 * truly expired leases are pruned before ever reaching listLeases(). "Check
 * for changes" runs the real content-hash CAS check (verifyUnchanged)
 * against the hash recorded on the lease — the honest substitute for a
 * stored diff, since only a hash (not baseline content) is kept on a lease.
 * "Release" calls the real releaseFile() — it only succeeds for the panel's
 * own session (leases created by tool calls in this same app instance) or
 * for leases that have genuinely expired; an attempt on another agent's
 * still-active lease is safely refused, and the notice shown comes from the
 * structured ReleaseResult itself (outcome + the actual holder and remaining
 * time from the fresh registry read — not re-derived from this panel's
 * possibly-stale row), matching the underlying advisory-lease guarantee (it
 * never force-overrides another agent's active claim). A release that was
 * allowed but could not be persisted (bridge offline) is reported as exactly
 * that, instead of being misreported as "still claimed".
 *
 * There is intentionally no "message owner" action: `ownerLabel` is a short
 * free-text label (e.g. "openswan:ab12cd34"), not a routable identity, so
 * there is no real mechanism to hook a "message" action to without
 * inventing one — left out of scope here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert,
} from 'react-native';
import type { FileLease } from '../../../../lib/agentFileLeaseCore';
import { MONO, shortPath } from './AgentPanelShared';

const POLL_MS = 20_000;
const TICK_MS = 5_000;

interface Props {
  /** Current user id — used to resolve the active indexed codebase root
   *  (the same repoRoot the coordination.file_status / desktop.edit_file
   *  tools use) so this panel reads the same registry agents are actually
   *  writing to. */
  userId?: string;
}

type ConflictState = 'idle' | 'checking' | 'clean' | 'conflict' | 'unknown';

function formatSince(acquiredAt: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - acquiredAt) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

function formatTtl(expiresAt: number, now: number): string {
  const secs = Math.round((expiresAt - now) / 1000);
  if (secs <= 0) return 'expiring now';
  if (secs < 60) return `${secs}s left`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s left`;
}

function leaseStatus(lease: FileLease, now: number): { key: 'active' | 'expiring'; label: string; color: string } {
  const remaining = lease.expiresAt - now;
  const window = Math.max(1, lease.expiresAt - lease.renewedAt);
  const ratio = remaining / window;
  if (remaining <= 15_000 || ratio <= 0.2) {
    return { key: 'expiring', label: 'Expiring soon', color: '#e8b339' };
  }
  return { key: 'active', label: 'Claimed', color: '#22c55e' };
}

function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Release', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function notify(title: string, message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function FileLeasePanel({ userId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [leases, setLeases] = useState<FileLease[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [releasing, setReleasing] = useState<Record<string, boolean>>({});
  const [conflicts, setConflicts] = useState<Record<string, ConflictState>>({});
  const [now, setNow] = useState(() => Date.now());
  const repoRootRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      let repoRoot: string | undefined;
      if (userId) {
        try {
          const { getActiveCodebaseRoot } = await import('../../../../lib/codebaseIndexRuntime');
          repoRoot = (await getActiveCodebaseRoot(userId)) || undefined;
        } catch {
          // No indexed root yet — fall back to the bridge-relative registry.
        }
      }
      repoRootRef.current = repoRoot;
      const coord = await import('../../../../lib/agentFileCoordination');
      const active = await coord.listLeases(repoRoot);
      setLeases(active);
    } catch {
      // Observability only — a coordination read error must never break Office.
      setLeases([]);
    } finally {
      setNow(Date.now());
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [userId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Smooth the TTL countdown while the panel is open, without polling the
  // registry itself more often than POLL_MS.
  useEffect(() => {
    if (!expanded) return undefined;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [expanded]);

  const handleCheckDrift = useCallback(async (lease: FileLease) => {
    setConflicts((prev) => ({ ...prev, [lease.path]: 'checking' }));
    try {
      const coord = await import('../../../../lib/agentFileCoordination');
      const r = await coord.verifyUnchanged(lease.path, lease.contentHash, repoRootRef.current);
      setConflicts((prev) => ({ ...prev, [lease.path]: r.verdict }));
    } catch {
      setConflicts((prev) => ({ ...prev, [lease.path]: 'unknown' }));
    }
  }, []);

  const handleRelease = useCallback(async (lease: FileLease) => {
    const ok = await confirmAsync(
      'Release this file lease?',
      `${lease.path}\n\nClaimed by ${lease.ownerLabel}${lease.intent ? ` — ${lease.intent}` : ''}.\n\nThis only succeeds if the lease is yours or has actually expired.`,
    );
    if (!ok) return;
    setReleasing((prev) => ({ ...prev, [lease.path]: true }));
    try {
      const coord = await import('../../../../lib/agentFileCoordination');
      const res = await coord.releaseFile(lease.path, { repoRoot: repoRootRef.current });
      if (res.ok) {
        await load();
      } else if (res.outcome === 'not_holder') {
        // Refused: show the REAL holder + remaining time from the fresh
        // registry read the release just did, not this panel's stale row.
        const holder = res.holder ?? lease;
        const remaining = Math.max(0, Math.round((holder.expiresAt - Date.now()) / 1000));
        notify(
          'Still claimed',
          `${lease.path} is still held by ${holder.ownerLabel} for about ${remaining}s. It will free itself automatically once that agent finishes or its lease expires.`,
        );
      } else {
        // no_registry: the release was allowed but could not be persisted
        // (bridge offline / registry write failed) — say that honestly.
        notify(
          'Release not saved',
          `${lease.path}: ${res.reason}`,
        );
      }
    } finally {
      setReleasing((prev) => ({ ...prev, [lease.path]: false }));
    }
  }, [load]);

  const count = leases.length;

  return (
    <View style={styles.wrap} nativeID="section-office-file-leases">
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Toggle file leases panel"
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>🗂</Text>
          <Text style={styles.headerTitle}>FILE LEASES</Text>
          {count > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          {loading && !hasLoadedOnce ? <ActivityIndicator size="small" color="#6f6f6f" /> : null}
          <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <Text style={styles.subtitle}>
            Which files connected agents currently have claimed, so nobody edits the same file twice.
          </Text>
          {loading && !hasLoadedOnce ? (
            <ActivityIndicator size="small" color="#e8e8e8" style={{ marginTop: 12 }} />
          ) : count === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No files are currently claimed by any agent.</Text>
              <Text style={styles.emptySubtext}>
                This is the normal state — a lease only exists while an agent is actively mid-edit.
              </Text>
            </View>
          ) : (
            leases.map((lease) => {
              const status = leaseStatus(lease, now);
              const conflict = conflicts[lease.path] ?? 'idle';
              const isReleasing = !!releasing[lease.path];
              return (
                <View key={lease.path} style={styles.row}>
                  <View style={styles.rowTop}>
                    <Text style={styles.path} numberOfLines={1} accessibilityLabel={lease.path}>
                      {shortPath(lease.path)}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: `${status.color}22`, borderColor: `${status.color}55` }]}>
                      <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {lease.ownerLabel} · {formatSince(lease.acquiredAt, now)} · {formatTtl(lease.expiresAt, now)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>hash {lease.contentHash ? lease.contentHash.slice(0, 12) : '(new file)'}</Text>
                  {lease.intent ? (
                    <Text style={styles.intent} numberOfLines={1}>“{lease.intent}”</Text>
                  ) : null}
                  {conflict !== 'idle' ? (
                    <Text
                      style={[
                        styles.conflictText,
                        conflict === 'conflict' ? styles.conflictBad : conflict === 'clean' ? styles.conflictOk : styles.conflictNeutral,
                      ]}
                    >
                      {conflict === 'checking' ? 'Checking for changes…'
                        : conflict === 'conflict' ? 'Changed on disk since claimed'
                          : conflict === 'clean' ? 'Unchanged since claimed'
                            : 'Could not verify (bridge offline?)'}
                    </Text>
                  ) : null}
                  <View style={styles.rowActions}>
                    <Pressable
                      style={styles.actionBtn}
                      onPress={() => handleCheckDrift(lease)}
                      disabled={conflict === 'checking'}
                    >
                      <Text style={styles.actionBtnText}>{conflict === 'checking' ? 'Checking…' : 'Check for changes'}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtn, styles.releaseBtn]}
                      onPress={() => handleRelease(lease)}
                      disabled={isReleasing}
                    >
                      {isReleasing ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Text style={[styles.actionBtnText, styles.releaseBtnText]}>Release</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 13,
  },
  headerTitle: {
    color: '#9e9e9e',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  countBadge: {
    backgroundColor: '#6366f125',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  countBadgeText: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevron: {
    color: '#6f6f6f',
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  subtitle: {
    color: '#6f6f6f',
    fontSize: 11,
    marginBottom: 10,
  },
  empty: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#16161640',
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#252525',
  },
  emptyText: {
    color: '#8b949e',
    fontSize: 12,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#6f6f6f',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  row: {
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  path: {
    color: '#e8e8e8',
    fontSize: 12,
    fontFamily: MONO,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rowMeta: {
    color: '#6f6f6f',
    fontSize: 11,
    marginTop: 3,
  },
  intent: {
    color: '#8b949e',
    fontSize: 11,
    marginTop: 3,
    fontStyle: 'italic',
  },
  conflictText: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  conflictOk: {
    color: '#22c55e',
  },
  conflictBad: {
    color: '#ef4444',
  },
  conflictNeutral: {
    color: '#6f6f6f',
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionBtnText: {
    color: '#9e9e9e',
    fontSize: 11,
    fontWeight: '600',
  },
  releaseBtn: {
    borderColor: '#ef444455',
  },
  releaseBtnText: {
    color: '#ef4444',
  },
});
