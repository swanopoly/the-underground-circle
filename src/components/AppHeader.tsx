import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Image, Pressable, StyleSheet, Platform,
  useWindowDimensions, Animated, Easing,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { createLinkInvite } from '../lib/invites';
import { navigateToUnifiedProfile } from '../lib/profileNavigation';
import FlatIcon from './FlatIcon';

// Conditionally import useKBar on web (kbar is a web-only library)
let useKBar: (() => { query: { toggle: () => void } }) | null = null;
if (Platform.OS === 'web') {
  try {
    useKBar = require('kbar').useKBar;
  } catch {}
}

interface AppHeaderProps {
  navigation: any;
  title?: string;
}

// ── Menu data ──────────────────────────────────────────────────────────────────

type MenuEntry = { label: string; icon: string; flatIcon?: string; screen: string } | 'divider';

const MENU_ENTRIES: MenuEntry[] = [
  { label: 'Your Circles', icon: '◎', flatIcon: 'circles',       screen: 'CirclesList' },
  { label: 'Create Circle', icon: '+', flatIcon: 'create',        screen: 'CreateCircle' },
  { label: 'Join Circle',   icon: '→', flatIcon: 'join',          screen: 'JoinCircle' },
  'divider',
  { label: 'Friends',       icon: '⁘', flatIcon: 'friends',       screen: 'Friends' },
  { label: 'Organizations', icon: '▣', flatIcon: 'organizations', screen: 'OrgList' },
  { label: 'Schools',       icon: '△', flatIcon: 'schools',       screen: 'Schools' },
  { label: 'Knowledge Wiki', icon: '◈', flatIcon: 'wiki',         screen: 'Wiki' },
  'divider',
  { label: 'Agents',        icon: '⬡', flatIcon: 'agents',        screen: 'Agents' },
  { label: 'Marketplace',   icon: '🛍', flatIcon: 'integrations',  screen: 'Integrations' },
  'divider',
  { label: 'Profile',       icon: '●', flatIcon: 'profile',       screen: 'Profile' },
];

const MENU_ITEM_COUNT = MENU_ENTRIES.filter(e => e !== 'divider').length;

// (animation constants removed — using spring physics now)

// ── Main component ─────────────────────────────────────────────────────────────

