import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Image } from 'react-native';
import { OfficeTheme, OFFICE_THEMES, FurnitureItem, EnvironmentType } from '../../../../lib/officeConfig';
import { THEME_BACKGROUNDS } from '../../../../lib/themeBackgrounds';

const GRID_SIZE = 16;
export const FLOOR_W = 900;
export const FLOOR_H = 970;

  // Advanced Volumetric FX injected
  const renderAtmospherics = () => {
    return (
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, zIndex: 1, pointerEvents: 'none' }}>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.1)', borderTopLeftRadius: 100, transform: [{ scaleY: 0.5 }] }} />
        <View style={{ position: 'absolute', bottom: 20, left: -50, width: 300, height: 80, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 150, transform: [{ scaleX: 2.5 }, { rotate: '15deg' }] }} />
        <View style={{ position: 'absolute', bottom: -10, right: -50, width: 400, height: 100, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 200, transform: [{ scaleX: 3 }, { rotate: '-10deg' }] }} />
      </View>
    );
  };


export const DESK_POSITIONS = [
  { x: 40, y: 260 }, { x: 220, y: 260 }, { x: 400, y: 260 }, { x: 580, y: 260 },
  { x: 40, y: 390 }, { x: 220, y: 390 }, { x: 400, y: 390 }, { x: 580, y: 390 },
  { x: 40, y: 520 }, { x: 220, y: 520 }, { x: 400, y: 520 }, { x: 580, y: 520 },
  { x: 40, y: 650 }, { x: 220, y: 650 }, { x: 400, y: 650 }, { x: 580, y: 650 },
];

interface Props {
  theme?: OfficeTheme;
  furniture?: FurnitureItem[];
  onFloorPress?: (x: number, y: number) => void;
  onFurniturePress?: (id: string) => void;
  onFurnitureMove?: (id: string, x: number, y: number) => void;
  selectedFurnitureId?: string | null;
  editMode?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT: WALLS
// ═══════════════════════════════════════════════════════════════════════════════

function OfficeWall({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: theme.wallColor, borderBottomColor: theme.wallBorder }]} />
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder }]} />
    </>
  );
}

function ShipWall({ theme }: { theme: OfficeTheme }) {
  const planks = Array.from({ length: 10 }, (_, i) => (
    <View key={i} style={{ position: 'absolute' as const, top: i * 19, left: 0, right: 0, height: 18, backgroundColor: theme.wallColor, borderTopWidth: 1, borderTopColor: '#ffffff20', borderBottomWidth: 2, borderBottomColor: theme.wallBorder + '80', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2 }}>
      {/* Wood grain detail — 3 grain lines per plank */}
      <View style={{ position: 'absolute' as const, top: 4, left: (i * 37) % 200, width: 80, height: 1, backgroundColor: theme.wallBorder + '25' }} />
      <View style={{ position: 'absolute' as const, top: 9, left: (i * 53 + 100) % 400, width: 60, height: 1, backgroundColor: theme.wallBorder + '18' }} />
      <View style={{ position: 'absolute' as const, top: 14, left: (i * 71 + 200) % 600, width: 45, height: 1, backgroundColor: theme.wallBorder + '20' }} />
      {/* Knot holes — 1 per other plank */}
      {i % 3 === 0 && <View style={{ position: 'absolute' as const, top: 5, left: 300 + i * 60, width: 8, height: 6, borderRadius: 4, backgroundColor: theme.wallBorder + '30' }} />}
    </View>
  ));
  // Nail/bolt dots — more of them, with highlight
  const nails = [
    { x: 60, y: 10 }, { x: 200, y: 50 }, { x: 400, y: 30 }, { x: 600, y: 70 },
    { x: 150, y: 90 }, { x: 500, y: 120 }, { x: 300, y: 150 }, { x: 700, y: 100 },
    { x: 100, y: 130 }, { x: 350, y: 70 }, { x: 550, y: 150 }, { x: 800, y: 50 },
    { x: 250, y: 10 }, { x: 680, y: 130 }, { x: 450, y: 90 }, { x: 760, y: 30 },
  ];
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: theme.wallColor, overflow: 'hidden' }]}>
        {planks}
        {nails.map((n, i) => (
          <View key={`n${i}`} style={{ position: 'absolute' as const, left: n.x, top: n.y, width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#6b5338' }}>
            {/* Nail highlight */}
            <View style={{ position: 'absolute' as const, top: 0, left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#a08060' }} />
          </View>
        ))}
        {/* Dark shadow strip at bottom of wall */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 4, backgroundColor: '#00000030' }} />
        {/* Rope hanging from ceiling */}
        <View style={{ position: 'absolute' as const, top: 0, left: 520, width: 3, height: 60, backgroundColor: '#a08060' }}>
          <View style={{ position: 'absolute' as const, bottom: 0, width: 8, height: 8, left: -2.5, borderRadius: 4, backgroundColor: '#8b7355' }} />
        </View>
      </View>
      {/* Ship railing left side */}
      <View style={{ position: 'absolute' as const, top: 0, left: 0, width: 14, height: FLOOR_H, backgroundColor: theme.wallColor, borderRightWidth: 2, borderRightColor: theme.wallBorder }}>
        {/* Rail cap */}
        <View style={{ position: 'absolute' as const, top: 188, left: 0, right: 0, height: 4, backgroundColor: theme.deskBorder }} />
        {/* Railing posts */}
        {Array.from({ length: 8 }, (_, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: 192 + i * 60, left: 3, width: 8, height: 44, backgroundColor: theme.deskColor, borderRadius: 2, borderWidth: 1, borderColor: theme.deskBorder }}>
            {/* Post wood grain */}
            <View style={{ position: 'absolute' as const, top: 10, left: 2, width: 3, height: 20, backgroundColor: theme.deskBorder + '20', borderRadius: 1 }} />
          </View>
        ))}
        {/* Shadow on inner edge */}
        <View style={{ position: 'absolute' as const, top: 0, right: 0, width: 2, height: FLOOR_H, backgroundColor: '#00000015' }} />
      </View>
    </>
  );
}

function CastleWall({ theme }: { theme: OfficeTheme }) {
  // Stone block pattern with varied sizes and shading
  const rows = Array.from({ length: 8 }, (_, row) => {
    const offset = row % 2 === 0 ? 0 : 45;
    return Array.from({ length: 12 }, (_, col) => {
      const w = 82 + ((row + col) % 3) * 4;
      return (
        <View key={`${row}-${col}`} style={{
          position: 'absolute' as const, top: row * 24, left: offset + col * 90,
          width: w, height: 22, backgroundColor: theme.wallColor,
          borderTopWidth: 1, borderTopColor: '#ffffff15', borderBottomWidth: 2, borderBottomColor: '#00000060', borderLeftWidth: 1, borderLeftColor: '#ffffff10', borderRightWidth: 1, borderRightColor: '#00000050', borderRadius: 2, shadowColor: '#000', shadowOffset: { width: 1, height: 1 }, shadowOpacity: 0.3,
        }}>
          {/* Stone highlight (top-left) */}
          <View style={{ position: 'absolute' as const, top: 1, left: 1, right: 10, height: 1, backgroundColor: '#ffffff08' }} />
          {/* Stone shadow (bottom-right) */}
          <View style={{ position: 'absolute' as const, bottom: 1, left: 10, right: 1, height: 1, backgroundColor: '#00000015' }} />
          {/* Speckle texture */}
          {(row + col) % 4 === 0 && <View style={{ position: 'absolute' as const, top: 8, left: 20, width: 3, height: 2, backgroundColor: theme.wallBorder + '20', borderRadius: 1 }} />}
          {(row + col) % 5 === 1 && <View style={{ position: 'absolute' as const, top: 12, left: 40, width: 2, height: 2, backgroundColor: '#ffffff06', borderRadius: 1 }} />}
        </View>
      );
    });
  });
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: '#0a0a0a', overflow: 'hidden' }]}>
        {rows}
        {/* Mortar crack details */}
        {[{ x: 180, y: 48, w: 12 }, { x: 420, y: 96, w: 8 }, { x: 650, y: 24, w: 15 }].map((c, i) => (
          <View key={`cr${i}`} style={{ position: 'absolute' as const, left: c.x, top: c.y, width: c.w, height: 1, backgroundColor: '#00000020', transform: [{ rotate: `${-5 + i * 5}deg` }] }} />
        ))}
        {/* Torch sconces on wall — improved with bracket + glow */}
        {[150, 450, 750].map((x, i) => (
          <View key={i} style={{ position: 'absolute' as const, left: x, top: 90, alignItems: 'center' as const }}>
            {/* Torch glow aura */}
            <View style={{ position: 'absolute' as const, top: -8, width: 40, height: 30, borderRadius: 20, backgroundColor: '#ff660008' }} />
            <Text style={{ fontSize: 16 }}>🔥</Text>
            {/* Iron bracket */}
            <View style={{ width: 10, height: 22, backgroundColor: '#333', borderRadius: 1, borderWidth: 1, borderColor: '#555' }}>
              <View style={{ position: 'absolute' as const, top: 4, left: 2, width: 5, height: 1, backgroundColor: '#555' }} />
            </View>
            {/* Wall mount plate */}
            <View style={{ position: 'absolute' as const, bottom: -2, width: 16, height: 4, backgroundColor: '#444', borderRadius: 1 }} />
          </View>
        ))}
        {/* Banner/tapestry between torches */}
        <View style={{ position: 'absolute' as const, left: 280, top: 20 }}>
          <View style={{ width: 2, height: 6, backgroundColor: theme.deskBorder, alignSelf: 'center' as const }} />
          <View style={{ width: 24, height: 40, backgroundColor: theme.accentGlow + '12', borderWidth: 1, borderColor: theme.accentGlow + '25', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            <View style={{ position: 'absolute' as const, top: 8, left: 5, width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: theme.accentGlow + '20' }} />
          </View>
        </View>
        {/* Bottom shadow */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 6, backgroundColor: '#00000025' }} />
      </View>
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder, borderRightWidth: 2 }]}>
        {/* Left wall shadow */}
        <View style={{ position: 'absolute' as const, top: 0, right: 0, width: 2, height: FLOOR_H, backgroundColor: '#00000015' }} />
      </View>
    </>
  );
}

function StationWall({ theme }: { theme: OfficeTheme }) {
  // Metal panels with accent lines, seam details, and panel numbers
  const panels = Array.from({ length: 6 }, (_, i) => (
    <View key={i} style={{
      position: 'absolute' as const, left: i * 150, top: 0, width: 148, height: 188,
      backgroundColor: theme.wallColor, borderWidth: 1, borderColor: theme.wallBorder,
    }}>
      {/* Panel rivets — all 4 corners + midpoints */}
      {[{ x: 4, y: 4 }, { x: 140, y: 4 }, { x: 4, y: 180 }, { x: 140, y: 180 }, { x: 72, y: 4 }, { x: 72, y: 180 }].map((r, j) => (
        <View key={j} style={{ position: 'absolute' as const, left: r.x, top: r.y, width: 4, height: 4, borderRadius: 2, backgroundColor: theme.wallBorder }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 1, width: 2, height: 1, borderRadius: 0.5, backgroundColor: theme.accentGlow + '30' }} />
        </View>
      ))}
      {/* Accent stripe */}
      <View style={{ position: 'absolute' as const, bottom: 20, left: 10, right: 10, height: 2, backgroundColor: theme.accentGlow + '30' }} />
      {/* Panel number ID */}
      <Text style={{ position: 'absolute' as const, top: 8, left: 12, fontSize: 5, color: theme.accentGlow + '25', fontFamily: 'monospace' } as any}>{`SEC-${i + 1}`}</Text>
      {/* Panel seam highlight */}
      <View style={{ position: 'absolute' as const, top: 1, left: 1, right: 40, height: 1, backgroundColor: '#ffffff06' }} />
      {/* Panel shadow bottom */}
      <View style={{ position: 'absolute' as const, bottom: 1, left: 1, right: 1, height: 1, backgroundColor: '#00000020' }} />
      {/* Internal conduit/wiring channel */}
      {i % 2 === 0 && (
        <View style={{ position: 'absolute' as const, top: 80, left: 10, right: 10, height: 6, backgroundColor: '#00000020', borderRadius: 1 }}>
          <View style={{ position: 'absolute' as const, top: 2, left: 4, width: 20, height: 2, backgroundColor: theme.accentGlow + '15', borderRadius: 1 }} />
        </View>
      )}
    </View>
  ));
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: '#020208', overflow: 'hidden' }]}>
        {panels}
        {/* Status lights row — top strip */}
        <View style={{ position: 'absolute' as const, top: 8, left: 20, flexDirection: 'row' as const, gap: 20 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: i % 5 === 0 ? '#ef4444' : i % 3 === 0 ? '#22c55e' : theme.accentGlow + '80' }} />
          ))}
        </View>
        {/* Warning stripe along bottom */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 4, backgroundColor: '#00000040' }}>
          {Array.from({ length: 30 }, (_, i) => (
            <View key={i} style={{ position: 'absolute' as const, left: i * 30, top: 0, width: 15, height: 4, backgroundColor: i % 2 === 0 ? '#f59e0b15' : 'transparent' }} />
          ))}
        </View>
        {/* Ventilation grate */}
        <View style={{ position: 'absolute' as const, top: 140, left: 600, width: 50, height: 30, backgroundColor: '#00000030', borderRadius: 2, borderWidth: 1, borderColor: theme.wallBorder }}>
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={{ position: 'absolute' as const, top: 4 + i * 5, left: 4, right: 4, height: 2, backgroundColor: '#00000040', borderRadius: 1 }} />
          ))}
        </View>
      </View>
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.accentGlow + '20', borderRightWidth: 1 }]}>
        {/* Vertical conduit pipe */}
        <View style={{ position: 'absolute' as const, top: 190, left: 2, width: 4, height: FLOOR_H - 190, backgroundColor: theme.wallBorder }} />
      </View>
    </>
  );
}

function SubmarineWall({ theme }: { theme: OfficeTheme }) {
  // Curved hull with rivet rows and panel details
  const rivets = Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 20 }, (_, col) => (
      <View key={`${row}-${col}`} style={{
        position: 'absolute' as const, top: 10 + row * 38, left: 20 + col * 44,
        width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.wallBorder,
      }}>
        <View style={{ position: 'absolute' as const, top: 0, left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff10' }} />
      </View>
    ))
  );
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: theme.wallColor, overflow: 'hidden', borderBottomWidth: 3, borderBottomColor: theme.wallBorder }]}>
        {rivets}
        {/* Horizontal hull seams — with shadow/highlight */}
        {[60, 120].map((y, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: y, left: 0, right: 0 }}>
            <View style={{ height: 1, backgroundColor: '#00000020' }} />
            <View style={{ height: 2, backgroundColor: theme.wallBorder }} />
            <View style={{ height: 1, backgroundColor: '#ffffff06' }} />
          </View>
        ))}
        {/* Hull plate numbers */}
        {[80, 300, 520, 720].map((x, i) => (
          <Text key={i} style={{ position: 'absolute' as const, left: x, top: 30 + (i % 2) * 60, fontSize: 5, color: theme.wallBorder + '40', fontFamily: 'monospace' } as any}>{`H-${i + 1}0${i + 3}`}</Text>
        ))}
        {/* Pipe with valve */}
        <View style={{ position: 'absolute' as const, top: 168, left: 0, right: 0, height: 10, backgroundColor: theme.deskBorder, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.wallBorder }}>
          {/* Pipe highlight */}
          <View style={{ position: 'absolute' as const, top: 2, left: 0, right: 0, height: 2, backgroundColor: '#ffffff06' }} />
          {/* Valve wheel */}
          <View style={{ position: 'absolute' as const, top: -6, left: 400, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.wallBorder, backgroundColor: 'transparent' }}>
            <View style={{ position: 'absolute' as const, top: 7, left: 2, right: 2, height: 2, backgroundColor: theme.wallBorder }} />
            <View style={{ position: 'absolute' as const, left: 7, top: 2, bottom: 2, width: 2, backgroundColor: theme.wallBorder }} />
          </View>
        </View>
        {/* Pressure gauge */}
        <View style={{ position: 'absolute' as const, top: 30, left: 650, width: 24, height: 24, borderRadius: 12, backgroundColor: '#001810', borderWidth: 2, borderColor: theme.wallBorder }}>
          <View style={{ position: 'absolute' as const, top: 10, left: 10, width: 8, height: 2, backgroundColor: '#22c55e80', transform: [{ rotate: '-30deg' }], transformOrigin: 'left center' }} />
        </View>
        {/* Water stain drip */}
        <View style={{ position: 'absolute' as const, top: 62, left: 240, width: 3, height: 30, backgroundColor: '#ffffff04', borderRadius: 1.5 }} />
        {/* Bottom shadow */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 4, backgroundColor: '#00000020' }} />
      </View>
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder, width: 12, borderRightWidth: 2 }]}>
        {/* Vertical pipe on left wall */}
        <View style={{ position: 'absolute' as const, top: 190, left: 2, width: 4, height: FLOOR_H - 190, backgroundColor: theme.deskBorder }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 0, width: 1, height: FLOOR_H - 190, backgroundColor: '#ffffff08' }} />
        </View>
      </View>
    </>
  );
}

