/**
 * OpenSwanServiceMenu - chat-adjacent service controls for profile and
 * delegation posture. The runtime behavior stays in chatSessionProfile; this
 * component only presents the current choices and forwards changes.
 */

import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  SESSION_DELEGATION_MODE_OPTIONS,
  SESSION_PROFILE_OPTIONS,
  type SessionCodingProfile,
  type SessionDelegationMode,
} from '../../../../lib/chatSessionProfile';

interface Props {
  visible: boolean;
  sessionProfile: SessionCodingProfile;
  delegationMode: SessionDelegationMode;
  onSessionProfileChange: (profile: SessionCodingProfile) => void;
  onDelegationModeChange: (mode: SessionDelegationMode) => void;
  onOpenControlPanel?: () => void;
  onOpenSkills?: () => void;
  onOpenRunHistory?: () => void;
  onClose: () => void;
}

// Keep keyboard behavior explicit on web without forwarding web-only tab
// semantics to iOS or Android.
const WEB_BUTTON_FOCUS_PROPS = Platform.OS === 'web'
  ? ({ focusable: true, tabIndex: 0 } as any)
  : {};

function webDescriptiveLabel(label: string, hint: string): Record<string, unknown> {
  return Platform.OS === 'web'
    ? ({ 'aria-label': `${label}. ${hint}` } as any)
    : {};
}

function webChoiceSemantics(
  label: string,
  description: string,
  selected: boolean,
): Record<string, unknown> {
  return Platform.OS === 'web'
    ? ({
        'aria-label': `${label}. ${description}`,
        'aria-pressed': selected,
      } as any)
    : {};
}

