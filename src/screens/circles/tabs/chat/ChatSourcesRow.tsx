/**
 * NOT RENDERED as of 2026-08-07 — the "Sources (N)" disclosure was removed
 * from chat replies by request. Kept (not deleted) because the component is
 * self-contained and its pure derivation core, `chatSourcesSurfaceCore`, is
 * still smoke-pinned; re-mounting it in ChatTab is a one-line change. Delete
 * both if the surface is not coming back.
 *
 * ChatSourcesRow — sources-row. Shows a "▸ Sources (N)" pill under bot
 * answers listing exactly which files, URLs, commits, and tools the answer
 * drew on. Derivation is pure + secret-safe via
 * chatSourcesSurfaceCore.buildSourcesSurface (refs sanitized/redacted there:
 * basenamed absolute paths, redacted URL query/fragment secrets, short SHAs).
 * Rows are display-only — tap-to-open is deferred. RN-safe static import:
 * the core's only dependency is the zero-import citationExtractCore.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildSourcesSurface } from '../../../../lib/chatSourcesSurfaceCore';

interface Props {
  /** Assistant answer text — citations are extracted from it. */
  content?: string;
  /** Tool events off any shape; buildSourcesSurface is total over unknown. */
  toolEvents?: unknown;
  accentColor?: string;
}

export default function ChatSourcesRow({ content, toolEvents, accentColor = '#22d3ee' }: Props) {
  const [expanded, setExpanded] = useState(false);

  // MUST stay memoized: this renders inside an inverted list and each build
  // scans up to 20k chars of answer text plus 500 tool events.
  const surface = useMemo(
    () => buildSourcesSurface({ citations: content, toolEvents, maxSources: 8 }),
    [content, toolEvents],
  );

  if (surface.count === 0) return null;

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setExpanded(v => !v)} style={styles.pill}>
        <Text style={[styles.pillText, { color: accentColor }]}>
          {expanded ? '▾' : '▸'} Sources ({surface.count})
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.drawer}>
          {surface.sources.map((s, i) => (
            <View key={`${s.kind}|${s.ref}|${i}`} style={styles.row}>
              <Text style={[styles.kindBadge, { borderColor: accentColor }]}>
                {s.kind.toUpperCase()}
              </Text>
              <Text style={styles.refText} numberOfLines={2}>{s.ref}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 2 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  pillText: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.4 },
  drawer: { marginTop: 4, gap: 4, paddingLeft: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6,
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0b1220',
  },
  kindBadge: {
    fontSize: 8, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, borderWidth: 1,
    color: '#94a3b8',
  },
  refText: { flex: 1, fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' },
});