export default function AppHeader({ navigation, title }: AppHeaderProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [circleName, setCircleName] = useState('');
  const [circleId, setCircleId] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [bridgeConnecting, setBridgeConnecting] = useState(false);
  const [bridgeResult, setBridgeResult] = useState<'idle' | 'success' | 'partial' | 'error'>('idle');
  const [missionCount, setMissionCount] = useState(0);

  // ── Animated values ────────────────────────────────────────────────────────

  const hamburgerAnim = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const panelOpacity = useRef(new Animated.Value(0)).current;
  const panelScale = useRef(new Animated.Value(0.85)).current;
  const panelTranslateY = useRef(new Animated.Value(-12)).current;
  const itemAnims = useRef(
    Array.from({ length: MENU_ITEM_COUNT }, () => new Animated.Value(0)),
  ).current;

  // ── Data effects ───────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('username, display_name, avatar_url')
          .eq('id', user.id)
          .single();
        if (data) {
          setUsername(data.display_name || data.username || '');
          setAvatarUrl(data.avatar_url || null);
        }
      }
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('state', () => {
      try {
        const state = navigation.getState?.();
        if (state && state.routes) {
          const current = state.routes[state.index];
          if (current?.name === 'CircleDetail') {
            setCircleName((current.params as any)?.circleName || '');
            setCircleId((current.params as any)?.circleId || '');
          } else {
            setCircleName('');
            setCircleId('');
          }
        }
      } catch {}
    });
    return unsubscribe;
  }, [navigation]);

  // ── Mission count ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!circleId) { setMissionCount(0); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from('circle_missions')
          .select('id', { count: 'exact' })
          .eq('circle_id', circleId)
          .eq('status', 'active');
        setMissionCount(data?.length || 0);
      } catch { setMissionCount(0); }
    })();
  }, [circleId]);

  // ── Animation helpers ──────────────────────────────────────────────────────

  const resetAnims = useCallback(() => {
    hamburgerAnim.setValue(0);
    backdropOpacity.setValue(0);
    panelOpacity.setValue(0);
    panelScale.setValue(0.85);
    panelTranslateY.setValue(-12);
    itemAnims.forEach(a => a.setValue(0));
  }, [hamburgerAnim, backdropOpacity, panelOpacity, panelScale, panelTranslateY, itemAnims]);

  // ── BUBBLE OPEN ────────────────────────────────────────────────────────────

  const openMenu = useCallback(() => {
    setMenuOpen(true);
    setMenuVisible(true);
    resetAnims();

    // Hamburger → X morph
    Animated.timing(hamburgerAnim, {
      toValue: 1, duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Backdrop — soft fade
    Animated.timing(backdropOpacity, {
      toValue: 1, duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Panel pops in — bouncy spring with overshoot
    Animated.parallel([
      Animated.spring(panelScale, {
        toValue: 1, tension: 180, friction: 12,
        useNativeDriver: false,
      }),
      Animated.spring(panelTranslateY, {
        toValue: 0, tension: 180, friction: 14,
        useNativeDriver: false,
      }),
      Animated.timing(panelOpacity, {
        toValue: 1, duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();

    // Items bounce in with stagger — each one pops like a bubble
    itemAnims.forEach((anim, i) => {
      Animated.sequence([
        Animated.delay(80 + i * 35),
        Animated.spring(anim, {
          toValue: 1, tension: 220, friction: 10,
          useNativeDriver: false,
        }),
      ]).start();
    });
  }, [hamburgerAnim, backdropOpacity, panelOpacity, panelScale, panelTranslateY, itemAnims, resetAnims]);

  // ── BUBBLE CLOSE ──────────────────────────────────────────────────────────

  const closeMenu = useCallback(() => {
    setMenuOpen(false);

    // X → Hamburger morph
    Animated.timing(hamburgerAnim, {
      toValue: 0, duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Everything shrinks away playfully
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0, duration: 200,
        useNativeDriver: false,
      }),
      Animated.timing(panelOpacity, {
        toValue: 0, duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.spring(panelScale, {
        toValue: 0.85, tension: 200, friction: 18,
        useNativeDriver: false,
      }),
      Animated.timing(panelTranslateY, {
        toValue: -12, duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setMenuVisible(false);
      resetAnims();
    });
  }, [hamburgerAnim, backdropOpacity, panelOpacity, panelScale, panelTranslateY, resetAnims]);

  const toggleMenu = useCallback(() => {
    if (menuOpen) closeMenu();
    else openMenu();
  }, [menuOpen, openMenu, closeMenu]);

  const handleMenuNavigate = useCallback((screen: string) => {
    setMenuOpen(false);
    setMenuVisible(false);
    resetAnims();
    navigation.navigate(screen);
  }, [navigation, resetAnims]);

  // ── Hamburger morph interpolations ─────────────────────────────────────────

  const topLineStyle = {
    transform: [
      { translateY: hamburgerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }) },
      { rotate: hamburgerAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) },
    ],
  };
  const midLineStyle = {
    opacity: hamburgerAnim.interpolate({ inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: 'clamp' }),
    transform: [
      { scaleX: hamburgerAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0.3], extrapolate: 'clamp' }) },
    ],
  };
  const botLineStyle = {
    transform: [
      { translateY: hamburgerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
      { rotate: hamburgerAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) },
    ],
  };

  const initials = username ? username.charAt(0).toUpperCase() : '?';
  let staggerIdx = 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <View style={styles.header}>
        <View style={styles.leftSection}>
          <Pressable
            onPress={toggleMenu}
            style={({ pressed }) => [styles.hamburger, pressed && styles.pressed]}
          >
            <Animated.View style={[styles.hamburgerLine, topLineStyle]} />
            <Animated.View style={[styles.hamburgerLine, midLineStyle]} />
            <Animated.View style={[styles.hamburgerLine, botLineStyle]} />
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('CirclesList')}
            style={styles.logoButton}
          >
            <Image
              source={require('../../assets/swanai.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </Pressable>
        </View>

        <View style={styles.centerTitle} pointerEvents="none">
          <Text style={styles.centerTitleText} numberOfLines={1}>
            {circleName ? circleName.toUpperCase() : (title || 'Dashboard')}
          </Text>
          {missionCount > 0 && (
            <View style={styles.missionBadge}>
              <Text style={styles.missionBadgeText}>{missionCount}</Text>
            </View>
          )}
        </View>

        <View style={styles.rightSection}>
          {circleId ? (
            <>
              <Pressable
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}
              >
                <Text style={styles.headerIconText}>←</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('CircleSettings', { circleId })}
                style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}
              >
                <Text style={styles.headerIconText}>⚙️</Text>
              </Pressable>
            </>
          ) : isDesktop ? (
            <>
              <HeaderIconButton label="+" onPress={() => navigation.navigate('CreateCircle')} />
              <HeaderIconButton label="◎" onPress={() => navigation.navigate('CirclesList')} />
              <HeaderIconButton label="⁘" onPress={() => navigation.navigate('Friends')} />
            </>
          ) : null}

          {Platform.OS === 'web' && <CommandSearchButton />}

          <Pressable
            onPress={async () => {
              if (bridgeConnecting) return;
              setBridgeConnecting(true);
              setBridgeResult('idle');
              try {
                const { reconnectAllBridges } = await import('../lib/agentAutoConnect');
                const status = await reconnectAllBridges();
                const total = [status.claudeCode, status.codex, status.gemini, status.cursor].filter(Boolean).length;
                setBridgeResult(total > 0 ? 'success' : 'partial');
              } catch {
                setBridgeResult('error');
              }
              setBridgeConnecting(false);
              setTimeout(() => setBridgeResult('idle'), 3000);
            }}
            style={({ pressed }) => [
              styles.headerIcon,
              pressed && styles.headerIconPressed,
              bridgeConnecting && styles.bridgeConnecting,
              bridgeResult === 'success' && styles.bridgeSuccess,
              bridgeResult === 'error' && styles.bridgeError,
            ]}
          >
            <Text style={styles.headerIconText}>
              {bridgeConnecting ? '↻' : bridgeResult === 'success' ? '✅' : bridgeResult === 'error' ? '❌' : '🔗'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              // Prefer the unified profile (Circle Detail → Profile tab) when
              // we have a circle context — that's the dashboard most users
              // expect. If no circle context exists, fall back to the
              // standalone Profile screen.
              const navigated = navigateToUnifiedProfile(navigation, {
                circleId: circleId || null,
                circleName: circleName || null,
              });
              if (!navigated) {
                navigation.navigate('Profile');
              }
            }}
            style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.statusDot} />
          </Pressable>
        </View>
      </View>

      {/* ── Animated dropdown menu ──────────────────────────────────────────── */}
      {menuVisible && (
        <Animated.View
          style={[styles.menuOverlay, { opacity: backdropOpacity }]}
          pointerEvents={menuOpen ? 'auto' : 'none'}
        >
          <Pressable style={styles.menuOverlayPress} onPress={closeMenu}>
            <Animated.View
              style={[
                styles.menuDropdown,
                {
                  opacity: panelOpacity,
                  transform: [
                    { translateY: panelTranslateY },
                    { scale: panelScale },
                  ],
                },
              ]}
            >
              {/* Accent line */}
              <View style={styles.accentLine} />

              {/* Menu entries — bouncy stagger */}
              {MENU_ENTRIES.map((entry, i) => {
                if (entry === 'divider') {
                  return <View key={`div-${i}`} style={styles.menuDivider} />;
                }
                const idx = staggerIdx++;
                return (
                  <AnimatedMenuItem
                    key={entry.screen}
                    label={entry.label}
                    icon={entry.icon}
                    flatIcon={entry.flatIcon}
                    anim={itemAnims[idx]}
                    onPress={() => handleMenuNavigate(entry.screen)}
                  />
                );
              })}
            </Animated.View>
          </Pressable>
        </Animated.View>
      )}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Web-only search button that opens the Cmd+K command palette */