function MansionWall({ theme }: { theme: OfficeTheme }) {
  // Dark wood panels with wainscoting and ornate details
  const panels = Array.from({ length: 8 }, (_, i) => (
    <View key={i} style={{
      position: 'absolute' as const, left: 10 + i * 110, top: 10, width: 100, height: 100,
      backgroundColor: theme.wallColor, borderTopWidth: 1, borderTopColor: '#ffffff15', borderBottomWidth: 2, borderBottomColor: '#00000060', borderLeftWidth: 1, borderLeftColor: '#ffffff10', borderRightWidth: 1, borderRightColor: '#00000050', borderRadius: 2, shadowColor: '#000', shadowOffset: { width: 1, height: 1 }, shadowOpacity: 0.3,
    }}>
      {/* Inner panel frame */}
      <View style={{ margin: 6, flex: 1, borderWidth: 1, borderColor: theme.wallBorder + '60', borderRadius: 1 }}>
        {/* Wood grain within panel */}
        <View style={{ position: 'absolute' as const, top: 15, left: 4, width: 30, height: 1, backgroundColor: theme.wallBorder + '15' }} />
        <View style={{ position: 'absolute' as const, top: 35, left: 12, width: 40, height: 1, backgroundColor: theme.wallBorder + '12' }} />
        <View style={{ position: 'absolute' as const, top: 55, left: 8, width: 25, height: 1, backgroundColor: theme.wallBorder + '10' }} />
      </View>
      {/* Panel highlight (top edge) */}
      <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
      {/* Panel shadow (bottom edge) */}
      <View style={{ position: 'absolute' as const, bottom: 1, left: 2, right: 2, height: 1, backgroundColor: '#00000015' }} />
    </View>
  ));
  // Wainscoting lower panels
  const lowerPanels = Array.from({ length: 12 }, (_, i) => (
    <View key={`lp${i}`} style={{
      position: 'absolute' as const, left: 8 + i * 74, top: 126, width: 70, height: 54,
      backgroundColor: theme.wallColor, borderWidth: 1, borderColor: theme.wallBorder + '50', borderRadius: 1,
    }}>
      <View style={{ margin: 4, flex: 1, borderWidth: 1, borderColor: theme.wallBorder + '30', borderRadius: 1 }} />
    </View>
  ));
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: theme.wallColor, overflow: 'hidden', borderBottomWidth: 2, borderBottomColor: theme.wallBorder }]}>
        {panels}
        {lowerPanels}
        {/* Crown molding — double layer */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 4, backgroundColor: theme.deskColor }}>
          <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1, backgroundColor: '#ffffff08' }} />
        </View>
        <View style={{ position: 'absolute' as const, top: 4, left: 0, right: 0, height: 3, backgroundColor: theme.deskBorder }}>
          <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1, backgroundColor: '#00000020' }} />
        </View>
        {/* Chair rail / wainscoting rail */}
        <View style={{ position: 'absolute' as const, top: 120, left: 0, right: 0, height: 4, backgroundColor: theme.deskColor }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 1, backgroundColor: '#ffffff06' }} />
          <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1, backgroundColor: '#00000015' }} />
        </View>
        {/* Wallpaper pattern in upper section (subtle damask) */}
        {Array.from({ length: 6 }, (_, i) => (
          <View key={`wp${i}`} style={{ position: 'absolute' as const, top: 50, left: 60 + i * 150, width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: theme.wallBorder + '10', backgroundColor: 'transparent' }} />
        ))}
        {/* Bottom shadow */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 4, backgroundColor: '#00000020' }} />
      </View>
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder, borderRightWidth: 1 }]}>
        <View style={{ position: 'absolute' as const, top: 0, right: 0, width: 2, height: FLOOR_H, backgroundColor: '#00000015' }} />
      </View>
    </>
  );
}

function LairWall({ theme }: { theme: OfficeTheme }) {
  // Rough rock/obsidian with cracks and lava veins
  const rocks = Array.from({ length: 20 }, (_, i) => {
    const x = (i * 47 + (i % 5) * 30) % 880;
    const y = (i * 23 + (i % 4) * 18) % 175;
    const w = 30 + (i % 4) * 18;
    const h = 16 + (i % 3) * 12;
    return (
      <View key={i} style={{
        position: 'absolute' as const, left: x, top: y, width: w, height: h,
        backgroundColor: theme.wallColor, borderWidth: 1, borderColor: theme.wallBorder,
        borderRadius: 2 + (i % 4),
      }}>
        {/* Rock highlight */}
        <View style={{ position: 'absolute' as const, top: 1, left: 1, width: w * 0.5, height: 1, backgroundColor: '#ffffff06', borderRadius: 1 }} />
        {/* Rock shadow */}
        <View style={{ position: 'absolute' as const, bottom: 1, right: 1, width: w * 0.4, height: 1, backgroundColor: '#00000020', borderRadius: 1 }} />
      </View>
    );
  });
  // Lava glow cracks — more of them, branching
  const cracks = [
    { x: 80, y: 70, w: 70, r: -12 }, { x: 130, y: 78, w: 40, r: 20 },
    { x: 300, y: 100, w: 55, r: -8 }, { x: 340, y: 96, w: 30, r: 35 },
    { x: 520, y: 60, w: 80, r: -5 }, { x: 570, y: 55, w: 25, r: 40 },
    { x: 700, y: 110, w: 60, r: -15 }, { x: 740, y: 105, w: 35, r: 25 },
    { x: 200, y: 140, w: 50, r: 10 }, { x: 450, y: 35, w: 45, r: -20 },
  ];
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: '#0a0000', overflow: 'hidden', borderBottomWidth: 2, borderBottomColor: theme.wallBorder }]}>
        {rocks}
        {/* Lava glow cracks with outer glow */}
        {cracks.map((c, i) => (
          <View key={`c${i}`} style={{ position: 'absolute' as const, left: c.x, top: c.y }}>
            {/* Outer glow */}
            <View style={{ position: 'absolute' as const, top: -2, left: -2, width: c.w + 4, height: 6, backgroundColor: theme.accentGlow + '10', borderRadius: 3, transform: [{ rotate: `${c.r}deg` }] }} />
            {/* Core crack */}
            <View style={{ width: c.w, height: 2, backgroundColor: theme.accentGlow + '70', borderRadius: 1, transform: [{ rotate: `${c.r}deg` }] }} />
          </View>
        ))}
        {/* Stalactites hanging from top */}
        {[50, 180, 340, 500, 660, 820].map((x, i) => {
          const h = 12 + (i % 3) * 8;
          return (
            <View key={`st${i}`} style={{ position: 'absolute' as const, top: 0, left: x, width: 4 + (i % 2) * 2, height: h, backgroundColor: theme.wallColor, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, borderWidth: 1, borderTopWidth: 0, borderColor: theme.wallBorder }}>
              {/* Drip */}
              {i % 2 === 0 && <View style={{ position: 'absolute' as const, bottom: -3, left: 1, width: 2, height: 3, backgroundColor: theme.accentGlow + '20', borderRadius: 1 }} />}
            </View>
          );
        })}
        {/* Heat haze glow at bottom */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 10, backgroundColor: theme.accentGlow + '08' }} />
      </View>
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.accentGlow + '25', borderRightWidth: 2 }]}>
        {/* Lava vein on left wall */}
        <View style={{ position: 'absolute' as const, top: 250, left: 2, width: 2, height: 80, backgroundColor: theme.accentGlow + '30', borderRadius: 1 }} />
      </View>
    </>
  );
}

function CabinWall({ theme }: { theme: OfficeTheme }) {
  // Horizontal logs with rounded log-end detail and rich grain
  const logs = Array.from({ length: 10 }, (_, i) => (
    <View key={i} style={{
      position: 'absolute' as const, top: i * 19, left: 0, right: 0, height: 18,
      backgroundColor: theme.wallColor, borderTopWidth: 1, borderTopColor: '#ffffff20', borderBottomWidth: 2, borderBottomColor: theme.wallBorder + '80', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2,
      borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.deskColor,
    }}>
      {/* Rich wood grain lines — 5 per log */}
      <View style={{ position: 'absolute' as const, top: 3, left: (i * 40) % 200, width: 70, height: 1, backgroundColor: theme.deskColor + '25' }} />
      <View style={{ position: 'absolute' as const, top: 6, left: (i * 60 + 100) % 400, width: 55, height: 1, backgroundColor: theme.wallBorder + '15' }} />
      <View style={{ position: 'absolute' as const, top: 9, left: (i * 80 + 200) % 600, width: 80, height: 1, backgroundColor: theme.deskColor + '18' }} />
      <View style={{ position: 'absolute' as const, top: 12, left: (i * 35 + 300) % 500, width: 45, height: 1, backgroundColor: theme.wallBorder + '12' }} />
      <View style={{ position: 'absolute' as const, top: 15, left: (i * 50 + 50) % 350, width: 60, height: 1, backgroundColor: theme.deskColor + '20' }} />
      {/* Knot in log */}
      {i % 3 === 1 && <View style={{ position: 'absolute' as const, top: 4, left: 400 + i * 30, width: 10, height: 8, borderRadius: 5, backgroundColor: theme.wallBorder + '25', borderWidth: 1, borderColor: theme.wallBorder + '15' }} />}
      {/* Log highlight (top edge = rounded log look) */}
      <View style={{ position: 'absolute' as const, top: 1, left: 0, right: 0, height: 2, backgroundColor: '#ffffff06' }} />
      {/* Log shadow (bottom edge) */}
      <View style={{ position: 'absolute' as const, bottom: 1, left: 0, right: 0, height: 2, backgroundColor: '#00000010' }} />
    </View>
  ));
  return (
    <>
      <View style={[s.wallTop, { backgroundColor: theme.wallColor, overflow: 'hidden', borderBottomWidth: 2, borderBottomColor: theme.wallBorder }]}>
        {logs}
        {/* Log end circles on right side of wall (where logs meet corner) */}
        {Array.from({ length: 10 }, (_, i) => (
          <View key={`le${i}`} style={{
            position: 'absolute' as const, top: i * 19 + 2, right: 4, width: 14, height: 14, borderRadius: 7,
            backgroundColor: theme.wallBorder + '30', borderWidth: 1, borderColor: theme.wallBorder + '50',
          }}>
            {/* Growth rings */}
            <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: theme.wallBorder + '25', backgroundColor: 'transparent' }} />
            <View style={{ position: 'absolute' as const, top: 5, left: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: theme.wallBorder + '20' }} />
          </View>
        ))}
        {/* Mounted antlers */}
        <View style={{ position: 'absolute' as const, top: 30, left: 400, alignItems: 'center' as const }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.deskColor, borderWidth: 1, borderColor: theme.deskBorder }} />
        </View>
      </View>
      <View style={[s.wallLeft, { backgroundColor: theme.wallColor, borderRightColor: theme.wallBorder, borderRightWidth: 2, width: 12 }]}>
        {/* Corner notch details */}
        {Array.from({ length: 10 }, (_, i) => (
          <View key={`cn${i}`} style={{ position: 'absolute' as const, top: i * 19 + 2, left: 1, width: 10, height: 14, backgroundColor: theme.wallBorder + '15', borderRadius: 2 }} />
        ))}
      </View>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT: WINDOWS
// ═══════════════════════════════════════════════════════════════════════════════

function OfficeWindow({ theme }: { theme: OfficeTheme }) {
  return (
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
  );
}

function ShipPorthole({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 25, right: 155, width: 70, height: 70, zIndex: 2 }}>
      {/* Porthole outer ring shadow */}
      <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 64, height: 64, borderRadius: 32, backgroundColor: '#00000030' }} />
      {/* Round porthole */}
      <View style={{
        width: 64, height: 64, borderRadius: 32, borderWidth: 5, borderColor: '#8b7355',
        backgroundColor: theme.windowSkyColor, overflow: 'hidden' as const,
      }}>
        {/* Inner ring bevel */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, borderRadius: 27, borderWidth: 1, borderColor: '#a0906040' }} />
        {/* Moon with craters */}
        <View style={{ position: 'absolute' as const, top: 5, right: 10, width: 12, height: 12, borderRadius: 6, backgroundColor: '#f0e68c' }}>
          <View style={{ position: 'absolute' as const, top: 3, left: 2, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#e0d67c' }} />
          <View style={{ position: 'absolute' as const, top: 7, left: 6, width: 2, height: 2, borderRadius: 1, backgroundColor: '#d8ce70' }} />
        </View>
        {/* Stars */}
        {[{ x: 6, y: 4 }, { x: 20, y: 8 }, { x: 38, y: 3 }].map((st, i) => (
          <View key={`s${i}`} style={{ position: 'absolute' as const, left: st.x, top: st.y, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff50' }} />
        ))}
        {/* Ocean waves — layered with depth */}
        <View style={{ position: 'absolute' as const, top: 28, left: -4, width: 72, height: 10, backgroundColor: '#1e3a5f', borderTopLeftRadius: 20, borderTopRightRadius: 16 }} />
        <View style={{ position: 'absolute' as const, top: 33, left: -4, width: 72, height: 10, backgroundColor: '#153050', borderTopLeftRadius: 16, borderTopRightRadius: 24 }} />
        <View style={{ position: 'absolute' as const, top: 38, left: -4, width: 72, height: 30, backgroundColor: '#0c2040' }} />
        {/* Wave foam / whitecaps */}
        <View style={{ position: 'absolute' as const, top: 27, left: 4, width: 14, height: 2, backgroundColor: '#ffffff35', borderRadius: 1 }} />
        <View style={{ position: 'absolute' as const, top: 30, left: 28, width: 10, height: 2, backgroundColor: '#ffffff25', borderRadius: 1 }} />
        <View style={{ position: 'absolute' as const, top: 32, left: 8, width: 8, height: 1, backgroundColor: '#ffffff15', borderRadius: 0.5 }} />
        {/* Water reflection */}
        <View style={{ position: 'absolute' as const, top: 40, right: 10, width: 2, height: 8, backgroundColor: '#f0e68c15', borderRadius: 1 }} />
        {/* Glass reflection arc */}
        <View style={{ position: 'absolute' as const, top: 3, left: 4, width: 20, height: 10, borderRadius: 10, backgroundColor: '#ffffff08' }} />
      </View>
      {/* Porthole bolts — 8 bolts around the ring */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const cx = 32 + Math.cos(rad) * 28;
        const cy = 32 + Math.sin(rad) * 28;
        return (
          <View key={i} style={{ position: 'absolute' as const, left: cx - 2.5, top: cy - 2.5, width: 6, height: 6, borderRadius: 3, backgroundColor: '#5a4328' }}>
            <View style={{ position: 'absolute' as const, top: 1, left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#8b7355' }} />
          </View>
        );
      })}
      {/* Second porthole — smaller, further along the wall */}
      <View style={{ position: 'absolute' as const, top: 5, right: -120, width: 40, height: 40 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: '#8b7355',
          backgroundColor: theme.windowSkyColor, overflow: 'hidden' as const,
        }}>
          <View style={{ position: 'absolute' as const, top: 16, left: -2, width: 40, height: 20, backgroundColor: '#153050' }} />
          <View style={{ position: 'absolute' as const, top: 15, left: 4, width: 8, height: 1, backgroundColor: '#ffffff20', borderRadius: 0.5 }} />
        </View>
        {[0, 90, 180, 270].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          return <View key={i} style={{ position: 'absolute' as const, left: 18 + Math.cos(rad) * 16 - 2, top: 18 + Math.sin(rad) * 16 - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: '#5a4328' }} />;
        })}
      </View>
    </View>
  );
}

