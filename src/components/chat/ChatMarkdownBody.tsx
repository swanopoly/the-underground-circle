/**
 * ChatMarkdownBody — renders a bot message's BLOCK structure (fenced code,
 * headings, bullets, blockquotes, GFM pipe tables) instead of showing raw
 * `\`\`\`` fences, `#`, `-`, `>`, and `| a | b |` markers. Block segmentation is done by the pure, smoke-pinned
 * markdownSegmentCore; each plain-text segment is delegated to the existing
 * ChatInlineRichText so inline @mentions and **bold** keep their styling.
 *
 * Additive by design: ChatTab renders this ONLY when hasRenderableMarkdown()
 * is true; otherwise it keeps the single ChatInlineRichText (byte-identical to
 * before). This component introduces no new parsing — only presentation.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import ChatInlineRichText from './ChatInlineRichText';
import ChatMarkdownTable from './ChatMarkdownTable';
import { segmentMarkdown } from '../../lib/markdownSegmentCore';

type ChatMarkdownBodyProps = {
  content: string;
  accentColor: string;
  textColor?: string;
};

function headingStyle(level?: number) {
  switch (level) {
    case 1: return styles.h1;
    case 2: return styles.h2;
    default: return styles.h3;
  }
}

export default function ChatMarkdownBody({
  content,
  accentColor,
  textColor = '#ccc',
}: ChatMarkdownBodyProps) {
  const segments = segmentMarkdown(content);

  return (
    <View style={styles.container}>
      {segments.map((seg, index) => {
        switch (seg.kind) {
          case 'code':
            return (
              <View key={`code-${index}`} style={styles.codeBlock}>
                {seg.lang ? (
                  <Text style={styles.codeLang}>{seg.lang}</Text>
                ) : null}
                <Text style={styles.codeText} selectable>
                  {seg.content}
                </Text>
              </View>
            );
          case 'heading':
            return (
              <Text key={`h-${index}`} style={[styles.heading, headingStyle(seg.level)]}>
                {seg.content}
              </Text>
            );
          case 'bullet':
            return (
              <View key={`bullet-${index}`} style={styles.bulletRow}>
                <Text style={[styles.bulletDot, { color: accentColor }]}>{'•'}</Text>
                <View style={styles.bulletBody}>
                  <ChatInlineRichText content={seg.content} accentColor={accentColor} textColor={textColor} />
                </View>
              </View>
            );
          case 'table':
            return (
              <ChatMarkdownTable
                key={`table-${index}`}
                headerCells={seg.headerCells ?? []}
                rows={seg.rows ?? []}
                align={seg.align ?? []}
                accentColor={accentColor}
              />
            );
          case 'quote':
            return (
              <View key={`quote-${index}`} style={[styles.quote, { borderLeftColor: accentColor }]}>
                <ChatInlineRichText content={seg.content} accentColor={accentColor} textColor={textColor} />
              </View>
            );
          default:
            return (
              <ChatInlineRichText
                key={`text-${index}`}
                content={seg.content}
                accentColor={accentColor}
                textColor={textColor}
              />
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  codeBlock: {
    backgroundColor: '#0b0b0b',
    borderWidth: 1,
    borderColor: '#242424',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 2,
  },
  codeLang: {
    color: '#6f7f9f',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
    textTransform: 'lowercase',
    letterSpacing: 0.5,
  },
  codeText: {
    color: '#d6e2ff',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  heading: {
    color: '#fff',
    fontWeight: '800',
    marginTop: 4,
    marginBottom: 1,
  },
  h1: { fontSize: 19, lineHeight: 25 },
  h2: { fontSize: 17, lineHeight: 23 },
  h3: { fontSize: 15, lineHeight: 21 },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: 2,
  },
  bulletDot: {
    fontSize: 15,
    lineHeight: 22,
    marginRight: 8,
    fontWeight: '800',
  },
  bulletBody: {
    flex: 1,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 2,
    opacity: 0.9,
  },
});
