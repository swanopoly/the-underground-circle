import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

const GRID_SIZE = 16;
const CELL_COUNT = GRID_SIZE * GRID_SIZE; // 256

// 16 preset colors from agent customization palette (skin tones, hair, clothing)
const COLOR_PALETTE = [
  '#f5d0a9', '#d4a574', '#a0785a', '#6b4226', // Skin tones
  '#1a1a2e', '#4a3728', '#8b6914', '#c9302c', // Hair: black, brown, blonde, red
  '#3b82f6', '#22c55e', '#6366f1', '#f59e0b', // Clothing: blue, green, indigo, amber
  '#ec4899', '#06b6d4', '#ffffff', '#6f6f6f', // Clothing: pink, cyan, white, gray
];

type Tool = 'paint' | 'erase' | 'fill';

interface PixelSpriteEditorProps {
  initialSprite?: string[];
  onSave: (sprite: string[]) => void;
  onCancel: () => void;
}

// Flood fill algorithm
function floodFill(grid: string[], index: number, targetColor: string, fillColor: string): string[] {
  if (targetColor === fillColor) return grid;
  const result = [...grid];
  const stack = [index];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const i = stack.pop()!;
    if (i < 0 || i >= CELL_COUNT || visited.has(i)) continue;
    if (result[i] !== targetColor) continue;

    visited.add(i);
    result[i] = fillColor;

    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;

    if (col > 0) stack.push(i - 1);               // left
    if (col < GRID_SIZE - 1) stack.push(i + 1);   // right
    if (row > 0) stack.push(i - GRID_SIZE);        // up
    if (row < GRID_SIZE - 1) stack.push(i + GRID_SIZE); // down
  }

  return result;
}

// Validate hex color
function isValidColor(c: string): boolean {
  return c === 'transparent' || /^#[0-9a-fA-F]{6}$/.test(c);
}