export default function OpenSwanServiceMenu({
  visible,
  sessionProfile,
  delegationMode,
  onSessionProfileChange,
  onDelegationModeChange,
  onOpenControlPanel,
  onOpenSkills,
  onOpenRunHistory,
  onClose,
}: Props) {
  const profileMeta = SESSION_PROFILE_OPTIONS.find(o => o.id === sessionProfile) || SESSION_PROFILE_OPTIONS[0];
  const delegationMeta = SESSION_DELEGATION_MODE_OPTIONS.find(o => o.id === delegationMode) || SESSION_DELEGATION_MODE_OPTIONS[0];
  const currentSummary = `${profileMeta.label} / ${delegationMeta.label}`;

  const renderProfileOption = (option: (typeof SESSION_PROFILE_OPTIONS)[number]) => {
    const active = option.id === sessionProfile;
    const accessibilityLabel = `Set OpenSwan work mode to ${option.label}`;
    return (
      <Pressable
        key={option.id}
        {...WEB_BUTTON_FOCUS_PROPS}
        {...webChoiceSemantics(accessibilityLabel, option.description, active)}
        onPress={() => onSessionProfileChange(option.id)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={option.description}
        accessibilityState={{ selected: active }}
        style={({ hovered, pressed, focused }: any) => [
          styles.option,
          {
            borderColor: active ? option.color : '#1e293b',
            backgroundColor: active ? `${option.color}18` : '#08111f',
          },
          hovered && !active && { borderColor: `${option.color}66`, backgroundColor: `${option.color}0d` },
          pressed && { transform: [{ scale: 0.985 }] },
          focused && Platform.OS === 'web' && styles.keyboardFocus,
          Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
        ]}
      >
        <View style={styles.optionHeader}>
          <View style={[styles.optionMark, { backgroundColor: active ? option.color : '#334155' }]} />
          <Text style={[styles.optionShort, { color: active ? option.color : '#94a3b8' }]} numberOfLines={1}>
            {option.shortLabel}
          </Text>
        </View>
        <Text style={[styles.optionLabel, active && { color: option.color }]} numberOfLines={1}>
          {option.label}
        </Text>
      </Pressable>
    );
  };

  const renderDelegationOption = (option: (typeof SESSION_DELEGATION_MODE_OPTIONS)[number]) => {
    const active = option.id === delegationMode;
    const accessibilityLabel = `Set OpenSwan crew mode to ${option.label}`;
    return (
      <Pressable
        key={option.id}
        {...WEB_BUTTON_FOCUS_PROPS}
        {...webChoiceSemantics(accessibilityLabel, option.description, active)}
        onPress={() => onDelegationModeChange(option.id)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={option.description}
        accessibilityState={{ selected: active }}
        style={({ hovered, pressed, focused }: any) => [
          styles.option,
          styles.delegationOption,
          {
            borderColor: active ? option.color : '#1e293b',
            backgroundColor: active ? `${option.color}18` : '#08111f',
          },
          hovered && !active && { borderColor: `${option.color}66`, backgroundColor: `${option.color}0d` },
          pressed && { transform: [{ scale: 0.985 }] },
          focused && Platform.OS === 'web' && styles.keyboardFocus,
          Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
        ]}
      >
        <View style={styles.optionHeader}>
          <View style={[styles.optionMark, { backgroundColor: active ? option.color : '#334155' }]} />
          <Text style={[styles.optionShort, { color: active ? option.color : '#94a3b8' }]} numberOfLines={1}>
            {option.shortLabel}
          </Text>
        </View>
        <Text style={[styles.optionLabel, active && { color: option.color }]} numberOfLines={1}>
          {option.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      accessibilityLabel="OpenSwan service controls"
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Text style={styles.headerIconText}>OS</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>OpenSwan Service</Text>
              <Text style={styles.title} numberOfLines={1}>Current: {currentSummary}</Text>
            </View>
            <Pressable
              {...WEB_BUTTON_FOCUS_PROPS}
              {...webDescriptiveLabel(
                'Close OpenSwan service menu',
                'Close the service menu and return to Chat.',
              )}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close OpenSwan service menu"
              accessibilityHint="Close the service menu and return to Chat."
              style={({ hovered, pressed, focused }: any) => [
                styles.closeBtn,
                hovered && { borderColor: '#475569', backgroundColor: '#111827' },
                pressed && { transform: [{ scale: 0.95 }] },
                focused && Platform.OS === 'web' && styles.keyboardFocus,
                Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
              ]}
            >
              <Text style={styles.closeBtnText}>x</Text>
            </Pressable>
          </View>

          <View style={styles.summaryRow}>
            <View style={[styles.summaryPill, { borderColor: `${profileMeta.color}55`, backgroundColor: `${profileMeta.color}12` }]}>
              <Text style={styles.summaryLabel}>Mode</Text>
              <Text style={[styles.summaryValue, { color: profileMeta.color }]} numberOfLines={1}>{profileMeta.label}</Text>
            </View>
            <View style={[styles.summaryPill, { borderColor: `${delegationMeta.color}55`, backgroundColor: `${delegationMeta.color}12` }]}>
              <Text style={styles.summaryLabel}>Crew</Text>
              <Text style={[styles.summaryValue, { color: delegationMeta.color }]} numberOfLines={1}>{delegationMeta.label}</Text>
            </View>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Work mode</Text>
                <Text style={[styles.sectionValue, { color: profileMeta.color }]} numberOfLines={1}>{profileMeta.shortLabel}</Text>
              </View>
              <View style={styles.optionGrid}>
                {SESSION_PROFILE_OPTIONS.map(renderProfileOption)}
              </View>
              <Text style={[styles.desc, { borderLeftColor: profileMeta.color }]}>{profileMeta.description}</Text>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Crew mode</Text>
                <Text style={[styles.sectionValue, { color: delegationMeta.color }]} numberOfLines={1}>{delegationMeta.shortLabel}</Text>
              </View>
              <View style={styles.optionGrid}>
                {SESSION_DELEGATION_MODE_OPTIONS.map(renderDelegationOption)}
              </View>
              <Text style={[styles.desc, { borderLeftColor: delegationMeta.color }]}>{delegationMeta.description}</Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.controlMap}>
              <Text style={styles.controlMapLabel}>Where to go</Text>
              <Text style={styles.controlMapText}>
                Switch mode and crew here. Agent, model, approvals, and tools are in Control Panel. Past or blocked work is in Runs & recovery.
              </Text>
            </View>

            {onOpenControlPanel && (
              <Pressable
                {...WEB_BUTTON_FOCUS_PROPS}
                {...webDescriptiveLabel(
                  'Open full OpenSwan control panel',
                  'Choose the agent and model, review approvals, and manage tools.',
                )}
                onPress={() => { onClose(); onOpenControlPanel(); }}
                accessibilityRole="button"
                accessibilityLabel="Open full OpenSwan control panel"
                accessibilityHint="Choose the agent and model, review approvals, and manage tools."
                style={({ hovered, pressed, focused }: any) => [
                  styles.primaryBtn,
                  hovered && { borderColor: '#38bdf8', backgroundColor: '#38bdf820' },
                  pressed && { transform: [{ scale: 0.985 }] },
                  focused && Platform.OS === 'web' && styles.keyboardFocus,
                  Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                ]}
              >
                <View style={styles.primaryBtnCopy}>
                  <Text style={styles.primaryBtnText}>Open Control Panel</Text>
                  <Text style={styles.primaryBtnHint}>Agent · model · approvals · tools</Text>
                </View>
                <Text style={styles.primaryBtnArrow}>{'>'}</Text>
              </Pressable>
            )}

            <View style={styles.secondaryRow}>
              {onOpenSkills && (
                <Pressable
                  {...WEB_BUTTON_FOCUS_PROPS}
                  {...webDescriptiveLabel(
                    'Open OpenSwan skills',
                    'Review and manage OpenSwan skills for this circle.',
                  )}
                  onPress={() => { onClose(); onOpenSkills(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Open OpenSwan skills"
                  accessibilityHint="Review and manage OpenSwan skills for this circle."
                  style={({ hovered, pressed, focused }: any) => [
                    styles.secondaryBtn,
                    hovered && { borderColor: '#f59e0b', backgroundColor: '#f59e0b20' },
                    pressed && { transform: [{ scale: 0.985 }] },
                    focused && Platform.OS === 'web' && styles.keyboardFocus,
                    Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>Skills</Text>
                </Pressable>
              )}
              {onOpenRunHistory && (
                <Pressable
                  {...WEB_BUTTON_FOCUS_PROPS}
                  {...webDescriptiveLabel(
                    'Open OpenSwan runs and recovery',
                    'Review active, completed, or blocked runs and available recovery actions.',
                  )}
                  onPress={() => { onClose(); onOpenRunHistory(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Open OpenSwan runs and recovery"
                  accessibilityHint="Review active, completed, or blocked runs and available recovery actions."
                  style={({ hovered, pressed, focused }: any) => [
                    styles.secondaryBtn,
                    hovered && { borderColor: '#38bdf8', backgroundColor: '#38bdf820' },
                    pressed && { transform: [{ scale: 0.985 }] },
                    focused && Platform.OS === 'web' && styles.keyboardFocus,
                    Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                  ]}
                >
                  <Text style={styles.runsBtnText}>Runs & recovery</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.doneRow}>
              <Pressable
                {...WEB_BUTTON_FOCUS_PROPS}
                {...webDescriptiveLabel(
                  'Close OpenSwan service menu',
                  'Close the service menu and return to Chat.',
                )}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close OpenSwan service menu"
                accessibilityHint="Close the service menu and return to Chat."
                style={({ hovered, pressed, focused }: any) => [
                  styles.secondaryBtn,
                  styles.doneBtn,
                  hovered && { borderColor: '#64748b', backgroundColor: '#111827' },
                  pressed && { transform: [{ scale: 0.985 }] },
                  focused && Platform.OS === 'web' && styles.keyboardFocus,
                  Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                ]}
              >
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <View
          accessible={false}
          style={styles.dismissBackdrop}
          onStartShouldSetResponder={() => true}
          onResponderRelease={onClose}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.72)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: Platform.OS === 'web' ? 16 : 0,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%' as any,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: Platform.OS === 'web' ? 12 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 12 : 0,
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderColor: '#f59e0b25',
    overflow: 'hidden',
    zIndex: 1,
    ...(Platform.OS === 'web' ? { boxShadow: '0 22px 70px rgba(0,0,0,0.52)' } as any : {}),
  },
  dismissBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#334155',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#08111f',
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b55',
    backgroundColor: '#f59e0b18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  title: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  summaryPill: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryLabel: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '900',
    marginTop: 3,
  },
  body: {
    maxHeight: 460,
  },
  bodyContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 14,
  },
  section: {
    gap: 9,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sectionValue: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    width: '48.4%',
    minHeight: 62,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  delegationOption: {
    minHeight: 58,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionMark: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  optionShort: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  optionLabel: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
  desc: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    borderLeftWidth: 2,
    paddingLeft: 9,
    paddingVertical: 2,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#08111f',
  },
  controlMap: {
    gap: 3,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  controlMapLabel: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  controlMapText: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },
  primaryBtn: {
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38bdf866',
    backgroundColor: '#38bdf812',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
  },
  primaryBtnCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  primaryBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '900',
  },
  primaryBtnHint: {
    color: '#7dd3fc',
    fontSize: 10,
    fontWeight: '700',
  },
  primaryBtnArrow: {
    color: '#bae6fd',
    fontSize: 20,
    fontWeight: '900',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '900',
  },
  runsBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '900',
  },
  doneRow: {
    flexDirection: 'row',
  },
  doneBtn: {
    flex: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0a0f1c',
  },
  doneBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '900',
  },
  keyboardFocus: Platform.OS === 'web' ? ({
    outlineColor: '#f8fafc',
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: 2,
  } as any) : {},
});
