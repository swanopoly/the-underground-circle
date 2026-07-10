import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  isStickyScopeExpired,
  type StickyAllowScope,
} from '../lib/computerGrantGate';
import {
  loadStickyAllowScopes,
  revokeStickyAllowScope,
} from '../lib/computerGrantGateStore';
import { formatChatAttentionDuration } from '../lib/chatAttentionQueue';

/**
 * StandingGrantsPanel — the reviewable list of "always allow" scopes
 * (Phase 4d of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
 *
 * Sticky scopes accumulate silently (30-day TTL, up to 50 active) and were
 * only visible inside ComputerUseConsole. This panel gives Office a
 * standing-grants hygiene surface: what is allowed where, when it expires,
 * how often it was used, and one-tap revoke. Above a threshold it nudges a
 * prune — accumulated grants are how incidents happen.
 */

const PRUNE_NUDGE_THRESHOLD = 10;

interface Props {
  /** Re-load trigger; bump when a grant may have changed elsewhere. */
  refreshToken?: number;
  accentColor?: string;
  userId?: string | null;
}

export default function StandingGrantsPanel({ refreshToken = 0, accentColor = '#22c55e', userId = null }: Props) {
  const [scopes, setScopes] = useState<StickyAllowScope[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await loadStickyAllowScopes();
      setScopes(result.active);
    } catch { /* storage unavailable — panel stays empty */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshToken]);

  const handleRevoke = useCallback(async (scope: StickyAllowScope) => {
    setBusyId(scope.id);
    try {
      const result = await revokeStickyAllowScope(scope.id, userId);
      setScopes(result.active);
    } catch { /* keep the row; user can retry */ }
    setBusyId(null);
  }, [userId]);

  if (scopes.length === 0) return null;

  const needsPrune = scopes.length >= PRUNE_NUDGE_THRESHOLD;

  return (
    <View style={[styles.container, { borderColor: (needsPrune ? '#f59e0b' : accentColor) + '33' }]}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Toggle standing grants list"
      >
        <Text style={styles.headerText} numberOfLines={1}>
          Standing grants: {scopes.length} active
          {needsPrune ? ' — worth pruning' : ''}
        </Text>
        <Text style={[styles.chevron, { color: accentColor }]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && scopes.map((scope) => {
        const expiresMs = scope.expiresAtIso ? Date.parse(scope.expiresAtIso) - Date.now() : null;
        const expiryLabel = isStickyScopeExpired(scope)
          ? 'expired'
          : expiresMs !== null && Number.isFinite(expiresMs)
            ? `expires in ${formatChatAttentionDuration(Math.max(0, expiresMs))}`
            : 'no expiry';
        return (
          <View key={scope.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.scopeKey} numberOfLines={1}>
                {scope.scopeKind === 'site' ? '🌐' : '🖥'} {scope.scopeKey}
              </Text>
              <Text style={styles.scopeMeta} numberOfLines={1}>
                {scope.allowedCategories.join(', ')} · {expiryLabel} · used {scope.useCount}×
              </Text>
            </View>
            <Pressable
              disabled={busyId === scope.id}
              onPress={() => { void handleRevoke(scope); }}
              style={({ hovered }: any) => [
                styles.revokeButton,
                hovered && { borderColor: '#ef4444', backgroundColor: '#ef444418' },
                busyId === scope.id && { opacity: 0.5 },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}
            >
              <Text style={styles.revokeText}>{busyId === scope.id ? 'REVOKING…' : 'REVOKE'}</Text>
            </Pressable>
          </View>
        );
      })}
      {expanded ? (
        <Text style={styles.footer}>
          Grants let approved actions repeat without re-asking on that site/app. The pay / delete / login / grant floor always confirms regardless.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#0d150d',
    marginHorizontal: 12,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  headerText: {
    flex: 1,
    color: '#d9e4d3',
    fontSize: 12,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#1b271b',
    paddingVertical: 7,
    marginTop: 5,
  },
  rowText: { flex: 1 },
  scopeKey: {
    color: '#e6efe2',
    fontSize: 12,
    fontWeight: '700',
  },
  scopeMeta: {
    color: '#8e9f8e',
    fontSize: 11,
    marginTop: 1,
  },
  revokeButton: {
    borderWidth: 1,
    borderColor: '#3a1d1d',
    backgroundColor: '#1d0f0f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  revokeText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  footer: {
    color: '#6f7f6f',
    fontSize: 10,
    marginTop: 6,
  },
});
