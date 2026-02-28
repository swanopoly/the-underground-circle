import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { OfficeTheme, OFFICE_THEMES, FurnitureItem, FurnitureType } from '../../../../lib/officeConfig';

const GRID_SIZE = 16;
export const FLOOR_W = 900;
export const FLOOR_H = 680;

export const DESK_POSITIONS = [
  { x: 40, y: 260 }, { x: 220, y: 260 }, { x: 400, y: 260 }, { x: 580, y: 260 },
  { x: 40, y: 390 }, { x: 220, y: 390 }, { x: 400, y: 390 }, { x: 580, y: 390 },
  { x: 40, y: 520 }, { x: 220, y: 520 }, { x: 400, y: 520 }, { x: 580, y: 520 },
];

interface Props {
  theme?: OfficeTheme;
  furniture?: FurnitureItem[];
  onFloorPress?: (x: number, y: number) => void;
  onFurniturePress?: (id: string) => void;
  editMode?: boolean;
}

// ── Built-in pieces ──────────────────────────────────────────────────────────

function Desk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      <View style={[s.deskTop, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]} />
      <View style={s.monitor}>
        <View style={s.monitorScreen} />
        <View style={s.monitorStand} />
      </View>
      <View style={[s.keyboard, { borderColor: theme.wallBorder }]} />
      <View style={s.chair}>
        <View style={[s.chairBack, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
        <View style={[s.chairSeat, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
      </View>
    </View>
  );
}

function Plant({ x, y, size }: { x: number; y: number; size?: 'sm' | 'lg' }) {
  const sc = size === 'lg' ? 1.4 : 1;
  return (
    <View style={[s.plant, { left: x, top: y }]}>
      <View style={[s.plantLeaf, { width: 10 * sc, height: 12 * sc, backgroundColor: '#166534' }]} />
      <View style={[s.plantLeaf, { width: 8 * sc, height: 10 * sc, backgroundColor: '#15803d', left: -4 * sc }]} />
      <View style={[s.plantLeaf, { width: 8 * sc, height: 10 * sc, backgroundColor: '#22c55e', left: 4 * sc }]} />
      <View style={[s.plantPot, { width: 12 * sc, height: 10 * sc }]} />
    </View>
  );
}

function CoffeeMachine({ x, y }: { x: number; y: number }) {
  return (
    <View style={[s.coffeeWrap, { left: x, top: y }]}>
      <View style={s.coffeeBody} />
      <View style={s.coffeeTop} />
      <View style={s.coffeeCup} />
    </View>
  );
}

// ── Placed furniture renderer ─────────────────────────────────────────────────

function FurnitureRenderer({ item, theme, onPress, editMode }: {
  item: FurnitureItem;
  theme: OfficeTheme;
  onPress: () => void;
  editMode?: boolean;
}) {
  const content = renderFurnitureContent(item, theme);
  return (
    <Pressable
      onPress={onPress}
      style={[s.placedWrap, { left: item.x, top: item.y },
        Platform.OS === 'web' && { cursor: editMode ? 'pointer' : 'default' } as any,
      ]}
    >
      {content}
      {editMode && (
        <View style={s.editOverlay}>
          <Text style={s.editOverlayX}>✕</Text>
        </View>
      )}
    </Pressable>
  );
}

function renderFurnitureContent(item: FurnitureItem, theme: OfficeTheme) {
  switch (item.type) {
    case 'plant':
      return (
        <View style={s.fPlant}>
          <View style={[s.fPlantLeaf, { backgroundColor: '#166534' }]} />
          <View style={[s.fPlantLeaf, { backgroundColor: '#15803d', left: -4 }]} />
          <View style={[s.fPlantLeaf, { backgroundColor: '#22c55e', left: 4 }]} />
          <View style={s.fPlantPot} />
        </View>
      );
    case 'couch':
      return (
        <View style={[s.fCouch, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]}>
          <View style={[s.fCouchBack, { backgroundColor: theme.chairBorder }]} />
          <View style={s.fCouchArmL} /><View style={s.fCouchArmR} />
          <View style={[s.fCouchCushion, { backgroundColor: theme.chairColor }]} />
        </View>
      );
    case 'beanbag':
      return (
        <View style={[s.fBeanBag, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]}>
          <View style={[s.fBeanBagInner, { backgroundColor: theme.accentGlow + '40' }]} />
        </View>
      );
    case 'lamp':
      return (
        <View style={s.fLamp}>
          <View style={[s.fLampHead, { backgroundColor: theme.accentGlow + '80', borderColor: theme.accentGlow }]} />
          <View style={s.fLampPole} />
          <View style={s.fLampBase} />
        </View>
      );
    case 'bookshelf':
      return (
        <View style={[s.fShelf, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]}>
          {[0, 1, 2].map(row => (
            <View key={row} style={s.fShelfRow}>
              {[0, 1, 2, 3].map(col => (
                <View key={col} style={[s.fBook, { backgroundColor: ['#ef4444','#3b82f6','#22c55e','#f59e0b','#8b5cf6'][( row * 4 + col) % 5] }]} />
              ))}
            </View>
          ))}
        </View>
      );
    case 'tv':
      return (
        <View style={s.fTV}>
          <View style={[s.fTVScreen, { backgroundColor: '#0a0a1f', borderColor: theme.accentGlow }]}>
            <View style={[s.fTVGlow, { backgroundColor: theme.accentGlow + '30' }]} />
            <Text style={[s.fTVText, { color: theme.accentGlow }]}>LIVE</Text>
          </View>
          <View style={s.fTVStand} />
          <View style={s.fTVBase} />
        </View>
      );
    case 'server':
      return (
        <View style={[s.fServer, { backgroundColor: '#1e1e2e', borderColor: '#334155' }]}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={s.fServerUnit}>
              <View style={[s.fServerLight, { backgroundColor: i % 2 === 0 ? '#22c55e' : theme.accentGlow }]} />
              <View style={s.fServerBar} />
            </View>
          ))}
        </View>
      );
    case 'whiteboard':
      return (
        <View style={[s.fWhiteboard, { backgroundColor: '#f0f0e8', borderColor: '#8B7355' }]}>
          <View style={s.fWhiteboardInner}>
            <View style={[s.fWBLine, { width: '80%', marginTop: 4 }]} />
            <View style={[s.fWBLine, { width: '60%' }]} />
            <View style={[s.fWBLine, { width: '70%' }]} />
          </View>
          <View style={s.fWhiteboardTray} />
        </View>
      );
    case 'standingdesk':
      return (
        <View style={s.fStandingDesk}>
          <View style={[s.fSDTop, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]}>
            <View style={s.fSDMonitor} />
            <View style={s.fSDKeyboard} />
          </View>
          <View style={[s.fSDLeg, { backgroundColor: theme.deskBorder }]} />
          <View style={[s.fSDLeg, { left: 50, backgroundColor: theme.deskBorder }]} />
        </View>
      );
    case 'coffee':
      return (
        <View style={s.fCoffeeWrap}>
          <View style={s.fCoffeeBody} />
          <View style={s.fCoffeeTop} />
          <View style={s.fCoffeeCup} />
        </View>
      );
    case 'watercooler':
      return (
        <View style={s.fWaterCooler}>
          <View style={[s.fWCBottle, { backgroundColor: '#bfdbfe', borderColor: '#93c5fd' }]} />
          <View style={[s.fWCBody, { backgroundColor: '#1e293b', borderColor: '#334155' }]}>
            <View style={[s.fWCTap, { backgroundColor: '#3b82f6' }]} />
          </View>
        </View>
      );
    case 'arcade':
      return (
        <View style={[s.fArcade, { backgroundColor: '#1e1e2e', borderColor: theme.accentGlow + '80' }]}>
          <View style={[s.fArcadeScreen, { backgroundColor: '#0a0a1f', borderColor: theme.accentGlow }]}>
            <Text style={[s.fArcadeText, { color: theme.accentGlow }]}>▲</Text>
          </View>
          <View style={s.fArcadeControls}>
            <View style={[s.fArcadeBtn, { backgroundColor: '#ef4444' }]} />
            <View style={[s.fArcadeBtn, { backgroundColor: '#22c55e' }]} />
          </View>
        </View>
      );
    case 'pingtable':
      return (
        <View style={s.fPingTable}>
          <View style={[s.fPTSurface, { backgroundColor: '#1d4ed8', borderColor: '#93c5fd' }]}>
            <View style={s.fPTNet} />
            <View style={s.fPTLine} />
          </View>
          <View style={s.fPTLeg} /><View style={[s.fPTLeg, { left: 80 }]} />
        </View>
      );
    case 'snackbar':
      return (
        <View style={[s.fSnackBar, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]}>
          <View style={s.fSBCounter} />
          <View style={s.fSBItems}>
            <Text style={s.fSBIcon}>🍕</Text>
            <Text style={s.fSBIcon}>🥤</Text>
          </View>
        </View>
      );
    case 'neonsign':
      return (
        <View style={[s.fNeonSign, { borderColor: theme.accentGlow, shadowColor: theme.accentGlow }]}>
          <Text style={[s.fNeonText, { color: theme.accentGlow, textShadowColor: theme.accentGlow }]}>
            {item.label || 'THE END'}
          </Text>
        </View>
      );
    case 'trophy':
      return (
        <View style={[s.fTrophy, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]}>
          {['#f59e0b', '#94a3b8', '#cd7c32'].map((c, i) => (
            <View key={i} style={[s.fTrophyItem, { backgroundColor: c }]}>
              <Text style={s.fTrophyIcon}>🏆</Text>
            </View>
          ))}
        </View>
      );
    case 'safe':
      return (
        <View style={[s.fSafe, { backgroundColor: '#374151', borderColor: '#4b5563' }]}>
          <View style={s.fSafeDoor}>
            <View style={[s.fSafeDial, { backgroundColor: '#6b7280' }]} />
            <View style={[s.fSafeHandle, { backgroundColor: '#9ca3af' }]} />
          </View>
        </View>
      );
    case 'rug':
      return (
        <View style={[s.fRug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]}>
          <View style={[s.fRugInner, { borderColor: theme.rugBorder }]} />
        </View>
      );
    case 'printer':
      return (
        <View style={[s.fPrinter, { backgroundColor: '#e2e8f0', borderColor: '#94a3b8' }]}>
          <View style={s.fPrinterSlot} />
          <View style={s.fPrinterPanel}>
            <View style={[s.fPrinterBtn, { backgroundColor: '#22c55e' }]} />
            <View style={[s.fPrinterBtn, { backgroundColor: '#3b82f6' }]} />
          </View>
        </View>
      );
    case 'clock':
      return (
        <View style={[s.fClock, { backgroundColor: '#1e293b', borderColor: theme.accentGlow }]}>
          <View style={s.fClockFace}>
            <View style={s.fClockHour} />
            <View style={s.fClockMin} />
          </View>
        </View>
      );
    case 'window':
      return (
        <View style={[s.fWindow, { backgroundColor: theme.windowSkyColor, borderColor: theme.wallBorder }]}>
          <View style={s.fWindowFrame} />
          <View style={s.fWindowCity}>
            {[8, 14, 10, 18, 12].map((h, i) => (
              <View key={i} style={[s.fWindowBuilding, { height: h, left: i * 11, backgroundColor: theme.windowCityColor }]} />
            ))}
          </View>
        </View>
      );
    default:
      return <Text style={{ fontSize: 20 }}>📦</Text>;
  }
}