function CommandSearchButton() {
  if (Platform.OS !== 'web' || !useKBar) return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { query } = useKBar();
  return (
    <Pressable
      onPress={() => query.toggle()}
      style={({ pressed }) => [styles.headerIcon, styles.searchButton, pressed && styles.headerIconPressed]}
    >
      <Text style={styles.searchButtonSlash}>/</Text>
    </Pressable>
  );
}

function HeaderIconButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}
    >
      <Text style={styles.headerIconText}>{label}</Text>
    </Pressable>
  );
}

function AnimatedMenuItem({
  label, icon, flatIcon, anim, onPress,
}: {
  label: string; icon: string; flatIcon?: string; anim: Animated.Value; onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{
          scale: anim.interpolate({
            inputRange: [0, 0.6, 1],
            outputRange: [0.5, 1.08, 1],
          }),
        }],
      }}
    >
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.menuItem, hovered && styles.menuItemHovered]}
      >
        <View style={[styles.hoverBar, hovered && styles.hoverBarActive]} />
        {flatIcon ? (
          <FlatIcon name={flatIcon} size={16} glow={hovered} style={styles.menuItemIcon} />
        ) : (
          <Text style={[styles.menuItemIcon, hovered && styles.menuItemIconHovered]}>{icon}</Text>
        )}
        <Text style={[styles.menuItemLabel, hovered && styles.menuItemLabelHovered]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    height: 48,
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    ...(Platform.OS === 'web' ? { position: 'sticky' as any, top: 0, zIndex: 1000 } : {}),
  },
  leftSection: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hamburger: {
    width: 32, height: 32,
    justifyContent: 'center', alignItems: 'center',
    borderRadius: 6,
  },
  hamburgerLine: {
    width: 16, height: 2,
    backgroundColor: '#f0f6fc',
    marginVertical: 1.5,
    borderRadius: 1,
  },
  pressed: { opacity: 0.7 },
  logoButton: {
    width: 32, height: 32, borderRadius: 16,
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center',
  },
  logo: { width: 32, height: 32, borderRadius: 16 },
  centerTitle: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    flexDirection: 'row',
  },
  centerTitleText: { color: '#f0f6fc', fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  missionBadge: {
    backgroundColor: '#6366f120',
    borderWidth: 1,
    borderColor: '#6366f150',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  missionBadgeText: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  rightSection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: {
    width: 32, height: 32, borderRadius: 6,
    borderWidth: 1, borderColor: '#30363d',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  headerIconPressed: { backgroundColor: '#21262d' },
  headerIconText: { color: '#f0f6fc', fontSize: 14 },
  avatarButton: { width: 28, height: 28, borderRadius: 14, marginLeft: 4, position: 'relative' },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#30363d', justifyContent: 'center', alignItems: 'center',
  },
  avatarInitials: { color: '#f0f6fc', fontSize: 12, fontWeight: '700' },
  statusDot: {
    position: 'absolute', bottom: -1, right: -1,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#3fb950', borderWidth: 1.5, borderColor: '#000000',
  },

  // ── Menu overlay + dropdown ────────────────────────────────────────────────
  menuOverlay: {
    ...(Platform.OS === 'web'
      ? { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }
      : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }),
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  menuOverlayPress: { flex: 1 },
  menuDropdown: {
    position: 'absolute',
    top: 48, left: 16, width: 240,
    backgroundColor: '#161b22',
    borderWidth: 1, borderColor: '#30363d',
    borderRadius: 12,
    paddingVertical: 6,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 12px 40px rgba(0,0,0,0.5)', transformOrigin: 'top left' } as any
      : { elevation: 8 }),
    zIndex: 1001,
  },
  // Accent line
  accentLine: {
    height: 1,
    marginHorizontal: 16, marginTop: 2, marginBottom: 4,
    borderRadius: 1,
    backgroundColor: '#1f6feb',
    opacity: 0.5,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 8px rgba(31,111,235,0.35)' } as any : {}),
  },

  menuDivider: {
    height: 1, backgroundColor: '#21262d',
    marginVertical: 4, marginHorizontal: 12,
  },

  // ── Menu items ─────────────────────────────────────────────────────────────
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 16,
    gap: 10, borderRadius: 6, marginHorizontal: 4,
    position: 'relative', overflow: 'hidden',
    ...(Platform.OS === 'web' ? {
      transition: 'background-color 0.2s ease, transform 0.15s ease',
      cursor: 'pointer',
    } as any : {}),
  },
  menuItemHovered: {
    backgroundColor: '#1f6feb10',
    transform: [{ translateX: 2 }],
  },
  hoverBar: {
    position: 'absolute', left: 0, top: 6, bottom: 6,
    width: 2, borderRadius: 1,
    backgroundColor: '#1f6feb', opacity: 0,
    ...(Platform.OS === 'web' ? { transition: 'opacity 0.2s ease' } as any : {}),
  },
  hoverBarActive: { opacity: 1 },
  menuItemIcon: {
    fontSize: 14, width: 20, textAlign: 'center',
    ...(Platform.OS === 'web' ? { transition: 'text-shadow 0.2s ease' } as any : {}),
  },
  menuItemIconHovered: {
    ...(Platform.OS === 'web' ? { textShadow: '0 0 10px rgba(88,166,255,0.5)' } as any : {}),
  },
  searchButton: {
    borderColor: '#3a3a4e',
    backgroundColor: '#0a0a12',
  },
  searchButtonSlash: {
    color: '#808098',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  bridgeConnecting: {
    borderColor: '#1f6feb',
  },
  bridgeSuccess: {
    borderColor: '#3fb950',
    backgroundColor: 'rgba(63,185,80,0.1)',
  },
  bridgeError: {
    borderColor: '#f85149',
    backgroundColor: 'rgba(248,81,73,0.1)',
  },
  menuItemLabel: {
    color: '#c9d1d9', fontSize: 13, fontWeight: '500',
    ...(Platform.OS === 'web' ? { transition: 'color 0.2s ease' } as any : {}),
  },
  menuItemLabelHovered: { color: '#f0f6fc' },
});
