import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet, Platform,
} from 'react-native';

// ─── Supported systems ────────────────────────────────────────────────────────

export interface EmulatorSystem {
  id: string;
  name: string;
  core: string;       // EmulatorJS core name
  icon: string;
  color: string;
  extensions: string[];
}

export const EMULATOR_SYSTEMS: EmulatorSystem[] = [
  // ── Nintendo handhelds ──
  { id: 'gba',    name: 'Game Boy Advance',  core: 'gba',     icon: '🟣', color: '#a855f7', extensions: ['.gba'] },
  { id: 'gbc',    name: 'Game Boy Color',    core: 'gbc',     icon: '🟡', color: '#fbbf24', extensions: ['.gbc', '.gb'] },
  { id: 'gb',     name: 'Game Boy',          core: 'gb',      icon: '⬜', color: '#22c55e', extensions: ['.gb'] },
  { id: 'nds',    name: 'Nintendo DS',       core: 'nds',     icon: '🔵', color: '#3b82f6', extensions: ['.nds'] },
  // ── Nintendo consoles ──
  { id: 'nes',    name: 'NES',               core: 'nes',     icon: '🔴', color: '#ef4444', extensions: ['.nes'] },
  { id: 'snes',   name: 'SNES',              core: 'snes',    icon: '🟣', color: '#6366f1', extensions: ['.smc', '.sfc'] },
  { id: 'n64',    name: 'Nintendo 64',       core: 'n64',     icon: '🟢', color: '#22c55e', extensions: ['.n64', '.z64', '.v64'] },
  // ── Sega ──
  { id: 'segaMD', name: 'Sega Genesis',      core: 'segaMD',  icon: '⚫', color: '#3b82f6', extensions: ['.md', '.gen', '.bin'] },
  { id: 'segaMS', name: 'Sega Master System', core: 'segaMS', icon: '🔵', color: '#6366f1', extensions: ['.sms'] },
  { id: 'segaGG', name: 'Sega Game Gear',    core: 'segaGG',  icon: '⬛', color: '#f97316', extensions: ['.gg'] },
  { id: 'segaCD', name: 'Sega CD',           core: 'segaCD',  icon: '🔵', color: '#6366f1', extensions: ['.iso', '.bin', '.cue'] },
  { id: 'segaSaturn', name: 'Sega Saturn',   core: 'segaSaturn', icon: '⚪', color: '#a855f7', extensions: ['.iso', '.bin', '.cue'] },
  { id: 'segaDC', name: 'Dreamcast',         core: 'dreamcast', icon: '🌀', color: '#ec4899', extensions: ['.cdi', '.gdi', '.chd'] },
  // ── Sony ──
  { id: 'psx',    name: 'PlayStation',        core: 'psx',     icon: '⬜', color: '#3b82f6', extensions: ['.bin', '.iso', '.cue', '.chd', '.pbp'] },
  // ── Atari ──
  { id: 'atari2600', name: 'Atari 2600',     core: 'atari2600', icon: '🟤', color: '#f97316', extensions: ['.a26', '.bin'] },
  { id: 'atari7800', name: 'Atari 7800',     core: 'atari7800', icon: '🟤', color: '#f59e0b', extensions: ['.a78', '.bin'] },
  // ── Other ──
  { id: 'arcade', name: 'Arcade (MAME)',     core: 'mame2003', icon: '🕹️', color: '#fbbf24', extensions: ['.zip'] },
  { id: 'pce',    name: 'TurboGrafx-16',     core: 'pce',     icon: '🟠', color: '#f97316', extensions: ['.pce'] },
  { id: 'ngp',    name: 'Neo Geo Pocket',    core: 'ngp',     icon: '🔶', color: '#ec4899', extensions: ['.ngp', '.ngc'] },
  { id: 'vb',     name: 'Virtual Boy',       core: 'vb',      icon: '🔴', color: '#ef4444', extensions: ['.vb', '.vboy'] },
  { id: 'ws',     name: 'WonderSwan',        core: 'ws',      icon: '🔷', color: '#6366f1', extensions: ['.ws', '.wsc'] },
];