// ── Main floor ────────────────────────────────────────────────────────────────

export default function OfficeFloor({ theme: themeProp, furniture = [], onFloorPress, onFurniturePress, editMode }: Props) {
  const theme = themeProp || OFFICE_THEMES.underground;

  const gridLines: React.ReactElement[] = [];
  for (let i = 0; i < FLOOR_W / GRID_SIZE; i++) {
    gridLines.push(<View key={`v${i}`} style={[s.gridV, { left: i * GRID_SIZE, backgroundColor: theme.gridColor }]} />);
  }
  for (let i = 0; i < FLOOR_H / GRID_SIZE; i++) {
    gridLines.push(<View key={`h${i}`} style={[s.gridH, { top: i * GRID_SIZE, backgroundColor: theme.gridColor }]} />);
  }

  const floorRef = React.useRef<any>(null);

  const handlePress = (e: any) => {
    if (!onFloorPress) return;
    // Web: use getBoundingClientRect for accurate coordinates
    if (Platform.OS === 'web' && floorRef.current) {
      const rect = floorRef.current.getBoundingClientRect?.();
      if (rect) {
        const clientX = e.nativeEvent?.clientX ?? e.clientX;
        const clientY = e.nativeEvent?.clientY ?? e.clientY;
        const rawX = clientX - rect.left;
        const rawY = clientY - rect.top;
        const x = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
        const y = Math.round(rawY / GRID_SIZE) * GRID_SIZE;
        onFloorPress(x, y);
        return;
      }
    }
    // Native fallback
    const { locationX, locationY } = e.nativeEvent || {};
    if (locationX != null && locationY != null) {
      const x = Math.round(locationX / GRID_SIZE) * GRID_SIZE;
      const y = Math.round(locationY / GRID_SIZE) * GRID_SIZE;
      onFloorPress(x, y);
    }
  };

  return (
    <Pressable ref={floorRef} onPress={handlePress} style={[s.floor, { backgroundColor: theme.floorColor }]}>
      {gridLines}

      {/* Walls */}
      <View style={[s.wallTop, { backgroundColor: theme.wallColor, borderBottomColor: theme.wallBorder }]} />
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder }]} />

      {/* Window */}
      <View style={s.window}>
        <View style={[s.windowInner, { backgroundColor: theme.windowSkyColor }]}>
          <View style={s.windowCity}>
            {[{ h: 14, l: 4, w: 8 }, { h: 20, l: 14, w: 6 }, { h: 10, l: 22, w: 10 }, { h: 18, l: 34, w: 7 }, { h: 12, l: 43, w: 9 }, { h: 22, l: 54, w: 5 }]
              .map((b, i) => <View key={i} style={[s.building, { height: b.h, left: b.l, width: b.w, backgroundColor: theme.windowCityColor }]} />)}
          </View>
          {[{ t: 4, l: 10 }, { t: 7, l: 35 }, { t: 3, l: 50 }].map((st, i) => (
            <View key={i} style={[s.star, { top: st.t, left: st.l }]} />
          ))}
        </View>
        <View style={[s.windowFrame, { borderColor: theme.wallBorder }]} />
      </View>

      {/* Clock */}
      <View style={s.clock}><Text style={s.clockText}>⏱</Text></View>

      {/* Fixed desks */}
      {DESK_POSITIONS.map((pos, i) => <Desk key={i} x={pos.x} y={pos.y} theme={theme} />)}

      {/* Fixed decor */}
      <Plant x={740} y={200} size="lg" />
      <Plant x={740} y={380} />
      <Plant x={20} y={570} />
      <CoffeeMachine x={760} y={480} />

      {/* Lounge */}
      <View style={[s.lounge, { borderColor: theme.wallBorder }]}>
        <View style={[s.loungeCouch, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
        <View style={[s.loungeTable, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]} />
        <View style={[s.loungeCouch, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
      </View>

      {/* User-placed furniture */}
      {furniture.map(item => (
        <FurnitureRenderer
          key={item.id}
          item={item}
          theme={theme}
          onPress={() => onFurniturePress?.(item.id)}
          editMode={editMode}
        />
      ))}

      {/* Rug */}
      <View style={[s.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />

      {/* Floor label */}
      <View style={s.floorLabelWrap}>
        <Text style={s.floorLabel}>UNDERGROUND HQ · FLOOR 1</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  floor: { width: FLOOR_W, height: FLOOR_H, position: 'relative', overflow: 'hidden' },
  gridV: { position: 'absolute', top: 0, width: 1, height: FLOOR_H },
  gridH: { position: 'absolute', left: 0, width: FLOOR_W, height: 1 },
  wallTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 190, borderBottomWidth: 2 },
  wallLeft: { position: 'absolute', top: 0, left: 0, width: 8, height: FLOOR_H, borderRightWidth: 1 },
  window: { position: 'absolute', top: 25, right: 180, width: 68, height: 42, zIndex: 2 },
  windowInner: { width: 64, height: 38, marginLeft: 2, marginTop: 2, overflow: 'hidden', position: 'relative' },
  windowCity: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 24 },
  building: { position: 'absolute', bottom: 0, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  star: { position: 'absolute', width: 2, height: 2, backgroundColor: '#ffffff40', borderRadius: 1 },
  windowFrame: { position: 'absolute', top: 0, left: 0, width: 68, height: 42, borderWidth: 2, borderRadius: 1 },
  clock: { position: 'absolute', top: 30, right: 40, zIndex: 2 },
  clockText: { fontSize: 14, color: '#888' },
  desk: { position: 'absolute', width: 90, height: 45 },
  deskTop: { width: 80, height: 26, borderWidth: 1 },
  monitor: { position: 'absolute', top: -16, left: 26, alignItems: 'center' },
  monitorScreen: { width: 24, height: 16, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  monitorStand: { width: 4, height: 3, backgroundColor: '#475569' },
  keyboard: { position: 'absolute', top: 7, left: 24, width: 28, height: 7, backgroundColor: '#1e1e2e', borderWidth: 1 },
  chair: { position: 'absolute', top: 30, left: 26, alignItems: 'center' },
  chairBack: { width: 22, height: 7, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderWidth: 1 },
  chairSeat: { width: 26, height: 5, borderWidth: 1 },
  plant: { position: 'absolute', alignItems: 'center' },
  plantLeaf: { position: 'absolute', borderRadius: 6, top: -8 },
  plantPot: { backgroundColor: '#78350f', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, marginTop: 4 },
  coffeeWrap: { position: 'absolute', alignItems: 'center' },
  coffeeBody: { width: 20, height: 24, backgroundColor: '#374151', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' },
  coffeeTop: { position: 'absolute', top: -4, width: 24, height: 6, backgroundColor: '#4b5563', borderRadius: 2 },
  coffeeCup: { position: 'absolute', bottom: -8, left: 0, width: 10, height: 8, backgroundColor: '#f5f5f4', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  lounge: { position: 'absolute', right: 30, top: 200, width: 120, height: 70, borderWidth: 1, borderRadius: 4, borderStyle: 'dashed', padding: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  loungeCouch: { width: 50, height: 24, borderRadius: 4, borderWidth: 1 },
  loungeTable: { width: 30, height: 20, borderRadius: 2, borderWidth: 1 },
  rug: { position: 'absolute', top: 310, left: 220, width: 160, height: 60, borderWidth: 1, borderRadius: 2, opacity: 0.5 },
  floorLabelWrap: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  floorLabel: { fontSize: 7, color: '#333', fontFamily: 'monospace', letterSpacing: 2 },

  // Placed furniture wrapper
  placedWrap: { position: 'absolute', zIndex: 8 },
  editOverlay: { position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: 7, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  editOverlayX: { color: '#fff', fontSize: 8, fontWeight: '800', lineHeight: 14 },

  // Furniture: plant
  fPlant: { alignItems: 'center', width: 24, height: 28 },
  fPlantLeaf: { position: 'absolute', top: 0, width: 10, height: 12, borderRadius: 6 },
  fPlantPot: { width: 14, height: 10, backgroundColor: '#78350f', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, marginTop: 14 },
  // Furniture: couch
  fCouch: { width: 80, height: 38, borderRadius: 4, borderWidth: 1, position: 'relative' },
  fCouchBack: { position: 'absolute', top: 0, left: 0, right: 0, height: 10, borderRadius: 4, opacity: 0.5 },
  fCouchArmL: { position: 'absolute', left: 0, top: 10, width: 8, height: 28, backgroundColor: '#ffffff20', borderRadius: 2 },
  fCouchArmR: { position: 'absolute', right: 0, top: 10, width: 8, height: 28, backgroundColor: '#ffffff20', borderRadius: 2 },
  fCouchCushion: { position: 'absolute', bottom: 4, left: 10, right: 10, height: 14, borderRadius: 3, opacity: 0.7 },
  // Bean bag
  fBeanBag: { width: 34, height: 30, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fBeanBagInner: { width: 20, height: 18, borderRadius: 10 },
  // Lamp
  fLamp: { alignItems: 'center', width: 20, height: 50 },
  fLampHead: { width: 20, height: 10, borderRadius: 10, borderWidth: 1 },
  fLampPole: { width: 2, height: 30, backgroundColor: '#94a3b8' },
  fLampBase: { width: 14, height: 4, backgroundColor: '#64748b', borderRadius: 2 },
  // Bookshelf
  fShelf: { width: 60, height: 42, borderWidth: 1, padding: 3, gap: 2 },
  fShelfRow: { flexDirection: 'row', gap: 2, flex: 1 },
  fBook: { flex: 1, borderRadius: 1 },
  // TV
  fTV: { alignItems: 'center', width: 80 },
  fTVScreen: { width: 78, height: 46, borderWidth: 2, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fTVGlow: { position: 'absolute', inset: 0 } as any,
  fTVText: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  fTVStand: { width: 6, height: 8, backgroundColor: '#64748b' },
  fTVBase: { width: 24, height: 4, backgroundColor: '#475569', borderRadius: 1 },
  // Server
  fServer: { width: 44, height: 56, borderWidth: 1, padding: 3, gap: 2, borderRadius: 2 },
  fServerUnit: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 10, backgroundColor: '#0f172a', borderRadius: 1, paddingHorizontal: 3 },
  fServerLight: { width: 4, height: 4, borderRadius: 2 },
  fServerBar: { flex: 1, height: 2, backgroundColor: '#1e293b', borderRadius: 1 },
  // Whiteboard
  fWhiteboard: { width: 70, height: 50, borderWidth: 2, borderRadius: 2, padding: 4 },
  fWhiteboardInner: { flex: 1, gap: 4, alignItems: 'center' },
  fWBLine: { height: 1, backgroundColor: '#44444430' },
  fWhiteboardTray: { height: 5, backgroundColor: '#8B7355', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  // Standing desk
  fStandingDesk: { width: 70, height: 55, position: 'relative' },
  fSDTop: { width: 70, height: 22, borderWidth: 1, position: 'relative' },
  fSDMonitor: { position: 'absolute', top: -14, left: 20, width: 24, height: 16, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  fSDKeyboard: { position: 'absolute', top: 6, left: 16, width: 30, height: 7, backgroundColor: '#1e1e2e', borderWidth: 1, borderColor: '#334155' },
  fSDLeg: { position: 'absolute', bottom: 0, left: 8, width: 4, height: 33, backgroundColor: '#64748b' },
  // Coffee
  fCoffeeWrap: { alignItems: 'center', width: 22 },
  fCoffeeBody: { width: 20, height: 24, backgroundColor: '#374151', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' },
  fCoffeeTop: { position: 'absolute', top: -4, width: 24, height: 6, backgroundColor: '#4b5563', borderRadius: 2 },
  fCoffeeCup: { position: 'absolute', bottom: -8, left: 0, width: 10, height: 8, backgroundColor: '#f5f5f4', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  // Water cooler
  fWaterCooler: { alignItems: 'center', width: 22 },
  fWCBottle: { width: 16, height: 14, borderRadius: 4, borderWidth: 1 },
  fWCBody: { width: 22, height: 24, borderRadius: 2, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3 },
  fWCTap: { width: 8, height: 4, borderRadius: 1 },
  // Arcade
  fArcade: { width: 28, height: 48, borderWidth: 1, borderRadius: 2, alignItems: 'center', paddingTop: 4, gap: 4 },
  fArcadeScreen: { width: 22, height: 20, borderWidth: 1, borderRadius: 1, alignItems: 'center', justifyContent: 'center' },
  fArcadeText: { fontSize: 8, fontWeight: '800' },
  fArcadeControls: { flexDirection: 'row', gap: 4 },
  fArcadeBtn: { width: 6, height: 6, borderRadius: 3 },
  // Ping table
  fPingTable: { width: 100, height: 44 },
  fPTSurface: { width: 100, height: 36, borderWidth: 2, borderRadius: 2, position: 'relative' },
  fPTNet: { position: 'absolute', top: 0, bottom: 0, left: 48, width: 2, backgroundColor: '#ffffff60' },
  fPTLine: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: '#ffffff30', margin: 4 },
  fPTLeg: { position: 'absolute', bottom: 0, left: 8, width: 4, height: 8, backgroundColor: '#64748b' },
  // Snack bar
  fSnackBar: { width: 70, height: 40, borderWidth: 1, borderRadius: 2 },
  fSBCounter: { height: 6, backgroundColor: '#ffffff20', borderBottomWidth: 1, borderBottomColor: '#ffffff10' },
  fSBItems: { flexDirection: 'row', gap: 4, padding: 4 },
  fSBIcon: { fontSize: 10 },
  // Neon sign
  fNeonSign: {
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderRadius: 4,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 8px currentColor' } as any : {}),
  },
  fNeonText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 },
  // Trophy shelf
  fTrophy: { width: 54, height: 38, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: 4, paddingBottom: 2 },
  fTrophyItem: { width: 14, height: 20, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fTrophyIcon: { fontSize: 7 },
  // Safe
  fSafe: { width: 32, height: 36, borderWidth: 1, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fSafeDoor: { width: 24, height: 28, borderRadius: 1, borderWidth: 1, borderColor: '#6b7280', alignItems: 'center', justifyContent: 'center', gap: 4 },
  fSafeDial: { width: 10, height: 10, borderRadius: 5 },
  fSafeHandle: { width: 4, height: 10, borderRadius: 2 },
  // Rug
  fRug: { width: 80, height: 50, borderWidth: 1, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fRugInner: { width: 60, height: 34, borderWidth: 1, borderRadius: 1 },
  // Printer
  fPrinter: { width: 44, height: 28, borderWidth: 1, borderRadius: 2 },
  fPrinterSlot: { height: 4, backgroundColor: '#94a3b8', marginHorizontal: 8, marginTop: 8, borderRadius: 1 },
  fPrinterPanel: { flexDirection: 'row', gap: 3, padding: 5 },
  fPrinterBtn: { width: 6, height: 6, borderRadius: 3 },
  // Clock
  fClock: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fClockFace: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#f8fafc', position: 'relative' },
  fClockHour: { position: 'absolute', top: 3, left: 7, width: 2, height: 5, backgroundColor: '#1e293b', borderRadius: 1, transformOrigin: 'bottom' },
  fClockMin: { position: 'absolute', top: 1, left: 7, width: 1, height: 7, backgroundColor: '#475569', borderRadius: 1, transformOrigin: 'bottom' },
  // Window
  fWindow: { width: 60, height: 40, borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  fWindowFrame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: '#ffffff20' },
  fWindowCity: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 20 },
  fWindowBuilding: { position: 'absolute', bottom: 0, width: 9, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
});