function CastleWindow({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 10, right: 165, width: 56, height: 80, zIndex: 2 }}>
      {/* Window shadow */}
      <View style={{ position: 'absolute' as const, top: 3, left: 5, width: 50, height: 74, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#00000030' }} />
      {/* Stone sill */}
      <View style={{ position: 'absolute' as const, bottom: -4, left: -2, width: 60, height: 6, backgroundColor: theme.wallBorder, borderRadius: 1 }}>
        <View style={{ position: 'absolute' as const, top: 0, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
      </View>
      {/* Arched window */}
      <View style={{
        width: 50, height: 72, borderTopLeftRadius: 25, borderTopRightRadius: 25,
        borderWidth: 3, borderColor: theme.wallBorder, backgroundColor: theme.windowSkyColor,
        overflow: 'hidden' as const, marginLeft: 3,
      }}>
        {/* Moon with glow */}
        <View style={{ position: 'absolute' as const, top: 6, right: 8 }}>
          <View style={{ position: 'absolute' as const, top: -4, left: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#e8e0c010' }} />
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#e8e0c0' }}>
            <View style={{ position: 'absolute' as const, top: 3, left: 2, width: 2, height: 2, borderRadius: 1, backgroundColor: '#d8d0b0' }} />
          </View>
        </View>
        {/* Stars — more of them */}
        {[{ t: 5, l: 6 }, { t: 12, l: 26 }, { t: 8, l: 16 }, { t: 18, l: 8 }, { t: 15, l: 36 }].map((p, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: p.t, left: p.l, width: i % 2 === 0 ? 2 : 1, height: i % 2 === 0 ? 2 : 1, borderRadius: 1, backgroundColor: i % 3 === 0 ? '#ffffff60' : '#ffffff35' }} />
        ))}
        {/* Rolling hills — layered */}
        <View style={{ position: 'absolute' as const, bottom: 6, left: -4, width: 58, height: 18, backgroundColor: theme.windowCityColor + '80', borderTopLeftRadius: 30, borderTopRightRadius: 24 }} />
        <View style={{ position: 'absolute' as const, bottom: 0, left: -4, width: 58, height: 22, backgroundColor: theme.windowCityColor, borderTopLeftRadius: 28, borderTopRightRadius: 18 }} />
        <View style={{ position: 'absolute' as const, bottom: 0, right: -4, width: 34, height: 16, backgroundColor: theme.windowCityColor, borderTopLeftRadius: 22 }} />
        {/* Castle tower silhouette in distance */}
        <View style={{ position: 'absolute' as const, bottom: 18, left: 10, width: 4, height: 10, backgroundColor: theme.windowCityColor + '90' }}>
          <View style={{ position: 'absolute' as const, top: -3, left: -1, width: 6, height: 4, backgroundColor: theme.windowCityColor + '90', borderTopLeftRadius: 1, borderTopRightRadius: 1 }} />
        </View>
        {/* Moonlight reflection on glass */}
        <View style={{ position: 'absolute' as const, top: 2, left: 8, width: 16, height: 8, borderRadius: 8, backgroundColor: '#ffffff05' }} />
      </View>
      {/* Mullion cross — vertical + horizontal */}
      <View style={{ position: 'absolute' as const, top: 24, left: 27, width: 2, height: 50, backgroundColor: theme.wallBorder }} />
      <View style={{ position: 'absolute' as const, top: 42, left: 6, width: 44, height: 2, backgroundColor: theme.wallBorder }} />
      {/* Second smaller window */}
      <View style={{ position: 'absolute' as const, top: 8, right: -90, width: 30, height: 50 }}>
        <View style={{
          width: 28, height: 46, borderTopLeftRadius: 14, borderTopRightRadius: 14,
          borderWidth: 2, borderColor: theme.wallBorder, backgroundColor: theme.windowSkyColor,
          overflow: 'hidden' as const, marginLeft: 1,
        }}>
          <View style={{ position: 'absolute' as const, bottom: 0, left: -2, width: 32, height: 14, backgroundColor: theme.windowCityColor, borderTopLeftRadius: 16 }} />
          <View style={{ position: 'absolute' as const, top: 6, left: 8, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff40' }} />
        </View>
        <View style={{ position: 'absolute' as const, top: 20, left: 15, width: 1, height: 26, backgroundColor: theme.wallBorder }} />
      </View>
    </View>
  );
}

function StationViewport({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 15, right: 130, width: 120, height: 60, zIndex: 2 }}>
      {/* Viewport frame — outer bezel */}
      <View style={{
        width: 116, height: 56, borderWidth: 3, borderColor: theme.wallBorder,
        backgroundColor: '#000008', overflow: 'hidden' as const, borderRadius: 3, marginLeft: 2,
      }}>
        {/* Inner frame bevel */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 1, backgroundColor: '#ffffff08' }} />
        {/* Star field — dense */}
        {Array.from({ length: 25 }, (_, i) => (
          <View key={i} style={{
            position: 'absolute' as const,
            top: (i * 7 + i * i * 2) % 48, left: (i * 11 + i * 4) % 108,
            width: i % 5 === 0 ? 3 : i % 3 === 0 ? 2 : 1,
            height: i % 5 === 0 ? 3 : i % 3 === 0 ? 2 : 1,
            borderRadius: 1.5, backgroundColor: '#ffffff' + (i % 4 === 0 ? '90' : i % 2 === 0 ? '60' : '30'),
          }} />
        ))}
        {/* Nebula cloud */}
        <View style={{ position: 'absolute' as const, top: 8, left: 20, width: 30, height: 15, borderRadius: 8, backgroundColor: theme.accentGlow + '06' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 28, width: 18, height: 8, borderRadius: 4, backgroundColor: '#a855f708' }} />
        {/* Planet with ring and atmosphere */}
        <View style={{ position: 'absolute' as const, bottom: 2, right: 10 }}>
          {/* Planet atmosphere glow */}
          <View style={{ position: 'absolute' as const, top: -2, left: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.accentGlow + '08' }} />
          <View style={{
            width: 20, height: 20, borderRadius: 10,
            backgroundColor: theme.accentGlow + '35', borderWidth: 1, borderColor: theme.accentGlow + '50',
          }}>
            {/* Surface details */}
            <View style={{ position: 'absolute' as const, top: 5, left: 3, width: 8, height: 3, borderRadius: 1.5, backgroundColor: theme.accentGlow + '20' }} />
            <View style={{ position: 'absolute' as const, top: 11, left: 6, width: 6, height: 2, borderRadius: 1, backgroundColor: theme.accentGlow + '15' }} />
            {/* Planet shadow (terminator line) */}
            <View style={{ position: 'absolute' as const, top: 0, right: 0, width: 8, height: 20, borderTopRightRadius: 10, borderBottomRightRadius: 10, backgroundColor: '#00000030' }} />
          </View>
          {/* Planet ring */}
          <View style={{ position: 'absolute' as const, top: 8, left: -8, width: 36, height: 5, borderRadius: 2.5, backgroundColor: theme.accentGlow + '18' }}>
            <View style={{ position: 'absolute' as const, top: 1, left: 4, right: 4, height: 1, backgroundColor: theme.accentGlow + '10' }} />
          </View>
        </View>
        {/* Distant ship / satellite */}
        <View style={{ position: 'absolute' as const, top: 10, left: 70 }}>
          <View style={{ width: 6, height: 2, backgroundColor: '#ffffff60' }} />
          <View style={{ position: 'absolute' as const, top: -2, left: 2, width: 2, height: 6, backgroundColor: '#ffffff30' }} />
        </View>
        {/* Scan lines (CRT effect) */}
        {Array.from({ length: 14 }, (_, i) => (
          <View key={`sc${i}`} style={{ position: 'absolute' as const, top: i * 4, left: 0, right: 0, height: 1, backgroundColor: theme.accentGlow + '04' }} />
        ))}
        {/* HUD overlay — corner brackets */}
        <View style={{ position: 'absolute' as const, top: 2, left: 2, width: 8, height: 8, borderLeftWidth: 1, borderTopWidth: 1, borderColor: theme.accentGlow + '20' }} />
        <View style={{ position: 'absolute' as const, top: 2, right: 2, width: 8, height: 8, borderRightWidth: 1, borderTopWidth: 1, borderColor: theme.accentGlow + '20' }} />
        <View style={{ position: 'absolute' as const, bottom: 2, left: 2, width: 8, height: 8, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: theme.accentGlow + '20' }} />
        <View style={{ position: 'absolute' as const, bottom: 2, right: 2, width: 8, height: 8, borderRightWidth: 1, borderBottomWidth: 1, borderColor: theme.accentGlow + '20' }} />
      </View>
      {/* Status text below viewport */}
      <Text style={{ fontSize: 5, color: theme.accentGlow + '30', fontFamily: 'monospace', textAlign: 'center' as const, marginTop: 2 } as any}>SECTOR 7-G · ALL SYSTEMS NOMINAL</Text>
    </View>
  );
}

function SubmarinePorthole({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 25, right: 155, width: 70, height: 70, zIndex: 2 }}>
      {/* Shadow behind porthole */}
      <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 64, height: 64, borderRadius: 32, backgroundColor: '#00000030' }} />
      <View style={{
        width: 64, height: 64, borderRadius: 32, borderWidth: 5, borderColor: theme.wallBorder,
        backgroundColor: '#001828', overflow: 'hidden' as const,
      }}>
        {/* Water gradient layers */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 20, backgroundColor: '#002840' }} />
        <View style={{ position: 'absolute' as const, top: 20, left: 0, right: 0, height: 20, backgroundColor: '#001828' }} />
        <View style={{ position: 'absolute' as const, top: 40, left: 0, right: 0, height: 24, backgroundColor: '#001020' }} />
        {/* Light rays from above */}
        <View style={{ position: 'absolute' as const, top: 0, left: 15, width: 8, height: 30, backgroundColor: '#ffffff05', transform: [{ rotate: '10deg' }] }} />
        <View style={{ position: 'absolute' as const, top: 0, left: 30, width: 6, height: 25, backgroundColor: '#ffffff04', transform: [{ rotate: '-5deg' }] }} />
        {/* Seaweed — more detailed with fronds */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 4, width: 4, height: 22, backgroundColor: '#166534', borderTopLeftRadius: 8, borderTopRightRadius: 4 }}>
          <View style={{ position: 'absolute' as const, top: 4, left: -3, width: 4, height: 8, backgroundColor: '#15803d', borderRadius: 4, transform: [{ rotate: '-20deg' }] }} />
        </View>
        <View style={{ position: 'absolute' as const, bottom: 0, left: 12, width: 3, height: 18, backgroundColor: '#15803d', borderTopLeftRadius: 4, borderTopRightRadius: 8 }} />
        <View style={{ position: 'absolute' as const, bottom: 0, left: 42, width: 3, height: 14, backgroundColor: '#166534', borderTopLeftRadius: 6 }} />
        {/* Fish */}
        <Text style={{ position: 'absolute' as const, top: 10, right: 6, fontSize: 10 }}>🐟</Text>
        <Text style={{ position: 'absolute' as const, top: 28, left: 22, fontSize: 8 }}>🐠</Text>
        {/* Jellyfish */}
        <View style={{ position: 'absolute' as const, top: 18, left: 34 }}>
          <View style={{ width: 6, height: 4, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#a855f720' }} />
          <View style={{ width: 1, height: 6, backgroundColor: '#a855f715', marginLeft: 2 }} />
        </View>
        {/* Bubbles — more, varied sizes */}
        {[{ x: 28, y: 6, s: 5 }, { x: 35, y: 12, s: 3 }, { x: 31, y: 20, s: 4 }, { x: 38, y: 26, s: 2 }, { x: 20, y: 16, s: 2 }, { x: 44, y: 8, s: 3 }].map((b, i) => (
          <View key={i} style={{
            position: 'absolute' as const, left: b.x, top: b.y,
            width: b.s, height: b.s, borderRadius: b.s / 2,
            backgroundColor: '#ffffff15', borderWidth: 1, borderColor: '#ffffff0a',
          }}>
            {/* Bubble highlight */}
            <View style={{ position: 'absolute' as const, top: 0, left: 1, width: Math.max(1, b.s - 2), height: 1, borderRadius: 0.5, backgroundColor: '#ffffff15' }} />
          </View>
        ))}
        {/* Sandy bottom with shells */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 8, backgroundColor: '#8b735530', borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>
          <View style={{ position: 'absolute' as const, bottom: 1, left: 20, width: 4, height: 3, borderRadius: 2, backgroundColor: '#d4b48030' }} />
          <View style={{ position: 'absolute' as const, bottom: 2, right: 12, width: 3, height: 2, borderRadius: 1, backgroundColor: '#f5deb330' }} />
        </View>
        {/* Glass reflection */}
        <View style={{ position: 'absolute' as const, top: 2, left: 4, width: 18, height: 8, borderRadius: 6, backgroundColor: '#ffffff06' }} />
      </View>
      {/* Bolts — 8 around the ring */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <View key={i} style={{ position: 'absolute' as const, left: 32 + Math.cos(rad) * 28 - 2.5, top: 32 + Math.sin(rad) * 28 - 2.5, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.wallBorder }}>
            <View style={{ position: 'absolute' as const, top: 0, left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff10' }} />
          </View>
        );
      })}
    </View>
  );
}

function MansionWindow({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 10, right: 165, width: 56, height: 80, zIndex: 2 }}>
      {/* Shadow */}
      <View style={{ position: 'absolute' as const, top: 3, left: 5, width: 50, height: 74, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#00000040' }} />
      {/* Window sill */}
      <View style={{ position: 'absolute' as const, bottom: -4, left: -2, width: 60, height: 6, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
      {/* Gothic arched window */}
      <View style={{
        width: 50, height: 72, borderTopLeftRadius: 25, borderTopRightRadius: 25,
        borderWidth: 2, borderColor: theme.wallBorder, backgroundColor: '#060010',
        overflow: 'hidden' as const, marginLeft: 3,
      }}>
        {/* Eerie sky gradient */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 30, backgroundColor: '#0a0020' }} />
        {/* Pale moon with halo */}
        <View style={{ position: 'absolute' as const, top: 4, right: 6 }}>
          <View style={{ position: 'absolute' as const, top: -6, left: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: '#c0b0a008' }} />
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#c0b0a050' }}>
            <View style={{ position: 'absolute' as const, top: 4, left: 3, width: 3, height: 2, borderRadius: 1, backgroundColor: '#b0a09040' }} />
          </View>
        </View>
        {/* Stars */}
        {[{ t: 6, l: 6 }, { t: 14, l: 20 }, { t: 10, l: 32 }].map((p, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: p.t, left: p.l, width: 1, height: 1, borderRadius: 0.5, backgroundColor: '#ffffff30' }} />
        ))}
        {/* Dead tree silhouette — more detailed */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 8, width: 3, height: 34, backgroundColor: '#120018' }}>
          {/* Branches */}
          <View style={{ position: 'absolute' as const, top: 4, left: 1, width: 14, height: 2, backgroundColor: '#120018', transform: [{ rotate: '-30deg' }], transformOrigin: 'left center' }} />
          <View style={{ position: 'absolute' as const, top: 8, left: 1, width: 10, height: 2, backgroundColor: '#120018', transform: [{ rotate: '25deg' }], transformOrigin: 'left center' }} />
          <View style={{ position: 'absolute' as const, top: 14, left: 1, width: 8, height: 1, backgroundColor: '#120018', transform: [{ rotate: '-35deg' }], transformOrigin: 'left center' }} />
          <View style={{ position: 'absolute' as const, top: 10, left: -8, width: 10, height: 1, backgroundColor: '#120018', transform: [{ rotate: '15deg' }] }} />
          {/* Twig sub-branches */}
          <View style={{ position: 'absolute' as const, top: 2, left: 10, width: 6, height: 1, backgroundColor: '#120018', transform: [{ rotate: '-50deg' }], transformOrigin: 'left center' }} />
        </View>
        {/* Iron fence silhouette at bottom */}
        <View style={{ position: 'absolute' as const, bottom: 6, left: 0, right: 0, height: 8 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={{ position: 'absolute' as const, bottom: 0, left: 2 + i * 6, width: 2, height: 6 + (i % 2) * 2, backgroundColor: '#0d0010' }}>
              <View style={{ position: 'absolute' as const, top: -1, left: -1, width: 4, height: 2, backgroundColor: '#0d0010', borderRadius: 1 }} />
            </View>
          ))}
        </View>
        {/* Ground */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 6, backgroundColor: '#0d0010' }} />
        {/* Fog/mist layer */}
        <View style={{ position: 'absolute' as const, bottom: 4, left: 0, right: 0, height: 6, backgroundColor: '#ffffff04', borderRadius: 3 }} />
        {/* Bats */}
        <Text style={{ position: 'absolute' as const, top: 18, left: 4, fontSize: 6 }}>🦇</Text>
        <Text style={{ position: 'absolute' as const, top: 14, left: 22, fontSize: 5 }}>🦇</Text>
      </View>
      {/* Gothic tracery at top of arch */}
      <View style={{ position: 'absolute' as const, top: 4, left: 14, width: 28, height: 14 }}>
        <View style={{ position: 'absolute' as const, bottom: 0, left: 13, width: 2, height: 14, backgroundColor: theme.wallBorder }} />
      </View>
    </View>
  );
}

function LairWindow({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 25, right: 160, width: 70, height: 60, zIndex: 2 }}>
      {/* Irregular crack opening in rock */}
      <View style={{
        width: 60, height: 50, backgroundColor: '#000', overflow: 'hidden' as const,
        borderWidth: 2, borderColor: theme.wallBorder, borderRadius: 4,
      }}>
        {/* Deep lava glow — gradient layers */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.accentGlow + '15' }} />
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 30, backgroundColor: theme.accentGlow + '25' }} />
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 18, backgroundColor: theme.accentGlow + '40' }} />
        {/* Lava surface with bright spots */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 10, backgroundColor: theme.accentGlow + '60' }}>
          {/* Hot spots */}
          <View style={{ position: 'absolute' as const, top: 2, left: 8, width: 12, height: 4, borderRadius: 2, backgroundColor: '#fbbf2480' }} />
          <View style={{ position: 'absolute' as const, top: 3, right: 10, width: 8, height: 3, borderRadius: 1.5, backgroundColor: '#fbbf2460' }} />
          <View style={{ position: 'absolute' as const, top: 1, left: 28, width: 6, height: 4, borderRadius: 2, backgroundColor: '#ffffff30' }} />
        </View>
        {/* Lava bubble popping */}
        <View style={{ position: 'absolute' as const, bottom: 12, left: 18, width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf2440', borderWidth: 1, borderColor: '#fbbf2430' }} />
        {/* Rock edges (irregular frame within) */}
        <View style={{ position: 'absolute' as const, top: 0, left: 0, width: 8, height: 20, backgroundColor: '#0a0000', borderBottomRightRadius: 8 }} />
        <View style={{ position: 'absolute' as const, top: 0, right: 0, width: 6, height: 15, backgroundColor: '#0a0000', borderBottomLeftRadius: 6 }} />
        <View style={{ position: 'absolute' as const, bottom: 0, right: 0, width: 10, height: 8, backgroundColor: '#0a0000', borderTopLeftRadius: 6 }} />
        {/* Smoke wisps rising */}
        {[{ x: 10, y: 4, w: 8, h: 8 }, { x: 28, y: 2, w: 6, h: 10 }, { x: 40, y: 6, w: 5, h: 6 }].map((s2, i) => (
          <View key={i} style={{ position: 'absolute' as const, left: s2.x, top: s2.y, width: s2.w, height: s2.h, borderRadius: s2.w / 2, backgroundColor: '#ffffff06' }} />
        ))}
        {/* Heat shimmer lines */}
        <View style={{ position: 'absolute' as const, bottom: 20, left: 6, width: 20, height: 1, backgroundColor: theme.accentGlow + '15', transform: [{ rotate: '3deg' }] }} />
        <View style={{ position: 'absolute' as const, bottom: 24, left: 20, width: 16, height: 1, backgroundColor: theme.accentGlow + '10', transform: [{ rotate: '-2deg' }] }} />
      </View>
      {/* Crack edges — jagged rock frame */}
      <View style={{ position: 'absolute' as const, top: -2, left: 20, width: 20, height: 4, backgroundColor: theme.wallColor, borderRadius: 2 }} />
      <View style={{ position: 'absolute' as const, bottom: -2, left: 10, width: 30, height: 3, backgroundColor: theme.wallColor, borderRadius: 1.5 }} />
      {/* Glow cast on surrounding rock */}
      <View style={{ position: 'absolute' as const, top: -4, left: -4, right: -4, bottom: -4, borderRadius: 8, borderWidth: 3, borderColor: theme.accentGlow + '06' }} />
    </View>
  );
}

