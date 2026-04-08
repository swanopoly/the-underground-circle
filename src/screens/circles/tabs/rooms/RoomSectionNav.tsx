/**
 * RoomSectionNav — Horizontal navigation bar for switching between room sections.
 *
 * Renders a scrollable row of section pills from ROOM_SECTIONS.
 * Active pill is highlighted with the accent color.
 */

import React, { useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform,
} from 'react-native';
import { ROOM_SECTIONS, type RoomSection } from './roomTypes';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  activeSection: RoomSection;
  onSectionChange: (section: RoomSection) => void;
  accentColor: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── Component ──────────────────────────────────────────────────────────────

function RoomSectionNav({ activeSection, onSectionChange, accentColor }: Props) {
  const renderPill = useCallback((section: typeof ROOM_SECTIONS[number]) => {
    const isActive = activeSection === section.key;
    return (
      <Pressable
        key={section.key}
        onPress={() => onSectionChange(section.key)}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${section.label} section`}
        style={({ hovered }: any) => [
          styles.pill,
          isActive && {
            backgroundColor: accentColor + '20',
            borderColor: accentColor + '60',
          },
          !isActive && hovered && Platform.OS === 'web' && {
            backgroundColor: '#1a1a28',
            borderColor: '#2a2a3e',
          },
        ]}
      >
        <View
          style={[
            styles.iconBox,
            { borderColor: isActive ? accentColor + '50' : '#2a2a3e' },
            isActive && { backgroundColor: accentColor + '15' },
          ]}
        >
          <Text
            style={[
              styles.iconText,
              { color: isActive ? accentColor : '#606075' },
            ]}
          >
            {section.icon}
          </Text>
        </View>
        <Text
          style={[
            styles.label,
            { color: isActive ? '#f0f0f5' : '#a0a0b0' },
          ]}
        >
          {section.label}
        </Text>
      </Pressable>
    );
  }, [activeSection, accentColor, onSectionChange]);

  return (
    <View style={styles.container} nativeID="section-room-nav">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {ROOM_SECTIONS.map(renderPill)}
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: 40,
    backgroundColor: '#0a0a10',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  iconBox: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 2,
    backgroundColor: '#0f0f18',
  },
  iconText: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: MONO,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
});

export default RoomSectionNav;
