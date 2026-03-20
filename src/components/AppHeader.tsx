import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { createLinkInvite } from '../lib/invites';

interface AppHeaderProps {
  navigation: any;
  title?: string;
}

export default function AppHeader({ navigation, title }: AppHeaderProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');

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

  // Detect if we're inside a circle to show its name + id
  const [circleName, setCircleName] = useState('');
  const [circleId, setCircleId] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
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

  const initials = username ? username.charAt(0).toUpperCase() : '?';

  return (
    <>
      <View style={styles.header}>
        {/* Left section: hamburger + logo */}
        <View style={styles.leftSection}>
          <Pressable
            onPress={() => setMenuOpen(!menuOpen)}
            style={({ pressed }) => [styles.hamburger, pressed && styles.pressed]}
          >
            <View style={styles.hamburgerLine} />
            <View style={styles.hamburgerLine} />
            <View style={styles.hamburgerLine} />
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

        {/* Center: circle name or dashboard title */}
        <View style={styles.centerTitle} pointerEvents="none">
          <Text style={styles.centerTitleText} numberOfLines={1}>
            {circleName ? circleName.toUpperCase() : (title || 'Dashboard')}
          </Text>
        </View>

        {/* Right section: nav items + profile */}
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
                onPress={async () => {
                  try {
                    const { url, error } = await createLinkInvite(circleId, { maxUses: 0, expiresInDays: 7 });
                    if (error || !url) {
                      if (Platform.OS === 'web') alert('Could not create invite link: ' + (error || 'Unknown error'));
                      return;
                    }
                    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                      await navigator.clipboard.writeText(url);
                    }
                    setInviteCopied(true);
                    setTimeout(() => setInviteCopied(false), 3000);
                  } catch (err: any) {
                    if (Platform.OS === 'web') alert('Failed to create invite: ' + (err?.message || 'Check console'));
                  }
                }}
                style={({ pressed }) => [styles.headerIcon, pressed && styles.headerIconPressed]}
              >
                <Text style={styles.headerIconText}>{inviteCopied ? '✅' : '🔗'}</Text>
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
              <HeaderIconButton
                label="+"
                onPress={() => navigation.navigate('CreateCircle')}
              />
              <HeaderIconButton
                label="◎"
                onPress={() => navigation.navigate('CirclesList')}
              />
              <HeaderIconButton
                label="⁘"
                onPress={() => navigation.navigate('Friends')}
              />
            </>
          ) : null}

          {/* Profile avatar */}
          <Pressable
            onPress={() => navigation.navigate('EditProfile')}
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

      {/* Dropdown menu */}
      {menuOpen && (
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuDropdown}>
            <MenuItem
              label="Your Circles"
              icon="◎"
              onPress={() => { setMenuOpen(false); navigation.navigate('CirclesList'); }}
            />
            <MenuItem
              label="Create Circle"
              icon="+"
              onPress={() => { setMenuOpen(false); navigation.navigate('CreateCircle'); }}
            />
            <MenuItem
              label="Join Circle"
              icon="→"
              onPress={() => { setMenuOpen(false); navigation.navigate('JoinCircle'); }}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              label="Friends"
              icon="⁘"
              onPress={() => { setMenuOpen(false); navigation.navigate('Friends'); }}
            />
            <MenuItem
              label="Organizations"
              icon="▣"
              onPress={() => { setMenuOpen(false); navigation.navigate('OrgList'); }}
            />
            <MenuItem
              label="Schools"
              icon="△"
              onPress={() => { setMenuOpen(false); navigation.navigate('Schools'); }}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              label="Agents"
              icon="⬡"
              onPress={() => { setMenuOpen(false); navigation.navigate('Agents'); }}
            />
            <MenuItem
              label="Integrations"
              icon="⚙"
              onPress={() => { setMenuOpen(false); navigation.navigate('Integrations'); }}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              label="Profile"
              icon="●"
              onPress={() => { setMenuOpen(false); navigation.navigate('EditProfile'); }}
            />
          </View>
        </Pressable>
      )}
    </>
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

function MenuItem({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.menuItem, hovered && styles.menuItemHovered]}
    >
      <Text style={styles.menuItemIcon}>{icon}</Text>
      <Text style={styles.menuItemLabel}>{label}</Text>
    </Pressable>
  );
}

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
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hamburger: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  hamburgerLine: {
    width: 16,
    height: 2,
    backgroundColor: '#f0f6fc',
    marginVertical: 1.5,
    borderRadius: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  logoButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  titleText: {
    color: '#f0f6fc',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  titleTextMobile: {
    color: '#f0f6fc',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  centerTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerTitleText: {
    color: '#f0f6fc',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  headerIconPressed: {
    backgroundColor: '#21262d',
  },
  headerIconText: {
    color: '#f0f6fc',
    fontSize: 14,
  },
  avatarButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: 4,
    position: 'relative',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#30363d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#f0f6fc',
    fontSize: 12,
    fontWeight: '700',
  },
  statusDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3fb950',
    borderWidth: 1.5,
    borderColor: '#000000',
  },
  // Dropdown menu
  menuOverlay: {
    ...(Platform.OS === 'web'
      ? { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }
      : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }),
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  menuDropdown: {
    position: 'absolute',
    top: 48,
    left: 16,
    width: 240,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 12,
    paddingVertical: 4,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } as any
      : { elevation: 8 }),
    zIndex: 1001,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#21262d',
    marginVertical: 4,
    marginHorizontal: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 10,
    borderRadius: 6,
    marginHorizontal: 4,
  },
  menuItemHovered: {
    backgroundColor: '#1f6feb22',
  },
  menuItemIcon: {
    fontSize: 14,
    width: 20,
    textAlign: 'center',
  },
  menuItemLabel: {
    color: '#c9d1d9',
    fontSize: 13,
    fontWeight: '500',
  },
});