function CabinWindow({ theme }: { theme: OfficeTheme }) {
  return (
    <View style={{ position: 'absolute' as const, top: 20, right: 175, width: 76, height: 52, zIndex: 2 }}>
      {/* Window shadow */}
      <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 72, height: 48, backgroundColor: '#00000030', borderRadius: 2 }} />
      {/* Window sill — thick log sill */}
      <View style={{ position: 'absolute' as const, bottom: -6, left: -4, width: 84, height: 6, backgroundColor: theme.deskBorder, borderRadius: 1 }}>
        <View style={{ position: 'absolute' as const, top: 0, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
      </View>
      <View style={{ width: 72, height: 48, marginLeft: 2, marginTop: 2, overflow: 'hidden' as const, position: 'relative' as const, backgroundColor: theme.windowSkyColor, borderRadius: 1 }}>
        {/* Mountains — layered depth */}
        <View style={{ position: 'absolute' as const, bottom: 10, left: -4, width: 36, height: 20, backgroundColor: theme.windowCityColor + '50', borderTopLeftRadius: 2, borderTopRightRadius: 18 }} />
        <View style={{ position: 'absolute' as const, bottom: 10, left: 20, width: 40, height: 16, backgroundColor: theme.windowCityColor + '40', borderTopLeftRadius: 20, borderTopRightRadius: 8 }} />
        {/* Snow caps */}
        <View style={{ position: 'absolute' as const, bottom: 26, left: 16, width: 8, height: 3, backgroundColor: '#ffffff15', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
        {/* Trees — varied sizes and shapes */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 26 }}>
          {[{ x: 2, h: 24, w: 10 }, { x: 12, h: 18, w: 8 }, { x: 22, h: 22, w: 9 }, { x: 34, h: 16, w: 7 }, { x: 42, h: 20, w: 10 }, { x: 54, h: 24, w: 8 }, { x: 62, h: 15, w: 7 }].map((t, i) => (
            <View key={i} style={{ position: 'absolute' as const, bottom: 0, left: t.x }}>
              {/* Tree trunk */}
              <View style={{ position: 'absolute' as const, bottom: 0, left: t.w / 2 - 1.5, width: 3, height: 6, backgroundColor: '#3d2210' }} />
              {/* Tree layers (more realistic pine shape) */}
              <View style={{ width: t.w, height: t.h * 0.4, backgroundColor: theme.windowCityColor, borderTopLeftRadius: t.w / 2, borderTopRightRadius: t.w / 2, position: 'absolute' as const, bottom: t.h * 0.6 }} />
              <View style={{ width: t.w * 0.85, height: t.h * 0.5, backgroundColor: theme.windowCityColor, borderTopLeftRadius: t.w / 2, borderTopRightRadius: t.w / 2, position: 'absolute' as const, bottom: t.h * 0.3, left: t.w * 0.075 }} />
              <View style={{ width: t.w * 0.7, height: t.h * 0.5, backgroundColor: theme.windowCityColor, borderTopLeftRadius: t.w / 2, borderTopRightRadius: t.w / 2, position: 'absolute' as const, bottom: 0, left: t.w * 0.15 }} />
            </View>
          ))}
        </View>
        {/* Stars */}
        {[{ t: 3, l: 8 }, { t: 6, l: 30 }, { t: 2, l: 50 }, { t: 8, l: 42 }, { t: 4, l: 18 }].map((st, i) => (
          <View key={`st${i}`} style={{ position: 'absolute' as const, top: st.t, left: st.l, width: i % 2 === 0 ? 2 : 1, height: i % 2 === 0 ? 2 : 1, borderRadius: 1, backgroundColor: '#ffffff' + (i % 2 === 0 ? '50' : '30') }} />
        ))}
        {/* Moon */}
        <View style={{ position: 'absolute' as const, top: 4, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#f0e8d0' }} />
      </View>
      {/* Window frame — 4-pane with cross */}
      <View style={{ position: 'absolute' as const, top: 0, left: 0, width: 76, height: 52, borderWidth: 3, borderColor: theme.wallBorder, borderRadius: 2 }} />
      <View style={{ position: 'absolute' as const, top: 2, left: 38, width: 2, height: 48, backgroundColor: theme.wallBorder }} />
      <View style={{ position: 'absolute' as const, top: 24, left: 2, width: 72, height: 2, backgroundColor: theme.wallBorder }} />
    </View>
  );
}

function renderWindow(env: EnvironmentType, theme: OfficeTheme) {
  switch (env) {
    case 'ship': return <ShipPorthole theme={theme} />;
    case 'castle': return <CastleWindow theme={theme} />;
    case 'station': return <StationViewport theme={theme} />;
    case 'submarine': return <SubmarinePorthole theme={theme} />;
    case 'mansion': return <MansionWindow theme={theme} />;
    case 'lair': return <LairWindow theme={theme} />;
    case 'cabin': return <CabinWindow theme={theme} />;
    case 'temple': return <CastleWindow theme={theme} />;
    case 'garden': return <MansionWindow theme={theme} />;
    case 'cyber': return <StationViewport theme={theme} />;
    case 'arctic': return <StationViewport theme={theme} />;
    default: return <OfficeWindow theme={theme} />;
  }
}

function renderWall(env: EnvironmentType, theme: OfficeTheme) {
  switch (env) {
    case 'ship': return <ShipWall theme={theme} />;
    case 'castle': return <CastleWall theme={theme} />;
    case 'station': return <StationWall theme={theme} />;
    case 'submarine': return <SubmarineWall theme={theme} />;
    case 'mansion': return <MansionWall theme={theme} />;
    case 'lair': return <LairWall theme={theme} />;
    case 'cabin': return <CabinWall theme={theme} />;
    case 'temple': return <CastleWall theme={theme} />;
    case 'garden': return <MansionWall theme={theme} />;
    case 'cyber': return <StationWall theme={theme} />;
    case 'arctic': return <StationWall theme={theme} />;
    default: return <OfficeWall theme={theme} />;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT: DESKS
// ═══════════════════════════════════════════════════════════════════════════════

function OfficeDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
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

function ShipDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Barrel body with stave details */}
      <View style={{
        width: 50, height: 30, backgroundColor: theme.deskColor, borderRadius: 6,
        borderWidth: 1, borderColor: theme.deskBorder, position: 'absolute' as const, left: 10, top: -4,
      }}>
        {/* Barrel stave lines */}
        {[10, 20, 30, 40].map((lx, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: 2, left: lx, width: 1, height: 26, backgroundColor: theme.deskBorder + '25' }} />
        ))}
        {/* Iron bands */}
        <View style={{ position: 'absolute' as const, top: 5, left: 0, right: 0, height: 3, backgroundColor: theme.accentGlow + '50' }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 1, backgroundColor: '#ffffff10' }} />
        </View>
        <View style={{ position: 'absolute' as const, bottom: 5, left: 0, right: 0, height: 3, backgroundColor: theme.accentGlow + '50' }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 1, backgroundColor: '#ffffff10' }} />
        </View>
        {/* Barrel shadow */}
        <View style={{ position: 'absolute' as const, bottom: 0, left: 3, right: 3, height: 3, backgroundColor: '#00000015', borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }} />
      </View>
      {/* Plank top surface with grain */}
      <View style={{
        width: 72, height: 12, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 1, position: 'absolute' as const, top: -8, left: 1,
      }}>
        <View style={{ position: 'absolute' as const, top: 3, left: 6, width: 20, height: 1, backgroundColor: theme.deskBorder + '20' }} />
        <View style={{ position: 'absolute' as const, top: 7, left: 30, width: 15, height: 1, backgroundColor: theme.deskBorder + '15' }} />
        {/* Highlight */}
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
      </View>
      {/* Scroll/map instead of monitor — more detailed */}
      <View style={{
        position: 'absolute' as const, top: -24, left: 20, width: 26, height: 16,
        backgroundColor: '#d4c4a0', borderRadius: 2, borderWidth: 1, borderColor: '#a08060',
      }}>
        {/* Map content lines */}
        <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 14, height: 1, backgroundColor: '#80604030' }} />
        <View style={{ position: 'absolute' as const, top: 6, left: 4, width: 10, height: 1, backgroundColor: '#80604025' }} />
        <View style={{ position: 'absolute' as const, top: 9, left: 3, width: 16, height: 1, backgroundColor: '#80604020' }} />
        {/* X marks the spot */}
        <Text style={{ position: 'absolute' as const, bottom: 2, right: 3, fontSize: 5, color: '#cc000060' } as any}>✕</Text>
        {/* Scroll curl */}
        <View style={{ position: 'absolute' as const, top: -2, left: -1, width: 28, height: 3, backgroundColor: '#c4b490', borderRadius: 1.5 }} />
        <View style={{ position: 'absolute' as const, bottom: -2, left: -1, width: 28, height: 3, backgroundColor: '#b4a480', borderRadius: 1.5 }} />
      </View>
      {/* Rum bottle */}
      <View style={{ position: 'absolute' as const, top: -20, left: 52 }}>
        <View style={{ width: 4, height: 5, backgroundColor: '#4a3520', borderRadius: 1 }} />
        <View style={{ width: 8, height: 10, backgroundColor: '#3d2210', borderRadius: 2, marginLeft: -2, borderWidth: 1, borderColor: '#2a1808' }} />
      </View>
      {/* Wooden stool with detail */}
      <View style={{ position: 'absolute' as const, top: 28, left: 22 }}>
        <View style={{ width: 24, height: 5, backgroundColor: theme.deskColor, borderRadius: 2, borderWidth: 1, borderColor: theme.deskBorder }}>
          <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
        </View>
        {/* Stool legs */}
        <View style={{ width: 3, height: 8, backgroundColor: theme.deskBorder, marginLeft: 3 }} />
        <View style={{ position: 'absolute' as const, top: 5, right: 4, width: 3, height: 8, backgroundColor: theme.deskBorder }} />
      </View>
    </View>
  );
}

function CastleDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Stone pedestal with carved detail */}
      <View style={{
        width: 72, height: 26, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 2,
      }}>
        {/* Stone texture */}
        <View style={{ position: 'absolute' as const, top: 6, left: 4, width: 22, height: 1, backgroundColor: theme.deskBorder + '30' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 30, width: 18, height: 1, backgroundColor: theme.deskBorder + '25' }} />
        <View style={{ position: 'absolute' as const, top: 18, left: 10, width: 14, height: 1, backgroundColor: theme.deskBorder + '20' }} />
        {/* Top highlight */}
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
        {/* Carved arch detail */}
        <View style={{ position: 'absolute' as const, top: 4, left: 50, width: 16, height: 16, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderWidth: 1, borderColor: theme.deskBorder + '30', backgroundColor: 'transparent' }} />
      </View>
      {/* Crystal ball monitor — with inner glow */}
      <View style={{ position: 'absolute' as const, top: -22, left: 22 }}>
        {/* Outer glow */}
        <View style={{ position: 'absolute' as const, top: -3, left: -3, width: 26, height: 26, borderRadius: 13, backgroundColor: theme.accentGlow + '06' }} />
        <View style={{
          width: 20, height: 20, borderRadius: 10,
          backgroundColor: theme.accentGlow + '12', borderWidth: 1, borderColor: theme.accentGlow + '35',
        }}>
          {/* Inner swirl */}
          <View style={{ position: 'absolute' as const, top: 5, left: 4, width: 8, height: 6, borderRadius: 4, backgroundColor: theme.accentGlow + '10' }} />
          {/* Glass highlight */}
          <View style={{ position: 'absolute' as const, top: 2, left: 4, width: 6, height: 4, borderRadius: 3, backgroundColor: '#ffffff12' }} />
          {/* Sparkle */}
          <View style={{ position: 'absolute' as const, top: 4, left: 12, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff20' }} />
        </View>
      </View>
      {/* Crystal base — ornate */}
      <View style={{ position: 'absolute' as const, top: -4, left: 25, width: 14, height: 5, backgroundColor: theme.deskBorder, borderRadius: 1 }}>
        <View style={{ position: 'absolute' as const, top: 0, left: 3, right: 3, height: 1, backgroundColor: '#ffffff08' }} />
        {/* Claws/feet */}
        <View style={{ position: 'absolute' as const, bottom: -2, left: 0, width: 4, height: 3, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
        <View style={{ position: 'absolute' as const, bottom: -2, right: 0, width: 4, height: 3, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
      </View>
      {/* Quill pen */}
      <View style={{ position: 'absolute' as const, top: -16, left: 50, transform: [{ rotate: '30deg' }] }}>
        <View style={{ width: 2, height: 14, backgroundColor: '#f5f0e0' }} />
        <View style={{ position: 'absolute' as const, bottom: 0, left: -1, width: 4, height: 4, backgroundColor: '#8b7355', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
      </View>
      {/* Ornate chair — with carved back */}
      <View style={{ position: 'absolute' as const, top: 26, left: 20 }}>
        <View style={{ width: 26, height: 12, backgroundColor: theme.chairColor, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderWidth: 1, borderColor: theme.chairBorder }}>
          {/* Carved crest on chair back */}
          <View style={{ position: 'absolute' as const, top: 2, left: 8, width: 10, height: 6, borderRadius: 3, borderWidth: 1, borderColor: theme.accentGlow + '20', backgroundColor: 'transparent' }} />
        </View>
        <View style={{ width: 30, height: 5, backgroundColor: theme.chairColor, borderWidth: 1, borderColor: theme.chairBorder, marginLeft: -2 }}>
          <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
        </View>
      </View>
    </View>
  );
}

function StationDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Metal console with beveled edges */}
      <View style={{
        width: 82, height: 26, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 2,
      }}>
        {/* Top edge highlight */}
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
        {/* Console buttons — more of them */}
        <View style={{ position: 'absolute' as const, top: 4, left: 6, flexDirection: 'row' as const, gap: 3 }}>
          {['#22c55e', theme.accentGlow, '#ef4444', '#3b82f6'].map((c, i) => (
            <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c }}>
              <View style={{ position: 'absolute' as const, top: 0, left: 1, width: 2, height: 1, borderRadius: 0.5, backgroundColor: '#ffffff30' }} />
            </View>
          ))}
        </View>
        {/* Slider control */}
        <View style={{ position: 'absolute' as const, top: 14, left: 6, width: 30, height: 4, backgroundColor: '#00000020', borderRadius: 2 }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 10, width: 6, height: 4, backgroundColor: theme.accentGlow + '40', borderRadius: 2 }} />
        </View>
        {/* Right-side readout */}
        <View style={{ position: 'absolute' as const, top: 4, right: 6, width: 20, height: 14, backgroundColor: '#00000030', borderRadius: 1, borderWidth: 1, borderColor: theme.accentGlow + '15' }}>
          <Text style={{ fontSize: 4, color: theme.accentGlow + '50', fontFamily: 'monospace', marginTop: 2, marginLeft: 2 } as any}>OK</Text>
        </View>
      </View>
      {/* Holographic screen — with glow effect */}
      <View style={{
        position: 'absolute' as const, top: -20, left: 20, width: 32, height: 20,
        backgroundColor: theme.accentGlow + '08', borderWidth: 1, borderColor: theme.accentGlow + '35',
        borderRadius: 2,
      }}>
        {/* Screen content — code-like lines */}
        {[3, 6, 9, 12, 15].map((y2, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: y2, left: 3, width: 10 + (i * 7) % 16, height: 1, backgroundColor: theme.accentGlow + '25' }} />
        ))}
        {/* Blinking cursor */}
        <View style={{ position: 'absolute' as const, bottom: 3, left: 3, width: 4, height: 1, backgroundColor: theme.accentGlow + '60' }} />
        {/* Screen glow on desk surface */}
        <View style={{ position: 'absolute' as const, bottom: -4, left: 4, right: 4, height: 3, backgroundColor: theme.accentGlow + '06', borderRadius: 2 }} />
      </View>
      {/* Screen stand */}
      <View style={{ position: 'absolute' as const, top: -2, left: 33, width: 6, height: 4, backgroundColor: theme.deskBorder }}>
        <View style={{ position: 'absolute' as const, bottom: 0, left: -2, width: 10, height: 2, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
      </View>
      {/* Pod chair — more detailed */}
      <View style={{ position: 'absolute' as const, top: 28, left: 22 }}>
        <View style={{ width: 26, height: 10, backgroundColor: theme.chairColor, borderTopLeftRadius: 13, borderTopRightRadius: 13, borderWidth: 1, borderColor: theme.chairBorder }}>
          {/* Headrest */}
          <View style={{ position: 'absolute' as const, top: -2, left: 8, width: 10, height: 4, backgroundColor: theme.chairBorder, borderTopLeftRadius: 5, borderTopRightRadius: 5 }} />
        </View>
        <View style={{ width: 22, height: 5, backgroundColor: theme.chairColor, borderWidth: 1, borderColor: theme.chairBorder, marginLeft: 2 }}>
          <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
        </View>
      </View>
    </View>
  );
}

function SubmarineDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Metal workbench */}
      <View style={{
        width: 76, height: 22, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 1,
      }}>
        {/* Bolts */}
        {[4, 68].map((lx, i) => (
          <View key={i} style={{ position: 'absolute' as const, top: 8, left: lx, width: 4, height: 4, borderRadius: 2, backgroundColor: theme.wallBorder }} />
        ))}
      </View>
      {/* Round sonar screen */}
      <View style={{
        position: 'absolute' as const, top: -18, left: 26, width: 18, height: 18, borderRadius: 9,
        backgroundColor: '#001a10', borderWidth: 2, borderColor: theme.wallBorder,
      }}>
        {/* Sonar sweep line */}
        <View style={{ position: 'absolute' as const, top: 8, left: 8, width: 8, height: 1, backgroundColor: theme.accentGlow, transform: [{ rotate: '45deg' }], transformOrigin: 'left center' }} />
        {/* Sonar dot */}
        <View style={{ position: 'absolute' as const, top: 5, right: 4, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.accentGlow }} />
      </View>
      {/* Metal stool */}
      <View style={{ position: 'absolute' as const, top: 28, left: 26 }}>
        <View style={{ width: 20, height: 5, backgroundColor: theme.deskColor, borderRadius: 10, borderWidth: 1, borderColor: theme.deskBorder }} />
        <View style={{ width: 4, height: 8, backgroundColor: theme.wallBorder, marginLeft: 8 }} />
      </View>
    </View>
  );
}

function MansionDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Antique desk with drawers */}
      <View style={{
        width: 80, height: 26, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 2,
      }}>
        {/* Wood grain */}
        <View style={{ position: 'absolute' as const, top: 4, left: 6, width: 24, height: 1, backgroundColor: theme.deskBorder + '15' }} />
        <View style={{ position: 'absolute' as const, top: 18, left: 40, width: 18, height: 1, backgroundColor: theme.deskBorder + '12' }} />
        {/* Top highlight */}
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
        {/* Left drawer */}
        <View style={{ position: 'absolute' as const, top: 6, left: 4, width: 28, height: 16, borderWidth: 1, borderColor: theme.deskBorder + '40', borderRadius: 1 }}>
          <View style={{ position: 'absolute' as const, top: 6, left: 10, width: 8, height: 3, borderRadius: 1.5, backgroundColor: theme.accentGlow + '50' }}>
            <View style={{ position: 'absolute' as const, top: 0, left: 2, right: 2, height: 1, backgroundColor: '#ffffff15' }} />
          </View>
        </View>
        {/* Right drawer */}
        <View style={{ position: 'absolute' as const, top: 6, right: 4, width: 28, height: 16, borderWidth: 1, borderColor: theme.deskBorder + '40', borderRadius: 1 }}>
          <View style={{ position: 'absolute' as const, top: 6, left: 10, width: 8, height: 3, borderRadius: 1.5, backgroundColor: theme.accentGlow + '50' }} />
        </View>
        {/* Desk legs — carved */}
        <View style={{ position: 'absolute' as const, bottom: -6, left: 2, width: 4, height: 6, backgroundColor: theme.deskBorder, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
        <View style={{ position: 'absolute' as const, bottom: -6, right: 2, width: 4, height: 6, backgroundColor: theme.deskBorder, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
      </View>
      {/* Candelabra instead of monitor */}
      <View style={{ position: 'absolute' as const, top: -26, left: 28, alignItems: 'center' as const }}>
        <View style={{ flexDirection: 'row' as const, gap: 6 }}>
          {/* Left candle */}
          <View style={{ alignItems: 'center' as const }}>
            <Text style={{ fontSize: 6 }}>🔥</Text>
            <View style={{ width: 3, height: 8, backgroundColor: '#f5f0d0', borderRadius: 0.5 }} />
          </View>
          {/* Center candle (taller) */}
          <View style={{ alignItems: 'center' as const, marginTop: -4 }}>
            <Text style={{ fontSize: 7 }}>🔥</Text>
            <View style={{ width: 4, height: 12, backgroundColor: '#f5f0d0', borderRadius: 0.5 }} />
          </View>
          {/* Right candle */}
          <View style={{ alignItems: 'center' as const }}>
            <Text style={{ fontSize: 6 }}>🔥</Text>
            <View style={{ width: 3, height: 8, backgroundColor: '#f5f0d0', borderRadius: 0.5 }} />
          </View>
        </View>
        {/* Candelabra base */}
        <View style={{ width: 16, height: 4, backgroundColor: theme.deskBorder, borderRadius: 2 }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 2, right: 2, height: 1, backgroundColor: '#ffffff08' }} />
        </View>
      </View>
      {/* Old book on desk */}
      <View style={{ position: 'absolute' as const, top: -10, left: 54, width: 14, height: 10, backgroundColor: '#4a1020', borderRadius: 1, borderWidth: 1, borderColor: '#3a0818' }}>
        <View style={{ position: 'absolute' as const, left: 1, top: 1, bottom: 1, width: 1, backgroundColor: '#ffffff08' }} />
      </View>
      {/* Wingback chair — more detailed */}
      <View style={{ position: 'absolute' as const, top: 26, left: 20 }}>
        <View style={{ width: 30, height: 14, backgroundColor: theme.chairColor, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderWidth: 1, borderColor: theme.chairBorder }}>
          {/* Wing sides */}
          <View style={{ position: 'absolute' as const, top: 0, left: 0, width: 5, height: 12, backgroundColor: theme.chairBorder + '35', borderTopLeftRadius: 6 }} />
          <View style={{ position: 'absolute' as const, top: 0, right: 0, width: 5, height: 12, backgroundColor: theme.chairBorder + '35', borderTopRightRadius: 6 }} />
          {/* Button tufting */}
          <View style={{ position: 'absolute' as const, top: 4, left: 10, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.chairBorder + '30' }} />
          <View style={{ position: 'absolute' as const, top: 4, left: 17, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.chairBorder + '30' }} />
        </View>
        <View style={{ width: 26, height: 5, backgroundColor: theme.chairColor, borderWidth: 1, borderColor: theme.chairBorder, marginLeft: 2 }} />
      </View>
    </View>
  );
}

function LairDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Obsidian slab */}
      <View style={{
        width: 74, height: 22, backgroundColor: '#1a0800', borderWidth: 1,
        borderColor: theme.wallBorder, borderRadius: 1,
      }}>
        {/* Lava crack in desk */}
        <View style={{ position: 'absolute' as const, top: 8, left: 10, width: 30, height: 2, backgroundColor: theme.accentGlow + '40', borderRadius: 1 }} />
      </View>
      {/* Ember screen */}
      <View style={{
        position: 'absolute' as const, top: -16, left: 24, width: 24, height: 16,
        backgroundColor: '#0a0000', borderWidth: 1, borderColor: theme.accentGlow + '40', borderRadius: 1,
      }}>
        <View style={{ position: 'absolute' as const, bottom: 2, left: 4, right: 4, height: 4, backgroundColor: theme.accentGlow + '20', borderRadius: 1 }} />
      </View>
      {/* Rock seat */}
      <View style={{ position: 'absolute' as const, top: 28, left: 26 }}>
        <View style={{ width: 22, height: 12, backgroundColor: '#1a0a00', borderRadius: 4, borderWidth: 1, borderColor: theme.wallBorder }} />
      </View>
    </View>
  );
}

function CabinDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Rustic wood desk with visible grain */}
      <View style={{
        width: 78, height: 24, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 2,
      }}>
        {/* Wood grain — rich detail */}
        <View style={{ position: 'absolute' as const, top: 4, left: 6, width: 30, height: 1, backgroundColor: theme.deskBorder + '20' }} />
        <View style={{ position: 'absolute' as const, top: 10, left: 20, width: 25, height: 1, backgroundColor: theme.deskBorder + '15' }} />
        <View style={{ position: 'absolute' as const, top: 16, left: 8, width: 35, height: 1, backgroundColor: theme.deskBorder + '12' }} />
        {/* Top highlight */}
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
        {/* Knot */}
        <View style={{ position: 'absolute' as const, top: 8, left: 55, width: 6, height: 5, borderRadius: 3, backgroundColor: theme.deskBorder + '20' }} />
        {/* Chunky legs */}
        <View style={{ position: 'absolute' as const, bottom: -8, left: 4, width: 6, height: 8, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
        <View style={{ position: 'absolute' as const, bottom: -8, right: 4, width: 6, height: 8, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
      </View>
      {/* Lantern instead of monitor */}
      <View style={{ position: 'absolute' as const, top: -20, left: 28, alignItems: 'center' as const }}>
        <View style={{ width: 2, height: 4, backgroundColor: '#666' }} />
        <View style={{
          width: 14, height: 16, backgroundColor: theme.accentGlow + '20', borderRadius: 3,
          borderWidth: 1, borderColor: theme.deskBorder,
        }}>
          <View style={{ position: 'absolute' as const, top: 5, left: 4, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.accentGlow + '50' }} />
          {/* Lantern glass panes */}
          <View style={{ position: 'absolute' as const, top: 2, left: 6, width: 1, height: 12, backgroundColor: theme.deskBorder + '30' }} />
        </View>
      </View>
      {/* Simple notepad */}
      <View style={{ position: 'absolute' as const, top: -8, left: 48, width: 14, height: 10, backgroundColor: '#f5f0e0', borderRadius: 1, borderWidth: 1, borderColor: '#d4c8a0' }}>
        <View style={{ position: 'absolute' as const, top: 3, left: 2, right: 2, height: 1, backgroundColor: '#d4c8a030' }} />
        <View style={{ position: 'absolute' as const, top: 6, left: 2, width: 6, height: 1, backgroundColor: '#d4c8a025' }} />
      </View>
      {/* Log stool */}
      <View style={{ position: 'absolute' as const, top: 28, left: 24 }}>
        <View style={{ width: 22, height: 8, backgroundColor: theme.deskColor, borderRadius: 11, borderWidth: 1, borderColor: theme.deskBorder }}>
          {/* Growth ring on top */}
          <View style={{ position: 'absolute' as const, top: 2, left: 6, width: 10, height: 4, borderRadius: 5, borderWidth: 1, borderColor: theme.deskBorder + '25', backgroundColor: 'transparent' }} />
        </View>
        <View style={{ width: 4, height: 6, backgroundColor: theme.deskBorder, marginLeft: 9 }} />
      </View>
    </View>
  );
}

function TempleDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Stone pedestal */}
      <View style={{
        width: 66, height: 24, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 1,
      }}>
        <View style={{ position: 'absolute' as const, top: 4, left: 6, width: 16, height: 1, backgroundColor: theme.deskBorder + '30' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 24, width: 14, height: 1, backgroundColor: theme.deskBorder + '20' }} />
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
      </View>
      {/* Glowing rune tablet (monitor) */}
      <View style={{
        position: 'absolute' as const, top: -22, left: 18, width: 28, height: 18,
        backgroundColor: '#1a1608', borderRadius: 2, borderWidth: 1, borderColor: theme.accentGlow + '60',
      }}>
        <View style={{ position: 'absolute' as const, top: 3, left: 4, width: 8, height: 1, backgroundColor: theme.accentGlow + '40' }} />
        <View style={{ position: 'absolute' as const, top: 6, left: 6, width: 14, height: 1, backgroundColor: theme.accentGlow + '30' }} />
        <View style={{ position: 'absolute' as const, top: 9, left: 3, width: 10, height: 1, backgroundColor: theme.accentGlow + '25' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 8, width: 12, height: 1, backgroundColor: theme.accentGlow + '20' }} />
      </View>
      {/* Scroll */}
      <View style={{ position: 'absolute' as const, top: -8, left: 50, width: 12, height: 8, backgroundColor: '#d4c4a0', borderRadius: 1, borderWidth: 1, borderColor: '#a08060' }} />
      {/* Stone bench (chair) */}
      <View style={{ position: 'absolute' as const, top: 28, left: 18 }}>
        <View style={{ width: 28, height: 6, backgroundColor: theme.deskColor, borderRadius: 1, borderWidth: 1, borderColor: theme.deskBorder }} />
        <View style={{ width: 4, height: 6, backgroundColor: theme.deskBorder, marginLeft: 4 }} />
        <View style={{ position: 'absolute' as const, top: 6, right: 4, width: 4, height: 6, backgroundColor: theme.deskBorder }} />
      </View>
    </View>
  );
}

function GardenDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Rustic potting bench */}
      <View style={{
        width: 68, height: 22, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 2,
      }}>
        <View style={{ position: 'absolute' as const, top: 5, left: 4, width: 18, height: 1, backgroundColor: theme.deskBorder + '25' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 28, width: 14, height: 1, backgroundColor: theme.deskBorder + '18' }} />
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
      </View>
      {/* Small plant pot */}
      <View style={{ position: 'absolute' as const, top: -18, left: 24, alignItems: 'center' as const }}>
        <View style={{ width: 10, height: 6, backgroundColor: '#22c55e', borderRadius: 5 }} />
        <View style={{ width: 12, height: 10, backgroundColor: '#a0522d', borderRadius: 1, borderWidth: 1, borderColor: '#78350f' }} />
      </View>
      {/* Trowel */}
      <View style={{ position: 'absolute' as const, top: -6, left: 50, width: 14, height: 4, backgroundColor: '#9ca3af', borderRadius: 1 }}>
        <View style={{ position: 'absolute' as const, left: -4, top: 1, width: 6, height: 2, backgroundColor: '#78350f' }} />
      </View>
      {/* Garden stool */}
      <View style={{ position: 'absolute' as const, top: 26, left: 20 }}>
        <View style={{ width: 24, height: 6, backgroundColor: theme.deskColor, borderRadius: 2, borderWidth: 1, borderColor: theme.deskBorder }} />
        <View style={{ width: 3, height: 6, backgroundColor: theme.deskBorder, marginLeft: 4 }} />
        <View style={{ position: 'absolute' as const, top: 6, right: 4, width: 3, height: 6, backgroundColor: theme.deskBorder }} />
      </View>
    </View>
  );
}

function CyberDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Angular metal desk with glowing edge */}
      <View style={{
        width: 70, height: 22, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.accentGlow + '60',
      }}>
        <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 2, backgroundColor: theme.accentGlow + '40' }} />
        <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1, backgroundColor: theme.accentGlow + '20' }} />
      </View>
      {/* Holographic screen */}
      <View style={{
        position: 'absolute' as const, top: -22, left: 14, width: 32, height: 18,
        backgroundColor: '#0d002060', borderRadius: 1, borderWidth: 1, borderColor: '#00ffff40',
      }}>
        <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 12, height: 1, backgroundColor: '#00ffff30' }} />
        <View style={{ position: 'absolute' as const, top: 6, left: 5, width: 18, height: 1, backgroundColor: '#ff00ff25' }} />
        <View style={{ position: 'absolute' as const, top: 9, left: 3, width: 8, height: 1, backgroundColor: '#00ffff20' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 8, width: 14, height: 1, backgroundColor: '#ff00ff18' }} />
      </View>
      {/* Energy drink */}
      <View style={{ position: 'absolute' as const, top: -8, left: 52, width: 8, height: 12, backgroundColor: '#1a1a2e', borderRadius: 1, borderWidth: 1, borderColor: '#00ffff30' }} />
      {/* Gaming chair */}
      <View style={{ position: 'absolute' as const, top: 24, left: 16 }}>
        <View style={{
          width: 28, height: 20, backgroundColor: theme.chairColor, borderRadius: 3,
          borderWidth: 1, borderColor: theme.accentGlow + '40',
        }}>
          <View style={{ position: 'absolute' as const, top: 3, left: 12, width: 4, height: 14, backgroundColor: theme.accentGlow + '25' }} />
        </View>
        <View style={{ width: 24, height: 5, backgroundColor: theme.chairColor, marginLeft: 2, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
      </View>
    </View>
  );
}

function ArcticDesk({ x, y, theme }: { x: number; y: number; theme: OfficeTheme }) {
  return (
    <View style={[s.desk, { left: x, top: y }]}>
      {/* Reinforced metal console */}
      <View style={{
        width: 68, height: 24, backgroundColor: theme.deskColor, borderWidth: 1,
        borderColor: theme.deskBorder, borderRadius: 1,
      }}>
        <View style={{ position: 'absolute' as const, top: 3, left: 3, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.deskBorder + '50' }} />
        <View style={{ position: 'absolute' as const, top: 3, right: 3, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.deskBorder + '50' }} />
        <View style={{ position: 'absolute' as const, bottom: 3, left: 3, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.deskBorder + '50' }} />
        <View style={{ position: 'absolute' as const, bottom: 3, right: 3, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.deskBorder + '50' }} />
        <View style={{ position: 'absolute' as const, top: 1, left: 2, right: 2, height: 1, backgroundColor: '#ffffff06' }} />
      </View>
      {/* Thermal readout monitor */}
      <View style={{
        position: 'absolute' as const, top: -22, left: 16, width: 30, height: 18,
        backgroundColor: '#0a1828', borderRadius: 2, borderWidth: 1, borderColor: theme.deskBorder,
      }}>
        <View style={{ position: 'absolute' as const, top: 3, left: 4, width: 10, height: 1, backgroundColor: '#22c55e60' }} />
        <View style={{ position: 'absolute' as const, top: 6, left: 4, width: 16, height: 1, backgroundColor: '#38bdf850' }} />
        <View style={{ position: 'absolute' as const, top: 9, left: 4, width: 8, height: 1, backgroundColor: '#ef444440' }} />
        <View style={{ position: 'absolute' as const, top: 12, left: 4, width: 12, height: 1, backgroundColor: '#22c55e30' }} />
      </View>
      {/* Frost on desk edge */}
      <View style={{ position: 'absolute' as const, top: -2, left: 0, width: 16, height: 3, backgroundColor: '#c0e8ff18', borderRadius: 1 }} />
      {/* Insulated chair */}
      <View style={{ position: 'absolute' as const, top: 28, left: 18 }}>
        <View style={{
          width: 26, height: 16, backgroundColor: theme.chairColor, borderRadius: 3,
          borderWidth: 1, borderColor: theme.deskBorder,
        }} />
        <View style={{ width: 22, height: 5, backgroundColor: theme.chairColor, marginLeft: 2, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
      </View>
    </View>
  );
}

function renderDesk(env: EnvironmentType, x: number, y: number, theme: OfficeTheme) {
  switch (env) {
    case 'ship': return <ShipDesk x={x} y={y} theme={theme} />;
    case 'castle': return <CastleDesk x={x} y={y} theme={theme} />;
    case 'station': return <StationDesk x={x} y={y} theme={theme} />;
    case 'submarine': return <SubmarineDesk x={x} y={y} theme={theme} />;
    case 'mansion': return <MansionDesk x={x} y={y} theme={theme} />;
    case 'lair': return <LairDesk x={x} y={y} theme={theme} />;
    case 'cabin': return <CabinDesk x={x} y={y} theme={theme} />;
    case 'temple': return <TempleDesk x={x} y={y} theme={theme} />;
    case 'garden': return <GardenDesk x={x} y={y} theme={theme} />;
    case 'cyber': return <CyberDesk x={x} y={y} theme={theme} />;
    case 'arctic': return <ArcticDesk x={x} y={y} theme={theme} />;
    default: return <OfficeDesk x={x} y={y} theme={theme} />;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT: BUILT-IN DECORATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function OfficeDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Plants */}
      <Plant x={740} y={200} size="lg" />
      <Plant x={740} y={380} />
      <Plant x={20} y={570} />
      {/* Coffee machine */}
      <CoffeeMachine x={760} y={480} />
      {/* Lounge */}
      <View style={[s.lounge, { borderColor: theme.wallBorder }]}>
        <View style={[s.loungeCouch, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
        <View style={[s.loungeTable, { backgroundColor: theme.deskColor, borderColor: theme.deskBorder }]} />
        <View style={[s.loungeCouch, { backgroundColor: theme.chairColor, borderColor: theme.chairBorder }]} />
      </View>
      {/* Rug */}
      <View style={[s.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />
      {/* Clock */}
      <View style={s.clock}><Text style={s.clockText}>⏱</Text></View>
    </>
  );
}

function Plant({ x, y, size }: { x: number; y: number; size?: 'sm' | 'lg' }) {
  const sc = size === 'lg' ? 1.4 : 1;
  return (
    <View style={[s.plantWrap, { left: x, top: y }]}>
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

function ShipDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Ship wheel (helm) */}
      <View style={{ position: 'absolute' as const, right: 40, top: 210, alignItems: 'center' as const }}>
        <View style={{
          width: 50, height: 50, borderRadius: 25, borderWidth: 3, borderColor: theme.deskBorder,
          backgroundColor: 'transparent', alignItems: 'center' as const, justifyContent: 'center' as const,
        }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.deskColor, borderWidth: 1, borderColor: theme.deskBorder }} />
          {/* Spokes */}
          {[0, 45, 90, 135].map((deg, i) => (
            <View key={i} style={{
              position: 'absolute' as const, width: 44, height: 2, backgroundColor: theme.deskBorder,
              transform: [{ rotate: `${deg}deg` }],
            }} />
          ))}
        </View>
        <View style={{ width: 6, height: 20, backgroundColor: theme.deskBorder, marginTop: 2 }} />
      </View>
      {/* Jolly Roger flag */}
      <View style={{ position: 'absolute' as const, right: 110, top: 200 }}>
        <View style={{ width: 3, height: 80, backgroundColor: theme.deskBorder }} />
        <View style={{
          position: 'absolute' as const, top: 0, left: 3, width: 40, height: 28,
          backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#333',
        }}>
          <Text style={{ fontSize: 14, textAlign: 'center' as const, marginTop: 2 }}>☠️</Text>
        </View>
      </View>
      {/* Cannons */}
      {[{ x: 750, y: 400 }, { x: 750, y: 530 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute' as const, left: pos.x, top: pos.y }}>
          <View style={{ width: 40, height: 16, backgroundColor: '#333', borderRadius: 3, borderWidth: 1, borderColor: '#555' }} />
          <View style={{ position: 'absolute' as const, right: -8, top: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#222', borderWidth: 1, borderColor: '#444' }} />
        </View>
      ))}
      {/* Treasure chest */}
      <View style={{ position: 'absolute' as const, left: 740, top: 470 }}>
        <View style={{
          width: 36, height: 20, backgroundColor: theme.deskColor, borderWidth: 1,
          borderColor: theme.deskBorder, borderRadius: 2,
        }}>
          <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 8, backgroundColor: theme.deskBorder, borderTopLeftRadius: 8, borderTopRightRadius: 8 }} />
          <View style={{ position: 'absolute' as const, top: 6, left: 14, width: 8, height: 6, backgroundColor: theme.accentGlow, borderRadius: 1 }} />
        </View>
      </View>
      {/* Rope coil */}
      <View style={{ position: 'absolute' as const, left: 20, top: 560 }}>
        <View style={{
          width: 24, height: 24, borderRadius: 12, borderWidth: 4, borderColor: '#a08060',
          backgroundColor: 'transparent',
        }} />
      </View>
      {/* Lanterns */}
      {[{ x: 740, y: 200 }, { x: 740, y: 340 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute' as const, left: pos.x, top: pos.y, alignItems: 'center' as const }}>
          <View style={{ width: 2, height: 8, backgroundColor: '#666' }} />
          <View style={{
            width: 14, height: 18, backgroundColor: theme.accentGlow + '30', borderRadius: 3,
            borderWidth: 1, borderColor: theme.accentGlow + '60',
          }}>
            <View style={{ position: 'absolute' as const, top: 6, left: 4, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.accentGlow + '80' }} />
          </View>
        </View>
      ))}
      {/* Captain's area with map table */}
      <View style={[s.lounge, { borderColor: theme.wallBorder, borderStyle: 'dashed' as const }]}>
        <View style={{
          width: 80, height: 50, backgroundColor: theme.deskColor, borderRadius: 4,
          borderWidth: 1, borderColor: theme.deskBorder,
        }}>
          {/* Map on table */}
          <View style={{ margin: 6, flex: 1, backgroundColor: '#d4c4a0', borderRadius: 1 }}>
            <View style={{ margin: 3, borderWidth: 1, borderColor: '#a08060', flex: 1, borderRadius: 1 }} />
          </View>
        </View>
      </View>
      {/* Tattered sail rug */}
      <View style={[s.rug, { backgroundColor: '#d4c4a0' + '15', borderColor: '#a08060' + '30' }]} />
    </>
  );
}

function CastleDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Throne */}
      <View style={{ position: 'absolute' as const, right: 40, top: 210 }}>
        <View style={{
          width: 40, height: 50, backgroundColor: theme.chairColor, borderTopLeftRadius: 10, borderTopRightRadius: 10,
          borderWidth: 1, borderColor: theme.chairBorder,
        }}>
          {/* Crown detail at top */}
          <View style={{ position: 'absolute' as const, top: -6, left: 10, width: 20, height: 8, backgroundColor: theme.accentGlow + '40', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
          {/* Armrests */}
          <View style={{ position: 'absolute' as const, bottom: 0, left: -6, width: 8, height: 20, backgroundColor: theme.chairBorder, borderRadius: 2 }} />
          <View style={{ position: 'absolute' as const, bottom: 0, right: -6, width: 8, height: 20, backgroundColor: theme.chairBorder, borderRadius: 2 }} />
        </View>
      </View>
      {/* Tapestry banner */}
      <View style={{ position: 'absolute' as const, right: 120, top: 198 }}>
        <View style={{ width: 3, height: 4, backgroundColor: theme.deskBorder }} />
        <View style={{
          width: 30, height: 50, backgroundColor: theme.accentGlow + '20',
          borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderWidth: 1, borderColor: theme.accentGlow + '40',
        }}>
          {/* Crest */}
          <View style={{ position: 'absolute' as const, top: 10, left: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.accentGlow + '20', borderWidth: 1, borderColor: theme.accentGlow + '30' }} />
          {/* Triangle bottom cut */}
          <View style={{ position: 'absolute' as const, bottom: -1, left: 13, width: 0, height: 0, borderLeftWidth: 15, borderRightWidth: 15, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: theme.accentGlow + '20' }} />
        </View>
      </View>
      {/* Suit of armor */}
      <View style={{ position: 'absolute' as const, left: 740, top: 380, alignItems: 'center' as const }}>
        <Text style={{ fontSize: 24 }}>⚔️</Text>
      </View>
      {/* Stone fountain (lounge area) */}
      <View style={[s.lounge, { borderColor: theme.wallBorder, borderStyle: 'dashed' as const }]}>
        <View style={{
          width: 50, height: 50, borderRadius: 25, backgroundColor: theme.deskColor,
          borderWidth: 2, borderColor: theme.deskBorder, alignItems: 'center' as const, justifyContent: 'center' as const,
        }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.accentGlow + '20' }} />
        </View>
      </View>
      {/* Candelabras */}
      {[{ x: 740, y: 470 }, { x: 20, y: 560 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute' as const, left: pos.x, top: pos.y, alignItems: 'center' as const }}>
          <Text style={{ fontSize: 14 }}>🕯️</Text>
        </View>
      ))}
      {/* Stone tile rug */}
      <View style={[s.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />
    </>
  );
}

function StationDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Control panel */}
      <View style={{ position: 'absolute' as const, right: 30, top: 210 }}>
        <View style={{
          width: 100, height: 60, backgroundColor: theme.deskColor, borderWidth: 1,
          borderColor: theme.deskBorder, borderRadius: 2,
        }}>
          {/* Screen */}
          <View style={{ margin: 4, height: 30, backgroundColor: '#000010', borderWidth: 1, borderColor: theme.accentGlow + '30', borderRadius: 1 }}>
            {[6, 12, 18].map((y2, i) => (
              <View key={i} style={{ position: 'absolute' as const, top: y2, left: 4, width: 40 + i * 10, height: 1, backgroundColor: theme.accentGlow + '30' }} />
            ))}
          </View>
          {/* Buttons row */}
          <View style={{ flexDirection: 'row' as const, gap: 4, paddingHorizontal: 8, marginTop: 4 }}>
            {['#22c55e', '#ef4444', theme.accentGlow, '#f59e0b'].map((c, i) => (
              <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
            ))}
          </View>
        </View>
      </View>
      {/* Hologram projector */}
      <View style={{ position: 'absolute' as const, left: 740, top: 380, alignItems: 'center' as const }}>
        <View style={{ width: 30, height: 6, backgroundColor: theme.deskColor, borderRadius: 3, borderWidth: 1, borderColor: theme.deskBorder }} />
        {/* Hologram beam */}
        <View style={{ width: 20, height: 30, backgroundColor: theme.accentGlow + '08', borderTopLeftRadius: 10, borderTopRightRadius: 10, marginTop: -30 }} />
      </View>
      {/* Recreation pod (lounge) */}
      <View style={[s.lounge, { borderColor: theme.accentGlow + '20', borderStyle: 'dashed' as const }]}>
        <View style={{ width: 100, height: 50, backgroundColor: theme.chairColor, borderRadius: 8, borderWidth: 1, borderColor: theme.chairBorder, alignItems: 'center' as const, justifyContent: 'center' as const }}>
          <Text style={{ fontSize: 8, color: theme.accentGlow + '60', fontFamily: 'monospace' }}>REST POD</Text>
        </View>
      </View>
      {/* Antenna */}
      <View style={{ position: 'absolute' as const, left: 740, top: 200 }}>
        <View style={{ width: 2, height: 40, backgroundColor: theme.wallBorder }} />
        <View style={{ position: 'absolute' as const, top: 0, left: -6, width: 14, height: 3, backgroundColor: theme.wallBorder, borderRadius: 1 }} />
        <View style={{ position: 'absolute' as const, top: -3, left: -2, width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accentGlow }} />
      </View>
      {/* Floor lighting strip */}
      <View style={[s.rug, { backgroundColor: theme.accentGlow + '08', borderColor: theme.accentGlow + '15' }]} />
      <Plant x={20} y={560} />
    </>
  );
}

function SubmarineDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Periscope */}
      <View style={{ position: 'absolute' as const, right: 50, top: 200 }}>
        <View style={{ width: 8, height: 50, backgroundColor: theme.wallBorder, borderRadius: 2 }} />
        <View style={{ position: 'absolute' as const, top: -4, left: -6, width: 20, height: 10, backgroundColor: theme.deskColor, borderRadius: 3, borderWidth: 1, borderColor: theme.wallBorder }} />
        <View style={{ position: 'absolute' as const, top: -2, right: -4, width: 8, height: 6, backgroundColor: '#001a10', borderRadius: 2, borderWidth: 1, borderColor: theme.wallBorder }} />
      </View>
      {/* Depth gauge */}
      <View style={{ position: 'absolute' as const, right: 100, top: 210 }}>
        <View style={{
          width: 30, height: 30, borderRadius: 15, backgroundColor: '#0a1a10',
          borderWidth: 2, borderColor: theme.wallBorder, alignItems: 'center' as const, justifyContent: 'center' as const,
        }}>
          <View style={{ width: 2, height: 10, backgroundColor: theme.accentGlow, transform: [{ rotate: '135deg' }], transformOrigin: 'bottom center' }} />
          <Text style={{ position: 'absolute' as const, fontSize: 5, color: theme.accentGlow, bottom: 2 }}>DEPTH</Text>
        </View>
      </View>
      {/* Torpedo tube */}
      <View style={{ position: 'absolute' as const, left: 740, top: 400 }}>
        <View style={{
          width: 40, height: 18, backgroundColor: theme.deskColor, borderRadius: 9,
          borderWidth: 1, borderColor: theme.wallBorder,
        }}>
          <View style={{ position: 'absolute' as const, right: 2, top: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: '#001010', borderWidth: 1, borderColor: theme.wallBorder }} />
        </View>
      </View>
      {/* Bubble column */}
      <View style={{ position: 'absolute' as const, left: 740, top: 460 }}>
        <View style={{ width: 16, height: 60, backgroundColor: theme.accentGlow + '08', borderRadius: 8, borderWidth: 1, borderColor: theme.accentGlow + '15' }}>
          {[8, 20, 35, 48].map((by, i) => (
            <View key={i} style={{ position: 'absolute' as const, top: by, left: 4 + (i % 2) * 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff08' }} />
          ))}
        </View>
      </View>
      {/* Crew quarters (lounge) */}
      <View style={[s.lounge, { borderColor: theme.wallBorder, borderStyle: 'dashed' as const }]}>
        {/* Bunk-style seating */}
        <View style={{ width: 100, height: 50, gap: 4 }}>
          <View style={{ height: 22, backgroundColor: theme.chairColor, borderRadius: 2, borderWidth: 1, borderColor: theme.chairBorder }} />
          <View style={{ height: 22, backgroundColor: theme.chairColor, borderRadius: 2, borderWidth: 1, borderColor: theme.chairBorder }} />
        </View>
      </View>
      {/* Pipe run across floor */}
      <View style={{ position: 'absolute' as const, top: 780, left: 100, right: 100, height: 6, backgroundColor: theme.deskBorder, borderRadius: 3, opacity: 0.4 }} />
      <View style={[s.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />
    </>
  );
}

function MansionDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Grandfather clock */}
      <View style={{ position: 'absolute' as const, right: 40, top: 200 }}>
        <View style={{
          width: 30, height: 70, backgroundColor: theme.deskColor, borderWidth: 1,
          borderColor: theme.deskBorder, borderTopLeftRadius: 6, borderTopRightRadius: 6,
        }}>
          {/* Clock face */}
          <View style={{
            position: 'absolute' as const, top: 6, left: 5, width: 20, height: 20, borderRadius: 10,
            backgroundColor: '#f5f0e0', borderWidth: 1, borderColor: theme.deskBorder,
            alignItems: 'center' as const, justifyContent: 'center' as const,
          }}>
            <View style={{ width: 1, height: 6, backgroundColor: '#1a1a1a', transform: [{ rotate: '30deg' }] }} />
          </View>
          {/* Pendulum area */}
          <View style={{ position: 'absolute' as const, bottom: 8, left: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accentGlow + '40' }} />
        </View>
      </View>
      {/* Portrait frame */}
      <View style={{ position: 'absolute' as const, right: 120, top: 200 }}>
        <View style={{
          width: 36, height: 44, backgroundColor: theme.deskColor, borderWidth: 2,
          borderColor: theme.accentGlow + '40', borderRadius: 1,
        }}>
          <View style={{ margin: 4, flex: 1, backgroundColor: '#1a0a20', borderRadius: 1 }}>
            <Text style={{ textAlign: 'center' as const, marginTop: 6, fontSize: 16 }}>👤</Text>
          </View>
        </View>
      </View>
      {/* Cobweb corners */}
      {[{ x: 0, y: 190 }, { x: 860, y: 190 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute' as const, left: pos.x, top: pos.y, width: 40, height: 30, opacity: 0.3 }}>
          <View style={{ position: 'absolute' as const, top: 0, left: i === 0 ? 0 : undefined, right: i === 1 ? 0 : undefined, width: 30, height: 1, backgroundColor: '#888' }} />
          <View style={{ position: 'absolute' as const, top: 0, left: i === 0 ? 0 : undefined, right: i === 1 ? 0 : undefined, width: 1, height: 20, backgroundColor: '#888' }} />
          <View style={{ position: 'absolute' as const, top: 0, left: i === 0 ? 0 : undefined, right: i === 1 ? 0 : undefined, width: 20, height: 1, backgroundColor: '#666', transform: [{ rotate: i === 0 ? '45deg' : '-45deg' }], transformOrigin: i === 0 ? 'left top' : 'right top' }} />
        </View>
      ))}
      {/* Fireplace lounge */}
      <View style={[s.lounge, { borderColor: theme.wallBorder, borderStyle: 'dashed' as const }]}>
        <View style={{
          width: 60, height: 50, backgroundColor: theme.deskColor, borderWidth: 1,
          borderColor: theme.deskBorder, borderTopLeftRadius: 8, borderTopRightRadius: 8,
        }}>
          {/* Fire */}
          <View style={{ position: 'absolute' as const, bottom: 4, left: 12, width: 36, height: 20, backgroundColor: '#1a0500', borderRadius: 2 }}>
            <Text style={{ textAlign: 'center' as const, fontSize: 14, marginTop: -2 }}>🔥</Text>
          </View>
        </View>
      </View>
      {/* Candelabra */}
      <View style={{ position: 'absolute' as const, left: 740, top: 480, alignItems: 'center' as const }}>
        <Text style={{ fontSize: 16 }}>🕯️</Text>
      </View>
      <View style={[s.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />
    </>
  );
}

function LairDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Lava pool */}
      <View style={{ position: 'absolute' as const, right: 30, top: 210 }}>
        <View style={{
          width: 80, height: 50, backgroundColor: theme.accentGlow + '20', borderRadius: 20,
          borderWidth: 1, borderColor: theme.accentGlow + '40', overflow: 'hidden' as const,
        }}>
          {/* Lava bubbles */}
          {[{ x: 15, y: 15, s: 8 }, { x: 45, y: 25, s: 6 }, { x: 30, y: 10, s: 5 }].map((b, i) => (
            <View key={i} style={{
              position: 'absolute' as const, left: b.x, top: b.y,
              width: b.s, height: b.s, borderRadius: b.s / 2,
              backgroundColor: '#fbbf24' + '60',
            }} />
          ))}
        </View>
      </View>
      {/* Crystal formation */}
      <View style={{ position: 'absolute' as const, left: 740, top: 380 }}>
        {[{ h: 24, c: theme.accentGlow + '30', w: 6, l: 0 }, { h: 18, c: '#a855f7' + '30', w: 5, l: 8 }, { h: 30, c: theme.accentGlow + '20', w: 7, l: 14 }].map((cr, i) => (
          <View key={i} style={{
            position: 'absolute' as const, bottom: 0, left: cr.l, width: cr.w, height: cr.h,
            backgroundColor: cr.c, borderTopLeftRadius: 2, borderTopRightRadius: 2,
            transform: [{ rotate: `${-8 + i * 8}deg` }],
          }} />
        ))}
      </View>
      {/* Obsidian pillar */}
      <View style={{ position: 'absolute' as const, left: 740, top: 460 }}>
        <View style={{ width: 20, height: 50, backgroundColor: '#1a0800', borderRadius: 2, borderWidth: 1, borderColor: theme.wallBorder }} />
      </View>
      {/* Smoke vents */}
      {[{ x: 20, y: 560 }, { x: 740, y: 540 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute' as const, left: pos.x, top: pos.y }}>
          <View style={{ width: 20, height: 6, backgroundColor: '#333', borderRadius: 3 }} />
          {[0, 6, 12].map((dy, j) => (
            <View key={j} style={{ position: 'absolute' as const, top: -8 - dy, left: 6 + j * 2, width: 4 + j, height: 4, borderRadius: 2, backgroundColor: '#ffffff06' }} />
          ))}
        </View>
      ))}
      {/* Lava rug */}
      <View style={[s.lounge, { borderColor: theme.accentGlow + '20', borderStyle: 'dashed' as const }]}>
        <View style={{ width: 80, height: 40, backgroundColor: theme.accentGlow + '10', borderRadius: 4 }} />
      </View>
      <View style={[s.rug, { backgroundColor: theme.accentGlow + '06', borderColor: theme.accentGlow + '15' }]} />
    </>
  );
}

function CabinDecor({ theme }: { theme: OfficeTheme }) {
  return (
    <>
      {/* Fireplace */}
      <View style={{ position: 'absolute' as const, right: 30, top: 200 }}>
        <View style={{
          width: 80, height: 60, backgroundColor: theme.deskColor, borderWidth: 2,
          borderColor: theme.deskBorder, borderTopLeftRadius: 4, borderTopRightRadius: 4,
        }}>
          {/* Mantel */}
          <View style={{ position: 'absolute' as const, top: -4, left: -4, right: -4, height: 6, backgroundColor: theme.deskBorder, borderRadius: 1 }} />
          {/* Fire opening */}
          <View style={{
            position: 'absolute' as const, bottom: 0, left: 14, right: 14, height: 36,
            backgroundColor: '#0a0400', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          }}>
            <Text style={{ textAlign: 'center' as const, fontSize: 18, marginTop: 8 }}>🔥</Text>
          </View>
        </View>
      </View>
      {/* Animal pelt rug (lounge area) */}
      <View style={[s.lounge, { borderColor: theme.wallBorder, borderStyle: 'dashed' as const }]}>
        <View style={{
          width: 90, height: 50, backgroundColor: theme.chairColor, borderRadius: 20,
          borderWidth: 1, borderColor: theme.chairBorder, opacity: 0.6,
        }} />
      </View>
      {/* Axe on wall */}
      <View style={{ position: 'absolute' as const, left: 740, top: 380 }}>
        <Text style={{ fontSize: 20 }}>🪓</Text>
      </View>
      {/* Lanterns */}
      {[{ x: 740, y: 200 }, { x: 740, y: 460 }].map((pos, i) => (
        <View key={i} style={{ position: 'absolute' as const, left: pos.x, top: pos.y, alignItems: 'center' as const }}>
          <View style={{ width: 2, height: 6, backgroundColor: '#666' }} />
          <View style={{
            width: 12, height: 16, backgroundColor: theme.accentGlow + '25',
            borderRadius: 3, borderWidth: 1, borderColor: theme.deskBorder,
          }}>
            <View style={{ position: 'absolute' as const, top: 5, left: 3, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.accentGlow + '60' }} />
          </View>
        </View>
      ))}
      <Plant x={20} y={560} size="lg" />
      <View style={[s.rug, { backgroundColor: theme.rugColor, borderColor: theme.rugBorder }]} />
    </>
  );
}

