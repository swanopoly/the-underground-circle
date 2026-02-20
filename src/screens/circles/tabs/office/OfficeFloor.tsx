import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { OfficeTheme, OFFICE_THEMES, FurnitureItem } from '../../../../lib/officeConfig';

const GRID_SIZE = 16;
export const FLOOR_W = 900;
export const FLOOR_H = 680;

// Desk positions for 12 agents — 3 rows of 4
export const DESK_POSITIONS = [
  { x: 40, y: 260 },
  { x: 220, y: 260 },
  { x: 400, y: 260 },
  { x: 580, y: 260 },
  { x: 40, y: 390 },
  { x: 220, y: 390 },
  { x: 400, y: 390 },
  { x: 580, y: 390 },
  { x: 40, y: 520 },
  { x: 220, y: 520 },
  { x: 400, y: 520 },
  { x: 580, y: 520 },
];

interface Props {
  theme?: OfficeTheme;
  furniture?: FurnitureItem[];
  onFloorPress?: (x: number, y: number) => void;
  onFurniturePress?: (id: string) => void;
}

function Desk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[styles.desk, { left: x, top: y }]}>
      <View style={[styles.deskTop, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]} />
      <View style={styles.monitor}>
        <View style={styles.monitorScreen} />
        <View style={styles.monitorStand} />
      </View>
      <View style={[styles.keyboard, { borderColor: theme.wallBorder }]} />
      <View style={styles.chair}>
        <View style={[styles.chairBack, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
        <View style={[styles.chairSeat, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
      </View>
    </View>
  );
}

function Plant({ x, y, size }: { x: number; y: number; size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 1.4 : 1;
  return (
    <View style={[styles.plant, { left: x, top: y }]}>
      <View style={[styles.plantLeaf, { width: 10 * s, height: 12 * s, backgroundColor: '#166534' }]} />
      <View style={[styles.plantLeaf, { width: 8 * s, height: 10 * s, backgroundColor: '#15803d', left: -4 * s }]} />
      <View style={[styles.plantLeaf, { width: 8 * s, height: 10 * s, backgroundColor: '#22c55e', left: 4 * s }]} />
      <View style={[styles.plantPot, { width: 12 * s, height: 10 * s }]} />
    </View>
  );
}

function CoffeeMachine({ x, y }: { x: number; y: number }) {
  return (
    <View style={[styles.coffeeMachine, { left: x, top: y }]}>
      <View style={styles.coffeeBody} />
      <View style={styles.coffeeTop} />
      <View style={styles.coffeeCup} />
    </View>
  );
}

function PlacedFurniture({ item, onPress }: { item: FurnitureItem; onPress: () => void }) {
  const icons: Record<string, string> = {
    plant: '🌿', couch: '🛋️', lamp: '💡', bookshelf: '📚',
    coffee: '☕', watercooler: '🚰', arcade: '🕹️',
  };
  return (
    <Pressable
      onPress={onPress}
      style={[styles.placedFurniture, { left: item.x, top: item.y },
        Platform.OS === 'web' && { cursor: 'pointer' } as any,
      ]}
    >
      <Text style={styles.placedIcon}>{icons[item.type] || '📦'}</Text>
      <Text style={styles.placedLabel}>{item.type}</Text>
    </Pressable>
  );
}

export default function OfficeFloor({ theme: themeProp, furniture = [], onFloorPress, onFurniturePress }: Props) {
  const theme = themeProp || OFFICE_THEMES.underground;

  const gridLines = [];
  for (let i = 0; i < FLOOR_W / GRID_SIZE; i++) {
    gridLines.push(
      <View key={`v${i}`} style={[styles.gridLineV, { left: i * GRID_SIZE, backgroundColor: theme.gridColor }]} />
    );
  }
  for (let i = 0; i < FLOOR_H / GRID_SIZE; i++) {
    gridLines.push(
      <View key={`h${i}`} style={[styles.gridLineH, { top: i * GRID_SIZE, backgroundColor: theme.gridColor }]} />
    );
  }

  const handlePress = (e: any) => {
    if (!onFloorPress) return;
    const { locationX, locationY } = e.nativeEvent;
    if (locationX && locationY) {
      // Snap to grid
      const x = Math.round(locationX / GRID_SIZE) * GRID_SIZE;
      const y = Math.round(locationY / GRID_SIZE) * GRID_SIZE;
      onFloorPress(x, y);
    }
  };

  return (
    <Pressable onPress={handlePress} style={[styles.floor, { backgroundColor: theme.floorColor }]}>
      {gridLines}

      {/* Walls */}
      <View style={[styles.wallTop, { backgroundColor: theme.wallColor, borderBottomColor: theme.wallBorder }]} />
      <View style={[styles.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder }]} />

      {/* Window */}
      <View style={styles.window}>
        <View style={[styles.windowInner, { backgroundColor: theme.windowSkyColor }]}>
          <View style={styles.windowCity}>
            <View style={[styles.building, { height: 14, left: 4, width: 8, backgroundColor: theme.windowCityColor }]} />
            <View style={[styles.building, { height: 20, left: 14, width: 6, backgroundColor: theme.windowCityColor }]} />
            <View style={[styles.building, { height: 10, left: 22, width: 10, backgroundColor: theme.windowCityColor }]} />
            <View style={[styles.building, { height: 18, left: 34, width: 7, backgroundColor: theme.windowCityColor }]} />
            <View style={[styles.building, { height: 12, left: 43, width: 9, backgroundColor: theme.windowCityColor }]} />
            <View style={[styles.building, { height: 22, left: 54, width: 5, backgroundColor: theme.windowCityColor }]} />
          </View>
          <View style={[styles.star, { top: 4, left: 10 }]} />
          <View style={[styles.star, { top: 7, left: 35 }]} />
          <View style={[styles.star, { top: 3, left: 50 }]} />
        </View>
        <View style={[styles.windowFrame, { borderColor: theme.wallBorder }]} />
      </View>

      {/* Clock */}
      <View style={styles.clock}><Text style={styles.clockText}>{'⏰'}</Text></View>

      {/* Desks */}
      {DESK_POSITIONS.map((pos, i) => (
        <Desk key={i} x={pos.x} y={pos.y} theme={theme} />
      ))}

      {/* Default decor */}
      <Plant x={740} y={200} size="lg" />
      <Plant x={740} y={380} />
      <Plant x={20} y={570} />
      <CoffeeMachine x={760} y={480} />

      {/* Lounge area */}
      <View style={[styles.lounge, { borderColor: theme.wallBorder }]}>
        <View style={[styles.loungeCouch, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
        <View style={[styles.loungeTable, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]} />
        <View style={[styles.loungeCouch, styles.loungeCouch2, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
      </View>

      {/* User-placed furniture */}
      {furniture.map(item => (
        <PlacedFurniture
          key={item.id}
          item={item}
          onPress={() => onFurniturePress?.(item.id)}
        />
      ))}

      {/* Rug */}
      <View style={[styles.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />

      {/* Floor label */}
      <View style={styles.floorLabelWrap}>
        <Text style={styles.floorLabel}>UNDERGROUND HQ · FLOOR 1</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  floor: { width: FLOOR_W, height: FLOOR_H, position: 'relative', overflow: 'hidden' },
  gridLineV: { position: 'absolute', top: 0, width: 1, height: FLOOR_H },
  gridLineH: { position: 'absolute', left: 0, width: FLOOR_W, height: 1 },
  wallTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 190, borderBottomWidth: 2 },
  wallLeft: { position: 'absolute', top: 0, left: 0, width: 8, height: FLOOR_H, borderRightWidth: 1 },
  // Window
  window: { position: 'absolute', top: 25, right: 180, width: 68, height: 42, zIndex: 2 },
  windowInner: { width: 64, height: 38, marginLeft: 2, marginTop: 2, overflow: 'hidden', position: 'relative' },
  windowCity: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 24 },
  building: { position: 'absolute', bottom: 0, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  star: { position: 'absolute', width: 2, height: 2, backgroundColor: '#ffffff40', borderRadius: 1 },
  windowFrame: { position: 'absolute', top: 0, left: 0, width: 68, height: 42, borderWidth: 2, borderRadius: 1 },
  clock: { position: 'absolute', top: 30, right: 40, zIndex: 2 },
  clockText: { fontSize: 16 },
  // Desk
  desk: { position: 'absolute', width: 90, height: 45 },
  deskTop: { width: 80, height: 26, borderWidth: 1 },
  monitor: { position: 'absolute', top: -16, left: 26, alignItems: 'center' },
  monitorScreen: { width: 24, height: 16, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  monitorStand: { width: 4, height: 3, backgroundColor: '#475569' },
  keyboard: { position: 'absolute', top: 7, left: 24, width: 28, height: 7, backgroundColor: '#1e1e2e', borderWidth: 1 },
  chair: { position: 'absolute', top: 30, left: 26, alignItems: 'center' },
  chairBack: { width: 22, height: 7, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderWidth: 1 },
  chairSeat: { width: 26, height: 5, borderWidth: 1 },
  // Plant
  plant: { position: 'absolute', alignItems: 'center' },
  plantLeaf: { position: 'absolute', borderRadius: 6, top: -8 },
  plantPot: { backgroundColor: '#78350f', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, marginTop: 4 },
  // Coffee
  coffeeMachine: { position: 'absolute', alignItems: 'center' },
  coffeeBody: { width: 20, height: 24, backgroundColor: '#374151', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' },
  coffeeTop: { position: 'absolute', top: -4, width: 24, height: 6, backgroundColor: '#4b5563', borderRadius: 2 },
  coffeeCup: { position: 'absolute', bottom: -8, left: 0, width: 10, height: 8, backgroundColor: '#f5f5f4', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  // Lounge
  lounge: { position: 'absolute', right: 30, top: 200, width: 120, height: 70, borderWidth: 1, borderRadius: 4, borderStyle: 'dashed', padding: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  loungeCouch: { width: 50, height: 24, borderRadius: 4, borderWidth: 1 },
  loungeCouch2: {},
  loungeTable: { width: 30, height: 20, borderRadius: 2, borderWidth: 1 },
  // Placed furniture
  placedFurniture: { position: 'absolute', alignItems: 'center', zIndex: 8 },
  placedIcon: { fontSize: 20 },
  placedLabel: { fontSize: 5, color: '#555', fontFamily: 'monospace', marginTop: 1 },
  // Rug
  rug: { position: 'absolute', top: 310, left: 220, width: 160, height: 60, borderWidth: 1, borderRadius: 2, opacity: 0.5 },
  // Floor label
  floorLabelWrap: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  floorLabel: { fontSize: 7, color: '#222', fontFamily: 'monospace', letterSpacing: 2 },
});
