/**
 * ChatMarkdownTable — renders a {kind:'table'} segment from markdownSegmentCore
 * as a real grid instead of raw `| a | b |` pipe text in the chat bubble.
 *
 * Styling matches the TableArtifactBody idiom in ChatArtifacts.tsx: framed
 * dark card, accent-tinted uppercase header row, zebra body rows, fixed-width
 * columns inside a horizontal ScrollView so wide engineering/spec tables stay
 * readable, and a bounded vertical body scroll for tall tables. Cells render
 * as plain text (the segmenter already strips table markers; inline **bold**
 * markers inside a cell stay literal — ChatInlineRichText is a single <Text>
 * with its own 15px base style and cannot take per-cell alignment, so reusing
 * it here was not trivial). Per-column GFM alignment (:-- / :-: / --:) is
 * honored via textAlign.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MarkdownTableAlign } from '../../lib/markdownSegmentCore';

type ChatMarkdownTableProps = {
  headerCells: string[];
  rows: string[][];
  align?: MarkdownTableAlign[];
  accentColor: string;
};

function cellTextAlign(a: MarkdownTableAlign | undefined): 'left' | 'center' | 'right' {
  return a === 'center' || a === 'right' ? a : 'left';
}

export default function ChatMarkdownTable({
  headerCells,
  rows,
  align = [],
  accentColor,
}: ChatMarkdownTableProps) {
  if (!Array.isArray(headerCells) || headerCells.length === 0) return null;
  const bodyRows = Array.isArray(rows) ? rows : [];

  return (
    <View style={styles.frame}>
      <ScrollView horizontal style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View>
          <View style={[styles.row, styles.headerRow]}>
            {headerCells.map((cell, colIndex) => (
              <Text
                key={`h-${colIndex}`}
                style={[
                  styles.cell,
                  styles.headerCell,
                  { color: accentColor, textAlign: cellTextAlign(align[colIndex]) },
                ]}
              >
                {cell || ' '}
              </Text>
            ))}
          </View>
          <ScrollView style={styles.bodyScroll} nestedScrollEnabled>
            {bodyRows.map((row, rowIndex) => (
              <View
                key={`r-${rowIndex}`}
                style={[styles.row, rowIndex % 2 === 1 && styles.rowZebra]}
              >
                {headerCells.map((_, colIndex) => (
                  <Text
                    key={`c-${rowIndex}-${colIndex}`}
                    style={[styles.cell, { textAlign: cellTextAlign(align[colIndex]) }]}
                  >
                    {(row && row[colIndex]) || ' '}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderColor: '#22304a',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#08101a',
    marginVertical: 2,
  },
  scroll: {
    maxHeight: 300,
  },
  scrollContent: {
    minWidth: '100%',
  },
  bodyScroll: {
    maxHeight: 252,
  },
  row: {
    flexDirection: 'row',
  },
  headerRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#22304a',
    backgroundColor: '#0d1624',
  },
  rowZebra: {
    backgroundColor: '#0d0d16',
  },
  cell: {
    width: 120,
    paddingHorizontal: 8,
    paddingVertical: 5,
    color: '#d6d6e4',
    fontSize: 11,
    lineHeight: 16,
  },
  headerCell: {
    fontWeight: '800',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