export default function PixelSpriteEditor({
  initialSprite,
  onSave,
  onCancel,
}: PixelSpriteEditorProps) {
  const [grid, setGrid] = useState<string[]>(() => {
    if (initialSprite && initialSprite.length === CELL_COUNT) {
      return initialSprite.map(c => (isValidColor(c) ? c : 'transparent'));
    }
    return Array(CELL_COUNT).fill('transparent');
  });
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [tool, setTool] = useState<Tool>('paint');

  const handleCellPress = useCallback(
    (index: number) => {
      setGrid(prev => {
        if (tool === 'paint') {
          const next = [...prev];
          next[index] = selectedColor;
          return next;
        }
        if (tool === 'erase') {
          const next = [...prev];
          next[index] = 'transparent';
          return next;
        }
        if (tool === 'fill') {
          return floodFill(prev, index, prev[index], selectedColor);
        }
        return prev;
      });
    },
    [tool, selectedColor],
  );

  const handleSave = useCallback(() => {
    // Validate all cells
    const validated = grid.map(c => (isValidColor(c) ? c : 'transparent'));
    onSave(validated);
  }, [grid, onSave]);

  const handleClear = useCallback(() => {
    setGrid(Array(CELL_COUNT).fill('transparent'));
  }, []);

  // Build grid rows for rendering
  const rows = useMemo(() => {
    const r: number[][] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      const cols: number[] = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        cols.push(row * GRID_SIZE + col);
      }
      r.push(cols);
    }
    return r;
  }, []);

  // ── Preview: show sprite at actual tiny size (16x16 px) ──
  const previewCellSize = 2;

  return (
    <View style={styles.container} nativeID="section-pixel-sprite-editor">
      <Text style={styles.title}>PIXEL SPRITE EDITOR</Text>
      <Text style={styles.subtitle}>16x16 grid -- tap cells to paint</Text>

      <View style={styles.editorRow}>
        {/* ── Grid ── */}
        <View style={styles.gridWrap}>
          <View style={styles.gridBorder}>
            {rows.map((cols, rowIdx) => (
              <View key={rowIdx} style={styles.gridRow}>
                {cols.map(idx => (
                  <Pressable
                    key={idx}
                    onPress={() => handleCellPress(idx)}
                    style={[
                      styles.cell,
                      {
                        backgroundColor:
                          grid[idx] === 'transparent' ? (((Math.floor(idx / GRID_SIZE) + (idx % GRID_SIZE)) % 2 === 0) ? '#1a1a25' : '#111118') : grid[idx],
                      },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* ── Preview + Tools ── */}
        <View style={styles.sidebar}>
          <Text style={styles.sideLabel}>PREVIEW</Text>
          <View style={[styles.previewWrap, { width: GRID_SIZE * previewCellSize + 4, height: GRID_SIZE * previewCellSize + 4 }]}>
            {rows.map((cols, rowIdx) => (
              <View key={rowIdx} style={{ flexDirection: 'row' }}>
                {cols.map(idx => (
                  <View
                    key={idx}
                    style={{
                      width: previewCellSize,
                      height: previewCellSize,
                      backgroundColor: grid[idx] === 'transparent' ? '#0a0a0f' : grid[idx],
                    }}
                  />
                ))}
              </View>
            ))}
          </View>

          <Text style={[styles.sideLabel, { marginTop: 12 }]}>TOOLS</Text>
          {(['paint', 'erase', 'fill'] as Tool[]).map(t => (
            <Pressable
              key={t}
              onPress={() => setTool(t)}
              style={[
                styles.toolBtn,
                tool === t && styles.toolBtnActive,
              ]}
            >
              <Text style={[styles.toolBtnText, tool === t && styles.toolBtnTextActive]}>
                {t === 'paint' ? 'P' : t === 'erase' ? 'X' : 'F'} {t.toUpperCase()}
              </Text>
            </Pressable>
          ))}

          <Pressable onPress={handleClear} style={[styles.toolBtn, { marginTop: 8 }]}>
            <Text style={styles.toolBtnText}>CLR</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Color Palette ── */}
      <Text style={[styles.sideLabel, { marginTop: 12 }]}>PALETTE</Text>
      <View style={styles.paletteWrap}>
        {COLOR_PALETTE.map((color, i) => (
          <Pressable
            key={i}
            onPress={() => setSelectedColor(color)}
            style={[
              styles.paletteCell,
              { backgroundColor: color },
              selectedColor === color && styles.paletteCellSelected,
            ]}
          />
        ))}
      </View>

      {/* ── Action Buttons ── */}
      <View style={styles.actions}>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>CANCEL</Text>
        </Pressable>
        <Pressable onPress={handleSave} style={styles.saveBtn}>
          <Text style={styles.saveBtnText}>SAVE SPRITE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    padding: 12,
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#6f6f6f',
    marginBottom: 10,
  },
  editorRow: {
    flexDirection: 'row',
    gap: 12,
  },
  gridWrap: {
    flexShrink: 0,
  },
  gridBorder: {
    borderWidth: 2,
    borderColor: '#3a3a4e',
    borderRadius: 2,
    padding: 1,
    backgroundColor: '#111118',
  },
  gridRow: {
    flexDirection: 'row',
  },
  cell: {
    width: 18,
    height: 18,
    borderWidth: 0.5,
    borderColor: '#1a1a2e',
  },
  sidebar: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  sideLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  previewWrap: {
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    padding: 2,
    backgroundColor: '#0a0a0f',
  },
  toolBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    marginBottom: 4,
    backgroundColor: '#111118',
    minWidth: 70,
  },
  toolBtnActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
  },
  toolBtnText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#9e9e9e',
    fontWeight: '700',
  },
  toolBtnTextActive: {
    color: '#6366f1',
  },
  paletteWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    maxWidth: 18 * 16 + 4 * 15, // fit grid width
  },
  paletteCell: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
  },
  paletteCellSelected: {
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    backgroundColor: '#111118',
  },
  cancelBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#6f6f6f',
    fontWeight: '700',
  },
  saveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 2,
    backgroundColor: '#6366f120',
  },
  saveBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#6366f1',
    fontWeight: '700',
  },
});