// Group systems by category
const SYSTEM_CATEGORIES = [
  { label: 'Nintendo Handhelds',  ids: ['gba', 'gbc', 'gb', 'nds'] },
  { label: 'Nintendo Consoles',   ids: ['nes', 'snes', 'n64'] },
  { label: 'Sega',                ids: ['segaMD', 'segaMS', 'segaGG', 'segaCD', 'segaSaturn', 'segaDC'] },
  { label: 'Sony',                ids: ['psx'] },
  { label: 'Atari',               ids: ['atari2600', 'atari7800'] },
  { label: 'Other',               ids: ['arcade', 'pce', 'ngp', 'vb', 'ws'] },
];

// ─── Built-in homebrew game library ──────────────────────────────────────────
// All games are open-source / freeware homebrew — legal to distribute.

interface BuiltInGame {
  name: string;
  file: string;      // path relative to /roms/{systemId}/
  system: string;    // EmulatorSystem id
  author: string;
  description: string;
  genre: string;
}

const BUILTIN_GAMES: BuiltInGame[] = [
  // ── GBA ──
  { name: 'Anguna',              file: 'anguna.gba',           system: 'gba', author: 'Nathan Tolbert', description: 'Zelda-like adventure with 5 dungeons, boss fights & hidden rooms', genre: 'Action RPG' },
  { name: 'Celeste Classic',     file: 'celeste-classic.gba',  system: 'gba', author: 'JeffRuLz',       description: 'Precision platformer — GBA port of the PICO-8 classic',          genre: 'Platformer' },
  { name: 'uCity Advance',       file: 'ucity-advance.gba',    system: 'gba', author: 'AntonioND',      description: 'SimCity-style city builder on GBA — roads, zones, budgets',      genre: 'Simulation' },
  { name: 'Metal Warrior 4',     file: 'metal-warrior-4.gba',  system: 'gba', author: 'Covert Bitops',  description: 'Side-scrolling stealth-action platformer',                       genre: 'Action' },
  { name: 'Goodboy Advance',     file: 'goodboy-advance.gba',  system: 'gba', author: 'Exelotl',        description: 'Exploration platformer — demo of Goodboy Galaxy',                genre: 'Platformer' },
  { name: 'Waimanu',             file: 'waimanu.gba',          system: 'gba', author: 'Sverx',           description: 'Puzzle platformer with block-grinding mechanics',                genre: 'Puzzle' },
  { name: 'Holy Hell',           file: 'holy-hell.gba',        system: 'gba', author: 'Genecyst',        description: 'Fast-paced action game',                                         genre: 'Action' },
  // ── NES ──
  { name: 'Nova the Squirrel',   file: 'nova-the-squirrel.nes', system: 'nes', author: 'NovaSquirrel',  description: '33 levels, 7 bosses, Kirby-style ability copying',               genre: 'Platformer' },
  { name: 'Thwaite',             file: 'thwaite.nes',           system: 'nes', author: 'Damian Yerrick', description: 'Missile Command-style defense — shoot down missiles with fireworks', genre: 'Arcade' },
  { name: 'Legends of Owlia',    file: 'owlia.nes',             system: 'nes', author: 'Gradual Games', description: 'Full action-adventure RPG in the style of StarTropics/Zelda',      genre: 'Action RPG' },
  { name: 'Super Tilt Bro',      file: 'super-tilt-bro.nes',    system: 'nes', author: 'Sylvain Gadrat', description: 'Smash Bros-style fighting game for NES — 2 players',              genre: 'Fighting' },
  { name: 'Twin Dragons',        file: 'twin-dragons.nes',      system: 'nes', author: 'Antoine Gohin', description: 'Co-op platformer for NES',                                        genre: 'Platformer' },
  // ── Game Boy ──
  { name: 'Adjustris',           file: 'adjustris.gb',          system: 'gb',  author: 'Dave VanEe',    description: 'Puzzle game — customize your own piece sets',                      genre: 'Puzzle' },
  // ── GBC ──
  { name: 'uCity',               file: 'ucity.gbc',             system: 'gbc', author: 'AntonioND',     description: 'Full SimCity clone for Game Boy Color — save up to 16 cities',     genre: 'Simulation' },
  { name: 'Geometrix',           file: 'geometrix.gbc',         system: 'gbc', author: 'AntonioND',     description: 'Geometric puzzle game',                                           genre: 'Puzzle' },
  { name: 'Brickster',           file: 'brickster.gbc',         system: 'gbc', author: 'S. Hockenhull', description: 'Brick-breaking arcade action',                                    genre: 'Arcade' },
  { name: 'Burly Bear vs Foxes', file: 'burly-bear.gbc',        system: 'gbc', author: 'S. Mihai',      description: 'Action game starring Burly Bear',                                 genre: 'Action' },
  { name: 'Klondike',            file: 'klondike.gbc',          system: 'gbc', author: 'Harold Toler',  description: 'Classic solitaire card game',                                     genre: 'Card Game' },
  // ── SNES ──
  { name: 'Super Boss Gaiden',   file: 'super-boss-gaiden.sfc', system: 'snes', author: 'Chrono Moogle', description: '16-bit platformer with humor and tight controls',                genre: 'Platformer' },
  { name: 'Jet Pilot Rising',    file: 'jet-pilot-rising.sfc',  system: 'snes', author: 'D4S',           description: 'One-button game — a cat riding a rocket',                        genre: 'Arcade' },
  { name: 'N-Warp Daisakusen',   file: 'n-warp-daisakusen.smc', system: 'snes', author: 'D4S / Nagler', description: '8-player arena death-match (supports Multitap)',                  genre: 'Action' },
  { name: 'Rockfall',            file: 'rockfall.smc',           system: 'snes', author: 'Paul Lay',     description: 'Boulder Dash-style puzzle game',                                  genre: 'Puzzle' },
  { name: 'Bucket',              file: 'bucket.smc',             system: 'snes', author: 'S. Mihai',     description: 'Arcade-style action game',                                        genre: 'Arcade' },
  // ── Sega Genesis / Mega Drive ──
  { name: 'Cave Story MD',       file: 'cave-story.gen',         system: 'segaMD', author: 'andwn',          description: 'Full port of Cave Story — action-adventure with RPG elements',  genre: 'Action RPG' },
  { name: 'Old Towers',          file: 'old-towers.bin',         system: 'segaMD', author: 'RetroSouls',     description: 'Puzzle platformer — navigate towers with clean pixel art',      genre: 'Puzzle' },
  { name: 'Miniplanets',         file: 'miniplanets.bin',        system: 'segaMD', author: 'Sik',            description: 'Run around small circular planets (Mario Galaxy on 16-bit)',    genre: 'Platformer' },
  { name: 'Rick Dangerous',      file: 'rick-dangerous.bin',     system: 'segaMD', author: 'Pascal-O-Rama', description: 'Indiana Jones-inspired action platformer with traps',           genre: 'Action' },
  { name: 'Xump 2: Back in Space', file: 'xump2.bin',           system: 'segaMD', author: 'Retroguru',      description: 'Puzzle game — 48 levels, won 1st at Revision 2017',            genre: 'Puzzle' },
  { name: 'Barbarian',           file: 'barbarian.bin',          system: 'segaMD', author: 'F.L.',           description: 'Classic fighting game port',                                   genre: 'Fighting' },
  { name: 'Junkbots',            file: 'junkbots.bin',           system: 'segaMD', author: 'Moon Watcher',   description: 'Action game for Mega Drive',                                   genre: 'Action' },
];

