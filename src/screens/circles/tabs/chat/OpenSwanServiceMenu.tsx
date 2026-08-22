/**
 * OpenSwanServiceMenu - chat-adjacent service controls for profile and
 * delegation posture. The runtime behavior stays in chatSessionProfile; this
 * component only presents the current choices and forwards changes.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CARD_BG,
  CARD_BORDER,
  FIELD_BG,
  MUTED,
  SWAN_PURPLE,
  TEXT,
  TEXT_DIM,
} from '../../../../components/openswan/openswanConsoleStyles';
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

type ServicePicker = 'mode' | 'crew' | null;

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
  const [openPicker, setOpenPicker] = useState<ServicePicker>(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const profileMeta = SESSION_PROFILE_OPTIONS.find(o => o.id === sessionProfile) || SESSION_PROFILE_OPTIONS[0];
  const delegationMeta = SESSION_DELEGATION_MODE_OPTIONS.find(o => o.id === delegationMode) || SESSION_DELEGATION_MODE_OPTIONS[0];
  const currentSummary = `${profileMeta.label} work · ${delegationMeta.label} crew`;

  useEffect(() => {
    setOpenPicker(null);
    setMoreOptionsOpen(false);
  }, [visible]);

  const togglePicker = (picker: Exclude<ServicePicker, null>) => {
    setOpenPicker(current => current === picker ? null : picker);
  };

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
            borderColor: active ? option.color : CARD_BORDER,
            backgroundColor: active ? `${option.color}18` : FIELD_BG,
          },
          hovered && !active && { borderColor: `${option.color}66`, backgroundColor: `${option.color}0d` },
          pressed && { transform: [{ scale: 0.985 }] },
          focused && Platform.OS === 'web' && styles.keyboardFocus,
          Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
        ]}
      >
        <View style={styles.optionHeader}>
          <View style={[styles.optionMark, { backgroundColor: active ? option.color : '#334155' }]} />
          <Text style={[styles.optionShort, { color: active ? option.color : TEXT_DIM }]} numberOfLines={1}>
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
            borderColor: active ? option.color : CARD_BORDER,
            backgroundColor: active ? `${option.color}18` : FIELD_BG,
          },
          hovered && !active && { borderColor: `${option.color}66`, backgroundColor: `${option.color}0d` },
          pressed && { transform: [{ scale: 0.985 }] },
          focused && Platform.OS === 'web' && styles.keyboardFocus,
          Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
        ]}
      >
        <View style={styles.optionHeader}>
          <View style={[styles.optionMark, { backgroundColor: active ? option.color : '#334155' }]} />
          <Text style={[styles.optionShort, { color: active ? option.color : TEXT_DIM }]} numberOfLines={1}>
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
      animationType="fade"
      accessibilityLabel="OpenSwan service controls"
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.sheet}>
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
                hovered && { borderColor: `${SWAN_PURPLE}88`, backgroundColor: `${SWAN_PURPLE}12` },
                pressed && { transform: [{ scale: 0.95 }] },
                focused && Platform.OS === 'web' && styles.keyboardFocus,
                Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
              ]}
            >
              <Text style={styles.closeBtnText}>×</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            <View style={styles.essentialBlock}>
              <Text style={styles.essentialLabel}>Essentials</Text>
              <View style={styles.selectorRow}>
                <Pressable
                  {...WEB_BUTTON_FOCUS_PROPS}
                  {...webDescriptiveLabel(
                    openPicker === 'mode' ? 'Hide OpenSwan work mode choices' : 'Change OpenSwan work mode',
                    `Current work mode is ${profileMeta.label}.`,
                  )}
                  onPress={() => togglePicker('mode')}
                  accessibilityRole="button"
                  accessibilityLabel={openPicker === 'mode' ? 'Hide OpenSwan work mode choices' : 'Change OpenSwan work mode'}
                  accessibilityHint={`Current work mode is ${profileMeta.label}.`}
                  accessibilityState={{ expanded: openPicker === 'mode' }}
                  style={({ hovered, pressed, focused }: any) => [
                    styles.compactSelector,
                    openPicker === 'mode' && { borderColor: `${profileMeta.color}88`, backgroundColor: `${profileMeta.color}12` },
                    hovered && { borderColor: `${profileMeta.color}88`, backgroundColor: `${profileMeta.color}0d` },
                    pressed && { transform: [{ scale: 0.985 }] },
                    focused && Platform.OS === 'web' && styles.keyboardFocus,
                    Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                  ]}
                >
                  <View style={styles.compactSelectorTop}>
                    <Text style={styles.compactSelectorLabel}>Work mode</Text>
                    <Text style={[styles.selectorChevron, { color: profileMeta.color }]}>{openPicker === 'mode' ? 'v' : '>'}</Text>
                  </View>
                  <Text style={[styles.compactSelectorValue, { color: profileMeta.color }]} numberOfLines={1}>{profileMeta.label}</Text>
                  <Text style={styles.compactSelectorHint} numberOfLines={1}>How OpenSwan approaches the task</Text>
                </Pressable>

                <Pressable
                  {...WEB_BUTTON_FOCUS_PROPS}
                  {...webDescriptiveLabel(
                    openPicker === 'crew' ? 'Hide OpenSwan crew choices' : 'Change OpenSwan crew mode',
                    `Current crew mode is ${delegationMeta.label}.`,
                  )}
                  onPress={() => togglePicker('crew')}
                  accessibilityRole="button"
                  accessibilityLabel={openPicker === 'crew' ? 'Hide OpenSwan crew choices' : 'Change OpenSwan crew mode'}
                  accessibilityHint={`Current crew mode is ${delegationMeta.label}.`}
                  accessibilityState={{ expanded: openPicker === 'crew' }}
                  style={({ hovered, pressed, focused }: any) => [
                    styles.compactSelector,
                    openPicker === 'crew' && { borderColor: `${delegationMeta.color}88`, backgroundColor: `${delegationMeta.color}12` },
                    hovered && { borderColor: `${delegationMeta.color}88`, backgroundColor: `${delegationMeta.color}0d` },
                    pressed && { transform: [{ scale: 0.985 }] },
                    focused && Platform.OS === 'web' && styles.keyboardFocus,
                    Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                  ]}
                >
                  <View style={styles.compactSelectorTop}>
                    <Text style={styles.compactSelectorLabel}>Crew</Text>
                    <Text style={[styles.selectorChevron, { color: delegationMeta.color }]}>{openPicker === 'crew' ? 'v' : '>'}</Text>
                  </View>
                  <Text style={[styles.compactSelectorValue, { color: delegationMeta.color }]} numberOfLines={1}>{delegationMeta.label}</Text>
                  <Text style={styles.compactSelectorHint} numberOfLines={1}>Automatic, parallel, or solo</Text>
                </Pressable>
              </View>

              {openPicker === 'mode' ? (
                <View style={styles.expandedPicker}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionLabel}>Choose work mode</Text>
                    <Text style={[styles.sectionValue, { color: profileMeta.color }]} numberOfLines={1}>{profileMeta.shortLabel}</Text>
                  </View>
                  <View style={styles.optionGrid}>
                    {SESSION_PROFILE_OPTIONS.map(renderProfileOption)}
                  </View>
                  <Text style={[styles.desc, { borderLeftColor: profileMeta.color }]}>{profileMeta.description}</Text>
                </View>
              ) : null}

              {openPicker === 'crew' ? (
                <View style={styles.expandedPicker}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionLabel}>Choose crew mode</Text>
                    <Text style={[styles.sectionValue, { color: delegationMeta.color }]} numberOfLines={1}>{delegationMeta.shortLabel}</Text>
                  </View>
                  <View style={styles.optionGrid}>
                    {SESSION_DELEGATION_MODE_OPTIONS.map(renderDelegationOption)}
                  </View>
                  <Text style={[styles.desc, { borderLeftColor: delegationMeta.color }]}>{delegationMeta.description}</Text>
                </View>
              ) : null}
            </View>

            <Pressable
              {...WEB_BUTTON_FOCUS_PROPS}
              {...webDescriptiveLabel(
                moreOptionsOpen ? 'Hide OpenSwan more options' : 'Show OpenSwan more options',
                'Open skills, run history, and recovery routes.',
              )}
              onPress={() => setMoreOptionsOpen(current => !current)}
              accessibilityRole="button"
              accessibilityLabel={moreOptionsOpen ? 'Hide OpenSwan more options' : 'Show OpenSwan more options'}
              accessibilityHint="Open skills, run history, and recovery routes."
              accessibilityState={{ expanded: moreOptionsOpen }}
              style={({ hovered, pressed, focused }: any) => [
                styles.moreDisclosure,
                moreOptionsOpen && styles.moreDisclosureOpen,
                hovered && { borderColor: '#6366f166', backgroundColor: '#6366f10d' },
                pressed && { transform: [{ scale: 0.99 }] },
                focused && Platform.OS === 'web' && styles.keyboardFocus,
                Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
              ]}
            >
              <View style={styles.moreDisclosureCopy}>
                <Text style={styles.moreDisclosureTitle}>More options</Text>
                <Text style={styles.moreDisclosureText} numberOfLines={1}>Skills · runs · recovery</Text>
              </View>
              <Text style={styles.moreDisclosureMeta}>{moreOptionsOpen ? 'HIDE  v' : 'SHOW  >'}</Text>
            </Pressable>

            {moreOptionsOpen ? (
              <View style={styles.morePanel}>
                <View style={styles.controlMap}>
                  <Text style={styles.controlMapLabel}>Where to go</Text>
                  <Text style={styles.controlMapText}>
                    Switch mode and crew here. Pick the agent from the composer's agent button. Model, approvals, and tools are in Control Panel. Past or blocked work is in Runs & recovery.
                  </Text>
                </View>

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
                        hovered && { borderColor: `${SWAN_PURPLE}99`, backgroundColor: `${SWAN_PURPLE}18` },
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
                        hovered && { borderColor: '#6366f188', backgroundColor: '#6366f114' },
                        pressed && { transform: [{ scale: 0.985 }] },
                        focused && Platform.OS === 'web' && styles.keyboardFocus,
                        Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                      ]}
                    >
                      <Text style={styles.runsBtnText}>Runs & recovery</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {onOpenControlPanel && (
              <Pressable
                {...WEB_BUTTON_FOCUS_PROPS}
                {...webDescriptiveLabel(
                  'Open full OpenSwan control panel',
                  'Choose the model, review approvals, and manage tools. The agent is selected from the composer.',
                )}
                onPress={() => { onClose(); onOpenControlPanel(); }}
                accessibilityRole="button"
                accessibilityLabel="Open full OpenSwan control panel"
                accessibilityHint="Choose the model, review approvals, and manage tools. The agent is selected from the composer."
                style={({ hovered, pressed, focused }: any) => [
                  styles.primaryBtn,
                  hovered && { borderColor: '#c084fc', backgroundColor: '#a855f724' },
                  pressed && { transform: [{ scale: 0.985 }] },
                  focused && Platform.OS === 'web' && styles.keyboardFocus,
                  Platform.OS === 'web' && ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any),
                ]}
              >
                <View style={styles.primaryBtnCopy}>
                  <Text style={styles.primaryBtnText}>Open Control Panel</Text>
                  <Text style={styles.primaryBtnHint}>Model · approvals · tools</Text>
                </View>
                <Text style={styles.primaryBtnArrow}>{'>'}</Text>
              </Pressable>
            )}
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
    backgroundColor: 'rgba(2,6,23,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 16,
    ...(Platform.OS === 'web' ? ({
      backdropFilter: 'blur(12px) saturate(1.12)',
      WebkitBackdropFilter: 'blur(12px) saturate(1.12)',
    } as any) : {}),
  },
  sheet: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '88%' as any,
    borderRadius: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: `${SWAN_PURPLE}66`,
    overflow: 'hidden',
    zIndex: 1,
    ...(Platform.OS === 'web' ? ({
      backgroundImage: 'radial-gradient(circle at 8% 0%, rgba(168,85,247,0.18), transparent 34%), radial-gradient(circle at 92% 0%, rgba(99,102,241,0.09), transparent 28%), linear-gradient(145deg, rgba(15,23,42,0.98), rgba(2,6,23,0.99))',
      boxShadow: '0 24px 70px rgba(0,0,0,0.58), 0 0 42px rgba(168,85,247,0.18), 0 0 0 1px rgba(255,255,255,0.025) inset',
    } as any) : {}),
  },
  dismissBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: `${SWAN_PURPLE}33`,
    backgroundColor: `${FIELD_BG}e8`,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${SWAN_PURPLE}88`,
    backgroundColor: `${SWAN_PURPLE}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: {
    color: '#d8b4fe',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#c084fc',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  title: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: TEXT_DIM,
    fontSize: 17,
    fontWeight: '900',
  },
  body: {
    maxHeight: 540,
  },
  bodyContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  essentialBlock: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: '#02061780',
    gap: 10,
  },
  essentialLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  selectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactSelector: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 180,
    minHeight: 76,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 3,
  },
  compactSelectorTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactSelectorLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  selectorChevron: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  compactSelectorValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  compactSelectorHint: {
    color: TEXT_DIM,
    fontSize: 10,
    lineHeight: 13,
  },
  expandedPicker: {
    gap: 9,
    paddingTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionLabel: {
    color: TEXT_DIM,
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
    flexGrow: 1,
    flexBasis: 135,
    minWidth: 125,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  delegationOption: {
    minHeight: 54,
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
    color: TEXT,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
  desc: {
    color: TEXT_DIM,
    fontSize: 11,
    lineHeight: 16,
    borderLeftWidth: 2,
    paddingLeft: 9,
    paddingVertical: 2,
  },
  moreDisclosure: {
    minHeight: 54,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  moreDisclosureOpen: {
    borderColor: '#6366f155',
    backgroundColor: '#6366f10a',
  },
  moreDisclosureCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  moreDisclosureTitle: {
    color: TEXT,
    fontSize: 12,
    fontWeight: '900',
  },
  moreDisclosureText: {
    color: TEXT_DIM,
    fontSize: 10,
  },
  moreDisclosureMeta: {
    color: '#67e8f9',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  morePanel: {
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6366f133',
    backgroundColor: '#02061780',
  },
  controlMap: {
    gap: 3,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  controlMapLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  controlMapText: {
    color: TEXT_DIM,
    fontSize: 11,
    lineHeight: 16,
  },
  primaryBtn: {
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${SWAN_PURPLE}88`,
    backgroundColor: `${SWAN_PURPLE}18`,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    ...(Platform.OS === 'web' ? ({
      boxShadow: '0 10px 28px rgba(168,85,247,0.14), 0 0 0 1px rgba(255,255,255,0.02) inset',
    } as any) : {}),
  },
  primaryBtnCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  primaryBtnText: {
    color: '#d8b4fe',
    fontSize: 13,
    fontWeight: '900',
  },
  primaryBtnHint: {
    color: '#c4b5fd',
    fontSize: 10,
    fontWeight: '700',
  },
  primaryBtnArrow: {
    color: '#e9d5ff',
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
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    color: '#c084fc',
    fontSize: 12,
    fontWeight: '900',
  },
  runsBtnText: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '900',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: `${SWAN_PURPLE}2f`,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: `${FIELD_BG}eb`,
  },
  keyboardFocus: Platform.OS === 'web' ? ({
    outlineColor: '#f8fafc',
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: 2,
  } as any) : {},
});