function renderDecor(env: EnvironmentType, theme: OfficeTheme) {
  switch (env) {
    case 'ship': return <ShipDecor theme={theme} />;
    case 'castle': return <CastleDecor theme={theme} />;
    case 'station': return <StationDecor theme={theme} />;
    case 'submarine': return <SubmarineDecor theme={theme} />;
    case 'mansion': return <MansionDecor theme={theme} />;
    case 'lair': return <LairDecor theme={theme} />;
    case 'cabin': return <CabinDecor theme={theme} />;
    case 'temple': return <CastleDecor theme={theme} />;
    case 'garden': return <CabinDecor theme={theme} />;
    case 'cyber': return <StationDecor theme={theme} />;
    case 'arctic': return <StationDecor theme={theme} />;
    default: return <OfficeDecor theme={theme} />;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT: FLOOR PATTERN
// ═══════════════════════════════════════════════════════════════════════════════

function renderFloorPattern(env: EnvironmentType, theme: OfficeTheme): React.ReactElement[] {
  switch (env) {
    case 'ship': {
      // Wood plank lines with grain and nail details
      const planks: React.ReactElement[] = [];
      for (let y = 190; y < FLOOR_H; y += 20) {
        const row = (y - 190) / 20;
        const offset = row % 2 === 0 ? 0 : 80;
        planks.push(
          <View key={`sp${y}`} style={{ position: 'absolute' as const, top: y, left: 12, right: 0, height: 19 }}>
            <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1, backgroundColor: theme.wallBorder + '30' }} />
            {/* Board seam (vertical joint) */}
            <View style={{ position: 'absolute' as const, top: 0, left: offset + 160, width: 1, height: 19, backgroundColor: theme.wallBorder + '15' }} />
            <View style={{ position: 'absolute' as const, top: 0, left: offset + 400, width: 1, height: 19, backgroundColor: theme.wallBorder + '12' }} />
            <View style={{ position: 'absolute' as const, top: 0, left: offset + 640, width: 1, height: 19, backgroundColor: theme.wallBorder + '12' }} />
            {/* Subtle grain */}
            <View style={{ position: 'absolute' as const, top: 6, left: offset + 40, width: 40, height: 1, backgroundColor: theme.wallBorder + '08' }} />
          </View>
        );
      }
      return planks;
    }
    case 'castle': {
      // Stone tile pattern with varied sizes
      const tiles: React.ReactElement[] = [];
      for (let y = 190; y < FLOOR_H; y += 40) {
        const row = ((y - 190) / 40);
        const offset = row % 2 === 0 ? 0 : 20;
        for (let x = 10 + offset; x < FLOOR_W; x += 40) {
          tiles.push(
            <View key={`ct${x}-${y}`} style={{ position: 'absolute' as const, top: y, left: x, width: 38, height: 38, borderWidth: 1, borderColor: theme.wallBorder + '12', borderRadius: 1 }}>
              {/* Stone highlight */}
              <View style={{ position: 'absolute' as const, top: 1, left: 1, right: 10, height: 1, backgroundColor: '#ffffff04' }} />
              {/* Stone speckle */}
              {(x + y) % 120 === 0 && <View style={{ position: 'absolute' as const, top: 12, left: 15, width: 3, height: 2, borderRadius: 1, backgroundColor: theme.wallBorder + '08' }} />}
            </View>
          );
        }
      }
      return tiles;
    }
    case 'station': {
      // Metal grating with panel borders
      const grates: React.ReactElement[] = [];
      for (let y = 190; y < FLOOR_H; y += 32) {
        grates.push(<View key={`sg${y}`} style={{ position: 'absolute' as const, top: y, left: 10, right: 0, height: 1, backgroundColor: theme.accentGlow + '06' }} />);
      }
      for (let x = 10; x < FLOOR_W; x += 32) {
        grates.push(<View key={`sg${x}v`} style={{ position: 'absolute' as const, top: 190, left: x, width: 1, height: FLOOR_H - 190, backgroundColor: theme.accentGlow + '05' }} />);
      }
      // Floor panels with slight variation
      for (let y = 192; y < FLOOR_H; y += 128) {
        for (let x = 12; x < FLOOR_W; x += 128) {
          grates.push(
            <View key={`fp${x}-${y}`} style={{ position: 'absolute' as const, top: y, left: x, width: 124, height: 124, borderWidth: 1, borderColor: theme.accentGlow + '04', borderRadius: 1 }} />
          );
        }
      }
      return grates;
    }
    case 'submarine': {
      // Metal floor plates
      const plates: React.ReactElement[] = [];
      for (let y = 192; y < FLOOR_H; y += 48) {
        for (let x = 14; x < FLOOR_W; x += 80) {
          plates.push(
            <View key={`sub${x}-${y}`} style={{ position: 'absolute' as const, top: y, left: x, width: 76, height: 44, borderWidth: 1, borderColor: theme.wallBorder + '10', borderRadius: 1 }}>
              {/* Plate rivets */}
              <View style={{ position: 'absolute' as const, top: 2, left: 2, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.wallBorder + '15' }} />
              <View style={{ position: 'absolute' as const, top: 2, right: 2, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.wallBorder + '15' }} />
              <View style={{ position: 'absolute' as const, bottom: 2, left: 2, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.wallBorder + '15' }} />
              <View style={{ position: 'absolute' as const, bottom: 2, right: 2, width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.wallBorder + '15' }} />
            </View>
          );
        }
      }
      return plates;
    }
    case 'mansion': {
      // Hardwood parquet pattern
      const parquet: React.ReactElement[] = [];
      for (let y = 192; y < FLOOR_H; y += 24) {
        const row = ((y - 192) / 24);
        for (let x = 12; x < FLOOR_W; x += 48) {
          const hor = row % 2 === 0;
          parquet.push(
            <View key={`pq${x}-${y}`} style={{ position: 'absolute' as const, top: y, left: x, width: 46, height: 22 }}>
              {hor ? (
                // Horizontal planks
                <>
                  <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 10, borderBottomWidth: 1, borderColor: theme.wallBorder + '08' }} />
                  <View style={{ position: 'absolute' as const, top: 11, left: 0, right: 0, height: 10, borderBottomWidth: 1, borderColor: theme.wallBorder + '06' }} />
                </>
              ) : (
                // Vertical planks
                <>
                  <View style={{ position: 'absolute' as const, top: 0, left: 0, width: 22, height: 22, borderRightWidth: 1, borderColor: theme.wallBorder + '08' }} />
                  <View style={{ position: 'absolute' as const, top: 0, left: 23, width: 22, height: 22, borderRightWidth: 1, borderColor: theme.wallBorder + '06' }} />
                </>
              )}
            </View>
          );
        }
      }
      return parquet;
    }
    case 'lair': {
      // Rough volcanic rock floor
      const rocks: React.ReactElement[] = [];
      for (let y = 195; y < FLOOR_H; y += 50) {
        for (let x = 15; x < FLOOR_W; x += 60) {
          rocks.push(
            <View key={`lr${x}-${y}`} style={{ position: 'absolute' as const, top: y, left: x, width: 55, height: 45, borderWidth: 1, borderColor: theme.wallBorder + '08', borderRadius: 3 }}>
              {/* Lava seam */}
              <View style={{ position: 'absolute' as const, top: 20, left: 5, width: 20, height: 1, backgroundColor: theme.accentGlow + '08', borderRadius: 0.5 }} />
            </View>
          );
        }
      }
      return rocks;
    }
    case 'cabin': {
      // Wide wood planks
      const planks: React.ReactElement[] = [];
      for (let y = 190; y < FLOOR_H; y += 28) {
        planks.push(
          <View key={`cb${y}`} style={{ position: 'absolute' as const, top: y, left: 12, right: 0, height: 27 }}>
            <View style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1, backgroundColor: theme.wallBorder + '20' }} />
            {/* Grain lines */}
            <View style={{ position: 'absolute' as const, top: 8, left: 40, width: 60, height: 1, backgroundColor: theme.wallBorder + '06' }} />
            <View style={{ position: 'absolute' as const, top: 18, left: 200, width: 50, height: 1, backgroundColor: theme.wallBorder + '05' }} />
          </View>
        );
      }
      return planks;
    }
    default: {
      // Standard grid
      const lines: React.ReactElement[] = [];
      for (let i = 0; i < FLOOR_W / GRID_SIZE; i++) {
        lines.push(<View key={`v${i}`} style={[s.gridV, { left: i * GRID_SIZE, backgroundColor: theme.gridColor }]} />);
      }
      for (let i = 0; i < FLOOR_H / GRID_SIZE; i++) {
        lines.push(<View key={`h${i}`} style={[s.gridH, { top: i * GRID_SIZE, backgroundColor: theme.gridColor }]} />);
      }
      return lines;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PIXEL ART ACCESSORY STRIP — fills gap between wall & first desk row
// ═══════════════════════════════════════════════════════════════════════════════

function AccessoryStrip({ theme }: { theme: OfficeTheme }) {
  const Y = 193; // just below wallTop (190px)
  const accent = theme.accentGlow || '#6366f1';
  return (
    <View style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 260, zIndex: 1, pointerEvents: 'none' } as any}>

      {/* ── Water Cooler (x=30) ─────────────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 34, top: Y }}>
        {/* Jug (top) */}
        <View style={{ width: 14, height: 14, backgroundColor: '#a5c8e8', borderRadius: 7, borderWidth: 1, borderColor: '#7ba8d4', alignSelf: 'center' as const }} />
        {/* Body */}
        <View style={{ width: 18, height: 24, backgroundColor: '#e2e8f0', borderRadius: 2, borderWidth: 1, borderColor: '#cbd5e1', alignSelf: 'center' as const, marginTop: -2 }}>
          {/* Water level */}
          <View style={{ position: 'absolute' as const, bottom: 2, left: 2, right: 2, height: 12, backgroundColor: '#93c5fd40', borderRadius: 1 }} />
          {/* Tap */}
          <View style={{ position: 'absolute' as const, right: -4, top: 14, width: 5, height: 3, backgroundColor: '#94a3b8', borderRadius: 1 }} />
        </View>
        {/* Legs */}
        <View style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const, width: 16, alignSelf: 'center' as const }}>
          <View style={{ width: 2, height: 8, backgroundColor: '#94a3b8' }} />
          <View style={{ width: 2, height: 8, backgroundColor: '#94a3b8' }} />
        </View>
      </View>

      {/* ── Filing Cabinet (x=100) ──────────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 100, top: Y + 4 }}>
        <View style={{ width: 28, height: 40, backgroundColor: '#374151', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' }}>
          {/* Drawer 1 */}
          <View style={{ marginTop: 3, marginHorizontal: 2, height: 10, backgroundColor: '#1f2937', borderRadius: 1, borderWidth: 1, borderColor: '#4b556340' }}>
            <View style={{ position: 'absolute' as const, top: 3, left: 8, width: 8, height: 3, backgroundColor: '#6b7280', borderRadius: 1 }} />
          </View>
          {/* Drawer 2 */}
          <View style={{ marginTop: 2, marginHorizontal: 2, height: 10, backgroundColor: '#1f2937', borderRadius: 1, borderWidth: 1, borderColor: '#4b556340' }}>
            <View style={{ position: 'absolute' as const, top: 3, left: 8, width: 8, height: 3, backgroundColor: '#6b7280', borderRadius: 1 }} />
          </View>
          {/* Drawer 3 (slightly open) */}
          <View style={{ marginTop: 2, marginHorizontal: 2, height: 10, backgroundColor: '#1f2937', borderRadius: 1, borderWidth: 1, borderColor: '#4b556340' }}>
            <View style={{ position: 'absolute' as const, top: 3, left: 8, width: 8, height: 3, backgroundColor: '#6b7280', borderRadius: 1 }} />
            {/* Paper sticking out */}
            <View style={{ position: 'absolute' as const, top: -3, left: 6, width: 10, height: 4, backgroundColor: '#f1f5f9', borderTopLeftRadius: 1, borderTopRightRadius: 1 }} />
          </View>
        </View>
      </View>

      {/* ── Bookshelf (x=200) ──────────────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 195, top: Y - 2 }}>
        {/* Frame */}
        <View style={{ width: 50, height: 48, backgroundColor: '#44403c', borderRadius: 2, borderWidth: 1, borderColor: '#57534e' }}>
          {/* Shelf divider */}
          <View style={{ position: 'absolute' as const, top: 22, left: 2, right: 2, height: 2, backgroundColor: '#57534e' }} />
          {/* Top shelf books */}
          <View style={{ position: 'absolute' as const, top: 3, left: 4, flexDirection: 'row' as const, gap: 1 }}>
            <View style={{ width: 5, height: 18, backgroundColor: '#ef4444', borderRadius: 1 }} />
            <View style={{ width: 6, height: 16, backgroundColor: '#3b82f6', borderRadius: 1, marginTop: 2 }} />
            <View style={{ width: 5, height: 18, backgroundColor: '#22c55e', borderRadius: 1 }} />
            <View style={{ width: 4, height: 15, backgroundColor: '#f59e0b', borderRadius: 1, marginTop: 3 }} />
            <View style={{ width: 6, height: 17, backgroundColor: '#8b5cf6', borderRadius: 1, marginTop: 1 }} />
            <View style={{ width: 5, height: 18, backgroundColor: '#ec4899', borderRadius: 1 }} />
          </View>
          {/* Bottom shelf books */}
          <View style={{ position: 'absolute' as const, top: 26, left: 4, flexDirection: 'row' as const, gap: 1 }}>
            <View style={{ width: 6, height: 18, backgroundColor: '#06b6d4', borderRadius: 1 }} />
            <View style={{ width: 5, height: 16, backgroundColor: '#d946ef', borderRadius: 1, marginTop: 2 }} />
            <View style={{ width: 7, height: 18, backgroundColor: '#64748b', borderRadius: 1 }} />
            <View style={{ width: 5, height: 17, backgroundColor: '#f97316', borderRadius: 1, marginTop: 1 }} />
            <View style={{ width: 6, height: 15, backgroundColor: '#14b8a6', borderRadius: 1, marginTop: 3 }} />
          </View>
        </View>
      </View>

      {/* ── Coat Rack (x=310) ──────────────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 315, top: Y }}>
        {/* Pole */}
        <View style={{ width: 3, height: 44, backgroundColor: '#78716c', alignSelf: 'center' as const }}>
          {/* Top knob */}
          <View style={{ position: 'absolute' as const, top: -3, left: -2, width: 7, height: 5, backgroundColor: '#a8a29e', borderRadius: 3 }} />
          {/* Hooks */}
          <View style={{ position: 'absolute' as const, top: 6, left: -8, width: 8, height: 2, backgroundColor: '#78716c', borderTopLeftRadius: 2 }} />
          <View style={{ position: 'absolute' as const, top: 6, right: -8, width: 8, height: 2, backgroundColor: '#78716c', borderTopRightRadius: 2 }} />
          <View style={{ position: 'absolute' as const, top: 14, left: -6, width: 6, height: 2, backgroundColor: '#78716c', borderTopLeftRadius: 2 }} />
          <View style={{ position: 'absolute' as const, top: 14, right: -6, width: 6, height: 2, backgroundColor: '#78716c', borderTopRightRadius: 2 }} />
          {/* Hanging jacket */}
          <View style={{ position: 'absolute' as const, top: 8, left: -12, width: 10, height: 18, backgroundColor: '#1e293b', borderRadius: 2, borderWidth: 1, borderColor: '#334155' }} />
          {/* Hanging scarf */}
          <View style={{ position: 'absolute' as const, top: 16, right: -10, width: 4, height: 20, backgroundColor: accent + '60', borderRadius: 1 }} />
        </View>
        {/* Base */}
        <View style={{ width: 20, height: 3, backgroundColor: '#78716c', borderRadius: 1, alignSelf: 'center' as const }} />
      </View>

      {/* ── Printer/Fax (x=430) ───────────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 425, top: Y + 18 }}>
        {/* Printer body */}
        <View style={{ width: 32, height: 18, backgroundColor: '#1f2937', borderRadius: 2, borderWidth: 1, borderColor: '#374151' }}>
          {/* Paper tray in */}
          <View style={{ position: 'absolute' as const, top: -5, left: 6, width: 20, height: 5, backgroundColor: '#e2e8f0', borderTopLeftRadius: 2, borderTopRightRadius: 2, borderWidth: 1, borderColor: '#cbd5e1' }} />
          {/* Paper coming out */}
          <View style={{ position: 'absolute' as const, bottom: -6, left: 8, width: 16, height: 8, backgroundColor: '#f8fafc', borderBottomLeftRadius: 1, borderBottomRightRadius: 1 }}>
            {/* Print lines */}
            <View style={{ marginTop: 2, marginHorizontal: 2, height: 1, backgroundColor: '#94a3b840' }} />
            <View style={{ marginTop: 1, marginHorizontal: 2, height: 1, backgroundColor: '#94a3b830', width: 8 }} />
          </View>
          {/* Status LED */}
          <View style={{ position: 'absolute' as const, top: 3, right: 4, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#22c55e' }} />
          {/* Button */}
          <View style={{ position: 'absolute' as const, top: 8, right: 4, width: 5, height: 3, backgroundColor: '#374151', borderRadius: 1 }} />
        </View>
        {/* Small table under printer */}
        <View style={{ width: 36, height: 10, backgroundColor: theme.deskColor || '#2d2d3e', borderRadius: 1, borderWidth: 1, borderColor: theme.deskBorder || '#3d3d50', marginTop: -1, alignSelf: 'center' as const }} />
      </View>

      {/* ── Tall Plant / Fern (x=530) ─────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 535, top: Y - 6 }}>
        {/* Leaves (layered) */}
        <View style={{ alignItems: 'center' as const }}>
          <View style={{ width: 8, height: 14, backgroundColor: '#166534', borderRadius: 4, transform: [{ rotate: '-15deg' }], marginBottom: -4 }} />
          <View style={{ width: 10, height: 16, backgroundColor: '#15803d', borderRadius: 5, marginLeft: -6, marginBottom: -6 }} />
          <View style={{ width: 10, height: 16, backgroundColor: '#22c55e', borderRadius: 5, marginLeft: 8, marginTop: -10 }} />
          <View style={{ width: 8, height: 12, backgroundColor: '#16a34a', borderRadius: 4, marginTop: -4 }} />
        </View>
        {/* Stem */}
        <View style={{ width: 3, height: 14, backgroundColor: '#166534', alignSelf: 'center' as const, marginTop: -2 }} />
        {/* Pot */}
        <View style={{ width: 18, height: 14, backgroundColor: '#92400e', borderBottomLeftRadius: 3, borderBottomRightRadius: 3, alignSelf: 'center' as const }}>
          <View style={{ width: 20, height: 4, backgroundColor: '#a16207', borderRadius: 1, alignSelf: 'center' as const }} />
          {/* Soil */}
          <View style={{ position: 'absolute' as const, top: 4, left: 2, right: 2, height: 3, backgroundColor: '#3d1f00', borderRadius: 1 }} />
        </View>
      </View>

      {/* ── Notice Board / Pin Board (on wall, x=650) ─────────── */}
      <View style={{ position: 'absolute' as const, left: 640, top: Y - 40 }}>
        {/* Cork board */}
        <View style={{ width: 56, height: 36, backgroundColor: '#b8860b30', borderRadius: 2, borderWidth: 2, borderColor: '#44403c' }}>
          {/* Pinned notes */}
          <View style={{ position: 'absolute' as const, top: 4, left: 5, width: 14, height: 12, backgroundColor: '#fef08a', borderRadius: 1, transform: [{ rotate: '-3deg' }] }}>
            {/* Pin */}
            <View style={{ position: 'absolute' as const, top: -2, left: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: '#ef4444' }} />
          </View>
          <View style={{ position: 'absolute' as const, top: 6, left: 24, width: 12, height: 14, backgroundColor: '#bfdbfe', borderRadius: 1, transform: [{ rotate: '2deg' }] }}>
            <View style={{ position: 'absolute' as const, top: -2, left: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#3b82f6' }} />
          </View>
          <View style={{ position: 'absolute' as const, top: 3, right: 5, width: 13, height: 11, backgroundColor: '#bbf7d0', borderRadius: 1, transform: [{ rotate: '-1deg' }] }}>
            <View style={{ position: 'absolute' as const, top: -2, left: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: '#22c55e' }} />
          </View>
          <View style={{ position: 'absolute' as const, bottom: 4, left: 12, width: 16, height: 10, backgroundColor: '#fecdd3', borderRadius: 1, transform: [{ rotate: '1deg' }] }}>
            <View style={{ position: 'absolute' as const, top: -2, left: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: '#f97316' }} />
          </View>
          <View style={{ position: 'absolute' as const, bottom: 5, right: 8, width: 11, height: 9, backgroundColor: '#e9d5ff', borderRadius: 1, transform: [{ rotate: '-2deg' }] }}>
            <View style={{ position: 'absolute' as const, top: -2, left: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#a855f7' }} />
          </View>
        </View>
      </View>

      {/* ── Small Rug / Welcome Mat (x=400, on floor) ─────────── */}
      <View style={{ position: 'absolute' as const, left: 360, top: Y + 36 }}>
        <View style={{ width: 60, height: 16, backgroundColor: accent + '12', borderRadius: 3, borderWidth: 1, borderColor: accent + '20' }}>
          {/* Rug pattern — center stripe */}
          <View style={{ position: 'absolute' as const, top: 5, left: 8, right: 8, height: 2, backgroundColor: accent + '18', borderRadius: 1 }} />
          {/* Diamond pattern */}
          <View style={{ position: 'absolute' as const, top: 3, left: 26, width: 8, height: 8, backgroundColor: accent + '10', borderRadius: 1, transform: [{ rotate: '45deg' }] }} />
        </View>
      </View>

      {/* ── Umbrella Stand (x=770) ────────────────────────────── */}
      <View style={{ position: 'absolute' as const, left: 775, top: Y + 8 }}>
        {/* Bucket */}
        <View style={{ width: 16, height: 20, backgroundColor: '#374151', borderBottomLeftRadius: 3, borderBottomRightRadius: 3, borderWidth: 1, borderColor: '#4b5563' }}>
          {/* Umbrella handles sticking out */}
          <View style={{ position: 'absolute' as const, top: -14, left: 2, width: 2, height: 16, backgroundColor: '#1e40af', transform: [{ rotate: '-5deg' }] }}>
            <View style={{ position: 'absolute' as const, top: 0, left: -3, width: 6, height: 4, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#1e40af' }} />
          </View>
          <View style={{ position: 'absolute' as const, top: -12, right: 2, width: 2, height: 14, backgroundColor: '#991b1b', transform: [{ rotate: '4deg' }] }}>
            <View style={{ position: 'absolute' as const, top: 0, right: -3, width: 6, height: 4, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#991b1b' }} />
          </View>
        </View>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLACED FURNITURE RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

function FurnitureRenderer({ item, theme, onPress, onMove, editMode, selected }: {
  item: FurnitureItem;
  theme: OfficeTheme;
  onPress: () => void;
  onMove?: (x: number, y: number) => void;
  editMode?: boolean;
  selected?: boolean;
}) {
  const content = renderFurnitureContent(item, theme);
  const dragRef = React.useRef<{ startX: number; startY: number; itemX: number; itemY: number; dragging: boolean } | null>(null);
  const elRef = React.useRef<any>(null);
  const moveRef = React.useRef(onMove);
  const pressRef = React.useRef(onPress);
  const posRef = React.useRef({ x: item.x, y: item.y });
  moveRef.current = onMove;
  pressRef.current = onPress;
  posRef.current = { x: item.x, y: item.y };

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !editMode || !elRef.current) return;
    const el = elRef.current;

    const handlePointerDown = (e: PointerEvent) => {
      if (!moveRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, itemX: posRef.current.x, itemY: posRef.current.y, dragging: false };

      const onPointerMove = (me: PointerEvent) => {
        if (!dragRef.current) return;
        const dx = me.clientX - dragRef.current.startX;
        const dy = me.clientY - dragRef.current.startY;
        if (!dragRef.current.dragging && Math.abs(dx) + Math.abs(dy) > 4) {
          dragRef.current.dragging = true;
        }
        if (dragRef.current.dragging) {
          // Find the scale transform on the office wrapper
          let scale = 1;
          let parent = el.parentElement;
          while (parent) {
            const t = parent.style?.transform || '';
            const m = t.match(/scale\(([\d.]+)\)/);
            if (m) { scale = parseFloat(m[1]); break; }
            parent = parent.parentElement;
          }
          const newX = Math.round((dragRef.current.itemX + dx / scale) / GRID_SIZE) * GRID_SIZE;
          const newY = Math.round((dragRef.current.itemY + dy / scale) / GRID_SIZE) * GRID_SIZE;
          el.style.left = newX + 'px';
          el.style.top = newY + 'px';
        }
      };

      const onPointerUp = (ue: PointerEvent) => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        if (dragRef.current?.dragging) {
          let scale = 1;
          let parent = el.parentElement;
          while (parent) {
            const t = parent.style?.transform || '';
            const m = t.match(/scale\(([\d.]+)\)/);
            if (m) { scale = parseFloat(m[1]); break; }
            parent = parent.parentElement;
          }
          const dx = ue.clientX - dragRef.current.startX;
          const dy = ue.clientY - dragRef.current.startY;
          const newX = Math.max(0, Math.min(FLOOR_W - 20, Math.round((dragRef.current.itemX + dx / scale) / GRID_SIZE) * GRID_SIZE));
          const newY = Math.max(0, Math.min(FLOOR_H - 20, Math.round((dragRef.current.itemY + dy / scale) / GRID_SIZE) * GRID_SIZE));
          moveRef.current?.(newX, newY);
        } else {
          pressRef.current();
        }
        dragRef.current = null;
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    };

    el.addEventListener('pointerdown', handlePointerDown);
    return () => el.removeEventListener('pointerdown', handlePointerDown);
  }, [editMode]);

  return (
    <View
      ref={elRef}
      style={[s.placedWrap, { left: item.x, top: item.y },
        Platform.OS === 'web' && { cursor: editMode ? 'grab' : 'default', userSelect: 'none' } as any,
        selected && s.placedSelected,
      ]}
    >
      {content}
      {editMode && selected && (
        <Pressable onPress={() => { pressRef.current(); }} style={s.editDeleteBtn}>
          <Text style={s.editDeleteText}>DELETE</Text>
        </Pressable>
      )}
      {editMode && !selected && (
        <View style={s.editGrabHint}>
          <Text style={s.editGrabText}>⋮⋮</Text>
        </View>
      )}
    </View>
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
                <View key={col} style={[s.fBook, { backgroundColor: ['#ef4444','#3b82f6','#22c55e','#f59e0b','#8b5cf6'][(row * 4 + col) % 5] }]} />
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
            <View style={[s.fWBLine, { width: '80%' as any, marginTop: 4 }]} />
            <View style={[s.fWBLine, { width: '60%' as any }]} />
            <View style={[s.fWBLine, { width: '70%' as any }]} />
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
    case 'nft_frame':
      return (
        <View style={[s.fNftFrame, { borderColor: theme.accentGlow }]}>
          {item.nftImageUrl ? (
            <Image source={{ uri: item.nftImageUrl }} style={s.fNftImage} resizeMode="cover" />
          ) : (
            <View style={s.fNftPlaceholder}>
              <Text style={s.fNftPlaceholderIcon}>🖼</Text>
              <Text style={s.fNftPlaceholderText}>TAP TO SET</Text>
            </View>
          )}
        </View>
      );
    default:
      return <Text style={{ fontSize: 20 }}>📦</Text>;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN FLOOR COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function OfficeFloor({ theme: themeProp, furniture = [], onFloorPress, onFurniturePress, onFurnitureMove, selectedFurnitureId, editMode }: Props) {
  const theme = themeProp || OFFICE_THEMES.underground;
  const env = theme.environmentType || 'office';

  const bgSource = THEME_BACKGROUNDS[env] || null;
  const useSprite = !!bgSource;
  const floorPattern = useSprite ? null : renderFloorPattern(env, theme);

  const floorRef = React.useRef<any>(null);

  const handlePress = (e: any) => {
    if (!onFloorPress) return;
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
    const { locationX, locationY } = e.nativeEvent || {};
    if (locationX != null && locationY != null) {
      const x = Math.round(locationX / GRID_SIZE) * GRID_SIZE;
      const y = Math.round(locationY / GRID_SIZE) * GRID_SIZE;
      onFloorPress(x, y);
    }
  };

  return (
    <Pressable ref={floorRef} onPress={handlePress} style={[s.floor, { backgroundColor: theme.floorColor }]}>
      {/* PNG sprite background (replaces walls/windows/decor/floor pattern) */}
      {useSprite && bgSource ? (
        <Image source={bgSource} style={s.bgImage} resizeMode="cover" />
      ) : (
        <>
          {floorPattern}
          {renderWall(env, theme)}
          {renderWindow(env, theme)}
          {renderDecor(env, theme)}
        </>
      )}

      {/* Pixel art accessories — fills gap between wall and desks */}
      <AccessoryStrip theme={theme} />

      {/* Environment desks (always render as Views for agent positioning) */}
      {DESK_POSITIONS.map((pos, i) => (
        <React.Fragment key={i}>{renderDesk(env, pos.x, pos.y, theme)}</React.Fragment>
      ))}

      {/* User-placed furniture (2D rendering + click handlers) */}
      {furniture.map(item => (
        <FurnitureRenderer
          key={item.id}
          item={item}
          theme={theme}
          onPress={() => onFurniturePress?.(item.id)}
          onMove={onFurnitureMove ? (x, y) => onFurnitureMove(item.id, x, y) : undefined}
          editMode={editMode}
          selected={selectedFurnitureId === item.id}
        />
      ))}

      {/* Floor label removed */}
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  floor: { width: FLOOR_W, height: FLOOR_H, position: 'relative', overflow: 'hidden' },
  bgImage: { position: 'absolute', top: 0, left: 0, width: FLOOR_W, height: FLOOR_H, zIndex: 0 },
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
  plantWrap: { position: 'absolute', alignItems: 'center' },
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
  floorLabel: { fontSize: 7, color: '#444', fontFamily: 'monospace', letterSpacing: 2 },

  placedWrap: { position: 'absolute', zIndex: 8 },
  placedSelected: { zIndex: 20, ...(Platform.OS === 'web' ? { outline: '2px solid #3b82f6', outlineOffset: 2, borderRadius: 2 } as any : { borderWidth: 2, borderColor: '#3b82f6', borderRadius: 2 }) },
  editDeleteBtn: { position: 'absolute', top: -20, left: '50%' as any, marginLeft: -22, width: 44, height: 18, borderRadius: 4, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', zIndex: 12, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  editDeleteText: { color: '#fff', fontSize: 7, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.5 },
  editGrabHint: { position: 'absolute', top: -2, right: -8, width: 12, height: 12, borderRadius: 2, backgroundColor: '#ffffff30', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  editGrabText: { color: '#fff', fontSize: 6, fontWeight: '800', lineHeight: 10 },

  fPlant: { alignItems: 'center', width: 24, height: 28 },
  fPlantLeaf: { position: 'absolute', top: 0, width: 10, height: 12, borderRadius: 6 },
  fPlantPot: { width: 14, height: 10, backgroundColor: '#78350f', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, marginTop: 14 },
  fCouch: { width: 80, height: 38, borderRadius: 4, borderWidth: 1, position: 'relative' },
  fCouchBack: { position: 'absolute', top: 0, left: 0, right: 0, height: 10, borderRadius: 4, opacity: 0.5 },
  fCouchArmL: { position: 'absolute', left: 0, top: 10, width: 8, height: 28, backgroundColor: '#ffffff20', borderRadius: 2 },
  fCouchArmR: { position: 'absolute', right: 0, top: 10, width: 8, height: 28, backgroundColor: '#ffffff20', borderRadius: 2 },
  fCouchCushion: { position: 'absolute', bottom: 4, left: 10, right: 10, height: 14, borderRadius: 3, opacity: 0.7 },
  fBeanBag: { width: 34, height: 30, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fBeanBagInner: { width: 20, height: 18, borderRadius: 10 },
  fLamp: { alignItems: 'center', width: 20, height: 50 },
  fLampHead: { width: 20, height: 10, borderRadius: 10, borderWidth: 1 },
  fLampPole: { width: 2, height: 30, backgroundColor: '#94a3b8' },
  fLampBase: { width: 14, height: 4, backgroundColor: '#64748b', borderRadius: 2 },
  fShelf: { width: 60, height: 42, borderWidth: 1, padding: 3, gap: 2 },
  fShelfRow: { flexDirection: 'row', gap: 2, flex: 1 },
  fBook: { flex: 1, borderRadius: 1 },
  fTV: { alignItems: 'center', width: 80 },
  fTVScreen: { width: 78, height: 46, borderWidth: 2, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fTVGlow: { position: 'absolute', inset: 0 } as any,
  fTVText: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  fTVStand: { width: 6, height: 8, backgroundColor: '#64748b' },
  fTVBase: { width: 24, height: 4, backgroundColor: '#475569', borderRadius: 1 },
  fServer: { width: 44, height: 56, borderWidth: 1, padding: 3, gap: 2, borderRadius: 2 },
  fServerUnit: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 10, backgroundColor: '#0f172a', borderRadius: 1, paddingHorizontal: 3 },
  fServerLight: { width: 4, height: 4, borderRadius: 2 },
  fServerBar: { flex: 1, height: 2, backgroundColor: '#1e293b', borderRadius: 1 },
  fWhiteboard: { width: 70, height: 50, borderWidth: 2, borderRadius: 2, padding: 4 },
  fWhiteboardInner: { flex: 1, gap: 4, alignItems: 'center' },
  fWBLine: { height: 1, backgroundColor: '#44444430' },
  fWhiteboardTray: { height: 5, backgroundColor: '#8B7355', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  fStandingDesk: { width: 70, height: 55, position: 'relative' },
  fSDTop: { width: 70, height: 22, borderWidth: 1, position: 'relative' },
  fSDMonitor: { position: 'absolute', top: -14, left: 20, width: 24, height: 16, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155' },
  fSDKeyboard: { position: 'absolute', top: 6, left: 16, width: 30, height: 7, backgroundColor: '#1e1e2e', borderWidth: 1, borderColor: '#334155' },
  fSDLeg: { position: 'absolute', bottom: 0, left: 8, width: 4, height: 33, backgroundColor: '#64748b' },
  fCoffeeWrap: { alignItems: 'center', width: 22 },
  fCoffeeBody: { width: 20, height: 24, backgroundColor: '#374151', borderRadius: 2, borderWidth: 1, borderColor: '#4b5563' },
  fCoffeeTop: { position: 'absolute', top: -4, width: 24, height: 6, backgroundColor: '#4b5563', borderRadius: 2 },
  fCoffeeCup: { position: 'absolute', bottom: -8, left: 0, width: 10, height: 8, backgroundColor: '#f5f5f4', borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  fWaterCooler: { alignItems: 'center', width: 22 },
  fWCBottle: { width: 16, height: 14, borderRadius: 4, borderWidth: 1 },
  fWCBody: { width: 22, height: 24, borderRadius: 2, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3 },
  fWCTap: { width: 8, height: 4, borderRadius: 1 },
  fArcade: { width: 28, height: 48, borderWidth: 1, borderRadius: 2, alignItems: 'center', paddingTop: 4, gap: 4 },
  fArcadeScreen: { width: 22, height: 20, borderWidth: 1, borderRadius: 1, alignItems: 'center', justifyContent: 'center' },
  fArcadeText: { fontSize: 8, fontWeight: '800' },
  fArcadeControls: { flexDirection: 'row', gap: 4 },
  fArcadeBtn: { width: 6, height: 6, borderRadius: 3 },
  fPingTable: { width: 100, height: 44 },
  fPTSurface: { width: 100, height: 36, borderWidth: 2, borderRadius: 2, position: 'relative' },
  fPTNet: { position: 'absolute', top: 0, bottom: 0, left: 48, width: 2, backgroundColor: '#ffffff60' },
  fPTLine: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: '#ffffff30', margin: 4 },
  fPTLeg: { position: 'absolute', bottom: 0, left: 8, width: 4, height: 8, backgroundColor: '#64748b' },
  fSnackBar: { width: 70, height: 40, borderWidth: 1, borderRadius: 2 },
  fSBCounter: { height: 6, backgroundColor: '#ffffff20', borderBottomWidth: 1, borderBottomColor: '#ffffff10' },
  fSBItems: { flexDirection: 'row', gap: 4, padding: 4 },
  fSBIcon: { fontSize: 10 },
  fNeonSign: {
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderRadius: 4,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 8px currentColor' } as any : {}),
  },
  fNeonText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 },
  fTrophy: { width: 54, height: 38, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: 4, paddingBottom: 2 },
  fTrophyItem: { width: 14, height: 20, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fTrophyIcon: { fontSize: 7 },
  fSafe: { width: 32, height: 36, borderWidth: 1, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fSafeDoor: { width: 24, height: 28, borderRadius: 1, borderWidth: 1, borderColor: '#6b7280', alignItems: 'center', justifyContent: 'center', gap: 4 },
  fSafeDial: { width: 10, height: 10, borderRadius: 5 },
  fSafeHandle: { width: 4, height: 10, borderRadius: 2 },
  fRug: { width: 80, height: 50, borderWidth: 1, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  fRugInner: { width: 60, height: 34, borderWidth: 1, borderRadius: 1 },
  fPrinter: { width: 44, height: 28, borderWidth: 1, borderRadius: 2 },
  fPrinterSlot: { height: 4, backgroundColor: '#94a3b8', marginHorizontal: 8, marginTop: 8, borderRadius: 1 },
  fPrinterPanel: { flexDirection: 'row', gap: 3, padding: 5 },
  fPrinterBtn: { width: 6, height: 6, borderRadius: 3 },
  fClock: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fClockFace: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#f8fafc', position: 'relative' },
  fClockHour: { position: 'absolute', top: 3, left: 7, width: 2, height: 5, backgroundColor: '#1e293b', borderRadius: 1, transformOrigin: 'bottom' },
  fClockMin: { position: 'absolute', top: 1, left: 7, width: 1, height: 7, backgroundColor: '#475569', borderRadius: 1, transformOrigin: 'bottom' },
  fWindow: { width: 60, height: 40, borderWidth: 2, borderRadius: 2, overflow: 'hidden' },
  fWindowFrame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: '#ffffff20' },
  fWindowCity: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 20 },
  fWindowBuilding: { position: 'absolute', bottom: 0, width: 9, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  // NFT Frame
  fNftFrame: { width: 72, height: 72, borderWidth: 3, borderRadius: 4, backgroundColor: '#0a0a14', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fNftImage: { width: '100%' as any, height: '100%' as any },
  fNftNameplate: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#00000099', paddingVertical: 2, paddingHorizontal: 4 },
  fNftNameText: { color: '#fff', fontSize: 6, fontFamily: 'monospace', fontWeight: '700', textAlign: 'center' },
  fNftPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  fNftPlaceholderIcon: { fontSize: 18 },
  fNftPlaceholderText: { color: '#555', fontSize: 6, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 },
});
