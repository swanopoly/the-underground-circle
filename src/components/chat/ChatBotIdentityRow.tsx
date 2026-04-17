import React from 'react';
import { Image, Platform, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

type ChatBotIdentityRowProps = {
  agentAvatarSource: ImageSourcePropType;
  agentName: string;
  accentColor: string;
  timestamp?: Date;
  showBadge?: boolean;
  compact?: boolean;
};

export default function ChatBotIdentityRow({
  agentAvatarSource,
  agentName,
  accentColor,
  timestamp,
  showBadge = false,
  compact = false,
}: ChatBotIdentityRowProps) {
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <Image source={agentAvatarSource} style={[styles.avatar, compact && styles.avatarCompact]} resizeMode="contain" />
      <Text style={[styles.name, compact ? styles.nameCompact : styles.nameDefault, { color: accentColor }]}>
        {agentName}
      </Text>
      {showBadge && (
        <View style={[styles.badge, { backgroundColor: `${accentColor}30` }]}>
          <Text style={[styles.badgeText, { color: accentColor }]}>AI</Text>
        </View>
      )}
      {timestamp && (
        <Text style={[styles.time, compact && styles.timeCompact]}>
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowCompact: {
    marginBottom: 2,
  },
  avatar: {
    width: 18,
    height: 18,
  },
  avatarCompact: {
    width: 14,
    height: 14,
  },
  name: {
    fontWeight: '700',
  },
  nameDefault: {
    fontSize: 14,
  },
  nameCompact: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  time: {
    color: '#444',
    fontSize: 11,
    marginLeft: 'auto',
  },
  timeCompact: {
    color: '#606075',
    fontSize: 9,
    marginLeft: 0,
  },
});