// Helper: get games for a system
function getGamesForSystem(systemId: string): BuiltInGame[] {
  return BUILTIN_GAMES.filter(g => g.system === systemId);
}

// Helper: get ROM URL for a built-in game
function getBuiltInRomUrl(game: BuiltInGame): string {
  return `/roms/${game.system}/${game.file}`;
}

// ─── EmulatorJS iframe builder ───────────────────────────────────────────────

const EMULATORJS_CDN = 'https://cdn.emulatorjs.org/stable/data/';

function buildEmulatorHtml(romUrl: string, core: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
  #game { width: 100%; height: 100%; }
</style>
</head><body>
<div id="game"></div>
<script>
  EJS_player = '#game';
  EJS_gameUrl = '${romUrl}';
  EJS_core = '${core}';
  EJS_pathtodata = '${EMULATORJS_CDN}';
  EJS_startOnLoaded = true;
  EJS_color = '#6366f1';
  EJS_backgroundBlur = true;
  EJS_backgroundColor = '#0a0a0a';
  EJS_fullscreenOnLoaded = false;
</script>
<script src="${EMULATORJS_CDN}loader.js"><\/script>
</body></html>`;
}

// ─── Genre colors ────────────────────────────────────────────────────────────

const GENRE_COLORS: Record<string, string> = {
  'Action RPG': '#a855f7',
  'Platformer': '#3b82f6',
  'Simulation': '#22c55e',
  'Action':     '#ef4444',
  'Puzzle':     '#f59e0b',
  'Arcade':     '#ec4899',
  'Fighting':   '#f97316',
  'Card Game':  '#6366f1',
};

// ─── Main component ──────────────────────────────────────────────────────────

interface RetroEmulatorProps {
  visible: boolean;
  onClose: () => void;
  initialSystem?: string;
}

export default function RetroEmulator({ visible, onClose, initialSystem }: RetroEmulatorProps) {
  const [selectedSystem, setSelectedSystem] = useState<EmulatorSystem | null>(
    EMULATOR_SYSTEMS.find(s => s.id === (initialSystem || 'gba')) || EMULATOR_SYSTEMS[0]
  );
  const [romLoaded, setRomLoaded] = useState(false);
  const [romUrl, setRomUrl] = useState<string | null>(null);
  const [romName, setRomName] = useState<string>('');
  const [activeCore, setActiveCore] = useState<string>('gba');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Launch a built-in game
  const handlePlayBuiltIn = useCallback((game: BuiltInGame) => {
    const sys = EMULATOR_SYSTEMS.find(s => s.id === game.system);
    if (!sys) return;
    setSelectedSystem(sys);
    setActiveCore(sys.core);
    setRomUrl(getBuiltInRomUrl(game));
    setRomName(game.name);
    setRomLoaded(true);
  }, []);

  // Load ROM from file picker
  const handleRomSelect = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    const input = fileInputRef.current;
    input.accept = selectedSystem?.extensions.join(',') || '*';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setActiveCore(selectedSystem?.core || 'gba');
        setRomUrl(reader.result as string);
        setRomName(file.name);
        setRomLoaded(true);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [selectedSystem]);

  const handleBack = useCallback(() => {
    setRomLoaded(false);
    setRomUrl(null);
    setRomName('');
  }, []);

  const handleClose = useCallback(() => {
    setRomLoaded(false);
    setRomUrl(null);
    setRomName('');
    onClose();
  }, [onClose]);

  if (Platform.OS !== 'web') {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <View style={styles.container} onStartShouldSetResponder={() => true}>
            <Text style={styles.title}>Retro Emulator</Text>
            <Text style={styles.subtitle}>Only available on web</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    );
  }

  const systemGames = selectedSystem ? getGamesForSystem(selectedSystem.id) : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <View style={[styles.container, romLoaded && styles.containerExpanded]} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={styles.header}>
            {romLoaded && (
              <Pressable onPress={handleBack} style={styles.backBtn}>
                <Text style={styles.backBtnText}>{'<'} Back</Text>
              </Pressable>
            )}
            <Text style={styles.title}>
              {romLoaded ? `🎮 ${romName}` : '🎮 Retro Console'}
            </Text>
            <Pressable onPress={handleClose} style={styles.xBtn}>
              <Text style={styles.xBtnText}>✕</Text>
            </Pressable>
          </View>

          {romLoaded && romUrl ? (
            /* Emulator iframe */
            <View style={styles.emulatorWrap}>
              <iframe
                ref={iframeRef as any}
                srcDoc={buildEmulatorHtml(romUrl, activeCore)}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  borderRadius: 4,
                  backgroundColor: '#000',
                }}
                sandbox="allow-scripts allow-same-origin allow-popups"
                title="Retro Emulator"
              />
            </View>
          ) : (
            /* System picker + game library */
            <ScrollView style={styles.scrollArea} contentContainerStyle={{ paddingBottom: 20 }}>
              {/* Controls reference */}
              <View style={styles.controlsBox}>
                <Text style={styles.controlsTitle}>Keyboard Controls</Text>
                <Text style={styles.controlsText}>
                  D-Pad: Arrow keys  |  A: X  |  B: Z  |  Start: Enter  |  Select: Shift  |  L: Q  |  R: E
                </Text>
              </View>

              {/* System selector */}
              <Text style={styles.sectionLabel}>SELECT SYSTEM</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
                {EMULATOR_SYSTEMS.filter(s => {
                  // Only show systems that have built-in games or are popular
                  const hasGames = BUILTIN_GAMES.some(g => g.system === s.id);
                  return hasGames || ['nds', 'n64', 'psx', 'segaDC'].includes(s.id);
                }).map(sys => {
                  const isSelected = selectedSystem?.id === sys.id;
                  const gameCount = getGamesForSystem(sys.id).length;
                  return (
                    <Pressable
                      key={sys.id}
                      onPress={() => setSelectedSystem(sys)}
                      style={[
                        styles.systemChip,
                        isSelected && { borderColor: sys.color, backgroundColor: sys.color + '20' },
                      ]}
                    >
                      <Text style={styles.systemChipIcon}>{sys.icon}</Text>
                      <Text style={[styles.systemChipName, isSelected && { color: sys.color }]}>
                        {sys.name}
                      </Text>
                      {gameCount > 0 && (
                        <View style={[styles.gameCountBadge, { backgroundColor: sys.color + '30' }]}>
                          <Text style={[styles.gameCountText, { color: sys.color }]}>{gameCount}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Built-in games for selected system */}
              {systemGames.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>
                    {selectedSystem?.name.toUpperCase()} GAMES ({systemGames.length})
                  </Text>
                  <View style={styles.gameList}>
                    {systemGames.map((game, i) => {
                      const genreColor = GENRE_COLORS[game.genre] || '#e8e8e8';
                      return (
                        <Pressable
                          key={game.file}
                          onPress={() => handlePlayBuiltIn(game)}
                          style={({ pressed }: any) => [
                            styles.gameCard,
                            pressed && { backgroundColor: '#1a1a1a' },
                          ]}
                        >
                          <View style={styles.gameCardLeft}>
                            <Text style={styles.gameName}>{game.name}</Text>
                            <Text style={styles.gameDesc} numberOfLines={2}>{game.description}</Text>
                            <View style={styles.gameMetaRow}>
                              <View style={[styles.genreBadge, { backgroundColor: genreColor + '20', borderColor: genreColor + '40' }]}>
                                <Text style={[styles.genreText, { color: genreColor }]}>{game.genre}</Text>
                              </View>
                              <Text style={styles.gameAuthor}>by {game.author}</Text>
                            </View>
                          </View>
                          <View style={[styles.playBtn, { backgroundColor: selectedSystem?.color || '#e8e8e8' }]}>
                            <Text style={styles.playBtnText}>PLAY</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              {/* No built-in games message */}
              {systemGames.length === 0 && selectedSystem && (
                <View style={styles.noGamesBox}>
                  <Text style={styles.noGamesIcon}>{selectedSystem.icon}</Text>
                  <Text style={styles.noGamesText}>
                    No built-in games for {selectedSystem.name} yet
                  </Text>
                  <Text style={styles.noGamesSubtext}>
                    Load your own ROM file below
                  </Text>
                </View>
              )}

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or load your own ROM</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Load ROM button */}
              {selectedSystem && (
                <Pressable onPress={handleRomSelect} style={[styles.loadBtn, { borderColor: selectedSystem.color + '60' }]}>
                  <Text style={[styles.loadBtnText, { color: selectedSystem.color }]}>
                    📂  Load {selectedSystem.name} ROM from file
                  </Text>
                </Pressable>
              )}

              {/* All games count */}
              <Text style={styles.footerText}>
                {BUILTIN_GAMES.length} free homebrew games across {
                  new Set(BUILTIN_GAMES.map(g => g.system)).size
                } systems — all open source
              </Text>
            </ScrollView>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%' as any,
    maxWidth: 650,
    maxHeight: '85%' as any,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#6366f1',
    overflow: 'hidden',
  },
  containerExpanded: {
    maxWidth: 900,
    maxHeight: '95%' as any,
    width: '95%' as any,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  title: {
    flex: 1,
    color: '#e8e8e8',
    fontSize: 16,
    fontFamily: 'monospace',
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#6f6f6f',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 8,
  },
  xBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  xBtnText: { color: '#9e9e9e', fontSize: 16 },
  backBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
  },
  backBtnText: { color: '#9e9e9e', fontSize: 13, fontFamily: 'monospace' },
  closeBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#e8e8e8',
    alignSelf: 'center',
  },
  closeBtnText: { color: '#000000', fontSize: 14, fontFamily: 'monospace', fontWeight: '600' },
  scrollArea: {
    flex: 1,
    padding: 16,
  },
  controlsBox: {
    backgroundColor: '#161616',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  controlsTitle: {
    color: '#e8e8e8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 4,
  },
  controlsText: {
    color: '#6f6f6f',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  sectionLabel: {
    color: '#e8e8e8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },

  // System chips (horizontal scroll)
  systemChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#161616',
    gap: 6,
  },
  systemChipIcon: { fontSize: 16 },
  systemChipName: {
    color: '#e8e8e8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  gameCountBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
  },
  gameCountText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
  },

  // Game list
  gameList: {
    gap: 8,
    marginBottom: 16,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 12,
    gap: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.15s ease' } as any : {}),
  },
  gameCardLeft: {
    flex: 1,
    gap: 4,
  },
  gameName: {
    color: '#e8e8e8',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  gameDesc: {
    color: '#9e9e9e',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  gameMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  genreBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  gameAuthor: {
    color: '#3e3e3e',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  playBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  playBtnText: {
    color: '#000000',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 1,
  },

  // No games
  noGamesBox: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  noGamesIcon: { fontSize: 32 },
  noGamesText: {
    color: '#6f6f6f',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  noGamesSubtext: {
    color: '#3e3e3e',
    fontSize: 11,
    fontFamily: 'monospace',
  },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1a1a1a',
  },
  dividerText: {
    color: '#3e3e3e',
    fontSize: 10,
    fontFamily: 'monospace',
  },

  // Load ROM button
  loadBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  loadBtnText: {
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '600',
  },

  // Footer
  footerText: {
    color: '#252525',
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 16,
  },

  emulatorWrap: {
    flex: 1,
    minHeight: 500,
    backgroundColor: '#000',
  },

  // Legacy (kept for system picker category view)
  categorySection: { marginBottom: 16 },
  categoryLabel: {
    color: '#e8e8e8', fontSize: 11, fontFamily: 'monospace', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
  },
  systemGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  systemCard: {
    width: 120, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#161616', alignItems: 'center',
  },
  systemIcon: { fontSize: 22, marginBottom: 4 },
  systemName: { color: '#e8e8e8', fontSize: 11, fontFamily: 'monospace', fontWeight: '600', textAlign: 'center' },
  systemExt: { color: '#3e3e3e', fontSize: 9, fontFamily: 'monospace', marginTop: 2, textAlign: 'center' },
});
