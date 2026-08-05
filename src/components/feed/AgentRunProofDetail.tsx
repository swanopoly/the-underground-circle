/**
 * AgentRunProofDetail — read-only proof detail for an `agent_run` proof-of-work
 * row. The write path (agentRunProofPublisherCore.buildRunProofPublication)
 * persists `proof_of_work.detail` as { verified, bullets[], git_references[] };
 * both Feed readers previously rendered the title only. This component renders,
 * under that title:
 *   - a verified/unverified badge (green when detail.verified === true),
 *   - up to ~4 secret-safe proof bullets (expand for the rest), and
 *   - clickable GitHub reference chips ("PR #123 (owner/repo)").
 *
 * The `detail` content is already secret-scrubbed / basename-reduced upstream by
 * openswanRunProofCore.redactText and taskPRLinkageCore (host-scoped github.com
 * URLs), so this is a PLAIN presentational reader: bullets go into RN <Text>
 * with NO markup interpretation, and chip URLs are re-guarded to https://github.com/
 * (defense-in-depth) before Linking.openURL. Never renders raw HTML/anchors.
 *
 * `detail` is typed loosely (`any`) and EVERY field is null-guarded, so a
 * malformed / partial / missing detail renders nothing rather than throwing.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Linking } from 'react-native';
import { formatGitReferenceLabel, type GitReference } from '../../lib/taskPRLinkageCore';

interface Props {
  /** proof_of_work.detail — { verified, bullets[], git_references[] }. Untyped
   *  on purpose; every field is null-guarded below. */
  detail?: any;
}

const BULLETS_COLLAPSED = 4;
const BULLETS_MAX = 8; // matches the write-path bullet cap
const GIT_REFS_MAX = 8;

/** Only open a canonical github.com https URL — defense-in-depth on top of the
 *  host-scoping the extractor already applied. */
function openGitRef(url: unknown): void {
  if (typeof url === 'string' && url.startsWith('https://github.com/')) {
    Linking.openURL(url).catch(() => {});
  }
}

export default function AgentRunProofDetail({ detail }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!detail || typeof detail !== 'object') return null;

  const verified = detail.verified === true;

  const allBullets: string[] = Array.isArray(detail.bullets)
    ? detail.bullets.filter((b: unknown): b is string => typeof b === 'string' && b.length > 0)
    : [];
  const shownBullets = expanded
    ? allBullets.slice(0, BULLETS_MAX)
    : allBullets.slice(0, BULLETS_COLLAPSED);
  const hasMoreBullets = allBullets.length > BULLETS_COLLAPSED;

  const gitRefs: GitReference[] = Array.isArray(detail.git_references)
    ? detail.git_references.slice(0, GIT_REFS_MAX)
    : [];

  return (
    <View style={s.wrap}>
      {/* Verified badge */}
      <View
        style={[
          s.badge,
          verified
            ? { backgroundColor: '#22c55e18', borderColor: '#22c55e55' }
            : { backgroundColor: '#f59e0b18', borderColor: '#f59e0b55' },
        ]}
      >
        <Text style={[s.badgeText, { color: verified ? '#22c55e' : '#f59e0b' }]}>
          {verified ? 'verified' : 'unverified'}
        </Text>
      </View>

      {/* Proof bullets (no markup interpretation — plain RN <Text>) */}
      {shownBullets.length > 0 && (
        <View style={s.bullets}>
          {shownBullets.map((b, i) => (
            <Text key={i} style={s.bulletText}>
              {'• '}
              {b}
            </Text>
          ))}
          {hasMoreBullets && !expanded && (
            <Text style={s.moreLink} onPress={() => setExpanded(true)}>
              more...
            </Text>
          )}
        </View>
      )}

      {/* Clickable GitHub reference chips */}
      {gitRefs.length > 0 && (
        <View style={s.chips}>
          {gitRefs.map((ref, i) => {
            const label = formatGitReferenceLabel(ref);
            if (!label) return null;
            const url = ref && typeof ref === 'object' ? (ref as any).url : undefined;
            const canOpen = typeof url === 'string' && url.startsWith('https://github.com/');
            if (canOpen) {
              return (
                <Pressable
                  key={i}
                  style={s.chip}
                  onPress={() => openGitRef(url)}
                  accessibilityRole="link"
                >
                  <Text style={s.chipTextLink}>{label}</Text>
                </Pressable>
              );
            }
            return (
              <View key={i} style={s.chip}>
                <Text style={s.chipText}>{label}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 6,
    gap: 6,
    alignItems: 'flex-start',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  bullets: {
    gap: 2,
  },
  bulletText: {
    color: '#8a8a9e',
    fontSize: 11,
    lineHeight: 15,
  },
  moreLink: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: '#12121c',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  chipText: {
    color: '#8a8a9e',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  chipTextLink: {
    color: '#22d3ee',
    fontSize: 10,
    fontFamily: 'monospace',
    textDecorationLine: 'underline',
  },
});
