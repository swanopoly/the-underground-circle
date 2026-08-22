import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  buildChatActionMenuCatalog,
  type ChatActionMenuEntry,
  type ChatActionMenuSection,
  type QuickActionMode,
} from '../../../../lib/chatActions';
import type { SessionPromptAction } from '../../../../lib/sessionPromptCatalog';

type Props = {
  visible: boolean;
  accentColor: string;
  sessionActions: readonly SessionPromptAction[];
  onSelect: (text: string, mode: QuickActionMode) => void;
  onClose: () => void;
};

const SURFACE = '#0c0f14';
const SURFACE_RAISED = '#121720';
const SURFACE_ACTIVE = '#18202b';
const BORDER = '#28313f';
const BORDER_QUIET = '#202734';
const TEXT = '#f4f6f8';
const TEXT_MUTED = '#9aa6b5';
const TEXT_DIM = '#6f7b8b';
const DANGER = '#ef4444';

const SUBSECTION_LABELS: Readonly<Record<string, string>> = {
  'registry-general': 'General',
  'registry-ai_tools': 'AI tools',
  'registry-missions': 'Missions & tasks',
  'registry-rooms': 'Project rooms',
  'registry-github': 'GitHub',
  'registry-wordpress': 'WordPress commands',
  'registry-knowledge': 'Knowledge',
  'registry-memory': 'Memory',
  'registry-governance': 'Circle & governance',
  'registry-vault': 'Vault',
  'legacy-create': 'Creative shortcuts',
  'legacy-design-apps': 'Design apps',
  'legacy-mac-dashboard': 'Mac controls',
  'legacy-gmail': 'Gmail',
  'legacy-wordpress': 'WordPress navigation',
  'legacy-publish': 'Publish & vote',
  'legacy-wallet': 'Wallet actions',
  quick: 'Quick actions',
};

const WEB_FOCUS_PROPS = Platform.OS === 'web'
  ? ({ focusable: true, tabIndex: 0 } as any)
  : {};

function useReducedMotion(): boolean {
  // Start static so a stored reduced-motion preference never sees a one-frame
  // entrance animation while the asynchronous platform read settles.
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        if (mounted) setReduceMotion(true);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function behaviorLabel(mode: QuickActionMode): string {
  if (mode === 'prefill') return 'Fill draft';
  if (mode === 'send') return 'Send now';
  return 'Open';
}

function isAvailableHere(item: ChatActionMenuEntry): boolean {
  return item.platform !== 'web' || Platform.OS === 'web';
}

function isDangerItem(item: ChatActionMenuEntry): boolean {
  return item.risk === 'destructive' || item.sectionId === 'danger';
}

function matchesQuery(item: ChatActionMenuEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;

  return [item.label, item.description, item.text, ...item.keywords]
    .join(' ')
    .toLocaleLowerCase()
    .includes(needle);
}

function groupSectionItems(items: readonly ChatActionMenuEntry[]) {
  const groups = new Map<string, ChatActionMenuEntry[]>();
  for (const item of items) {
    groups.set(item.sectionId, [...(groups.get(item.sectionId) || []), item]);
  }
  return Array.from(groups, ([id, groupedItems]) => ({
    id,
    label: SUBSECTION_LABELS[id] || id.replace(/^(?:registry|legacy)-/, '').replace(/[-_]+/g, ' '),
    items: groupedItems,
  }));
}

function ActionRow({
  item,
  accentColor,
  onPress,
}: {
  item: ChatActionMenuEntry;
  accentColor: string;
  onPress: () => void;
}) {
  const dangerous = isDangerItem(item);
  const actionColor = dangerous ? DANGER : (item.color || accentColor);
  const actionHint = `${item.description} ${behaviorLabel(item.mode)}.`;

  return (
    <Pressable
      {...WEB_FOCUS_PROPS}
      testID={`chat-action-${item.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityHint={actionHint}
      style={({ hovered, focused, pressed }: any) => [
        styles.actionRow,
        dangerous && styles.actionRowDanger,
        (hovered || pressed) && {
          backgroundColor: dangerous ? '#2a1519' : SURFACE_ACTIVE,
          borderColor: dangerous ? '#7f1d1d' : BORDER,
        },
        focused && [styles.keyboardFocus, { borderColor: actionColor }],
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <View
        accessible={false}
        style={[styles.actionMark, { backgroundColor: actionColor }]}
      />
      <View style={styles.actionCopy}>
        <Text style={[styles.actionLabel, dangerous && styles.dangerText]}>
          {item.label}
        </Text>
        <Text style={styles.actionDescription} numberOfLines={2}>
          {item.description}
        </Text>
      </View>
      <View
        accessible={false}
        style={[
          styles.behaviorBadge,
          dangerous && styles.behaviorBadgeDanger,
        ]}
      >
        <Text style={[styles.behaviorText, dangerous && styles.dangerText]}>
          {behaviorLabel(item.mode)}
        </Text>
      </View>
    </Pressable>
  );
}

function SectionCard({
  section,
  accentColor,
  onPress,
}: {
  section: ChatActionMenuSection;
  accentColor: string;
  onPress: () => void;
}) {
  const dangerous = section.id === 'danger'
    || section.items.some(isDangerItem);
  const sectionColor = dangerous ? DANGER : (section.color || accentColor);

  return (
    <Pressable
      {...WEB_FOCUS_PROPS}
      testID={`chat-action-section-${section.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${section.label}, ${section.items.length} actions`}
      accessibilityHint={section.description}
      style={({ hovered, focused, pressed }: any) => [
        styles.sectionCard,
        dangerous && styles.sectionCardDanger,
        (hovered || pressed) && {
          backgroundColor: dangerous ? '#251418' : SURFACE_ACTIVE,
          borderColor: dangerous ? '#7f1d1d' : BORDER,
        },
        focused && [styles.keyboardFocus, { borderColor: sectionColor }],
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <View style={styles.sectionCardMain}>
        <View style={[styles.sectionDot, { backgroundColor: sectionColor }]} />
        <View style={styles.sectionCardCopy}>
          <Text style={[styles.sectionCardTitle, dangerous && styles.dangerText]}>
            {section.label}
          </Text>
          <Text style={styles.sectionCardDescription} numberOfLines={2}>
            {section.description}
          </Text>
        </View>
      </View>
      <View style={styles.sectionCardMeta} accessible={false}>
        <Text style={[styles.sectionCount, dangerous && styles.dangerText]}>
          {section.items.length}
        </Text>
        <Text style={[styles.sectionView, dangerous && styles.dangerText]}>View</Text>
      </View>
    </Pressable>
  );
}

function SectionHeading({
  title,
  description,
  danger = false,
}: {
  title: string;
  description?: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.sectionHeading} accessibilityRole="header">
      <Text style={[styles.sectionTitle, danger && styles.dangerText]}>{title}</Text>
      {description ? (
        <Text style={styles.sectionDescription}>{description}</Text>
      ) : null}
    </View>
  );
}

export default function ChatActionsMenu({
  visible,
  accentColor,
  sessionActions,
  onSelect,
  onClose,
}: Props) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const searchRef = useRef<TextInput>(null);
  const returnFocusRef = useRef<any>(null);
  const restoreFocusOnCloseRef = useRef(true);
  const onCloseRef = useRef(onClose);
  const [query, setQuery] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const catalog = useMemo(
    () => buildChatActionMenuCatalog(sessionActions),
    [sessionActions],
  );

  onCloseRef.current = onClose;

  const availableSections = useMemo(
    () => catalog.sections
      .map((section) => ({
        ...section,
        items: section.items.filter(isAvailableHere),
      }))
      .filter((section) => section.items.length > 0),
    [catalog.sections],
  );

  const activeSection = availableSections.find(
    (section) => section.id === activeSectionId,
  ) || null;
  const activeSectionGroups = activeSection ? groupSectionItems(activeSection.items) : [];

  const common = catalog.common
    .filter(isAvailableHere)
    .filter((item) => !isDangerItem(item));
  const searchResults = catalog.searchItems
    .filter(isAvailableHere)
    .filter((item) => matchesQuery(item, query));
  const regularSearchResults = searchResults.filter((item) => !isDangerItem(item));
  const dangerSearchResults = searchResults.filter(isDangerItem);
  const regularSections = availableSections.filter(
    (section) => section.id !== 'danger' && !section.items.every(isDangerItem),
  );
  const dangerSections = availableSections.filter(
    (section) => section.id === 'danger' || section.items.every(isDangerItem),
  );
  const hasQuery = query.trim().length > 0;
  const dialogWidth = Math.max(0, Math.min(720, width - (width < 480 ? 16 : 32)));
  const dialogMaxHeight = Math.max(0, height - (height < 600 ? 16 : 40));

  useEffect(() => {
    if (!visible) return;

    setQuery('');
    setActiveSectionId(null);
    restoreFocusOnCloseRef.current = true;

    const documentRef = Platform.OS === 'web'
      ? (globalThis as any).document
      : null;
    returnFocusRef.current = documentRef?.activeElement || null;

    const focusTimer = setTimeout(() => {
      searchRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: any) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !documentRef) return;
      const dialog = documentRef.getElementById('chat-actions-dialog');
      if (!dialog) return;

      const candidates = Array.from(dialog.querySelectorAll(
        'button, input, [href], [tabindex]:not([tabindex="-1"])',
      )).filter((node: any) => (
        !node.disabled
        && node.getAttribute?.('aria-hidden') !== 'true'
        && node.offsetParent !== null
      )) as any[];

      if (candidates.length === 0) {
        event.preventDefault();
        return;
      }

      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture at the document boundary because React Native Web's Modal
    // portal can stop key events before the normal bubbling phase reaches
    // document. This also keeps Tab trapping reliable inside the portal.
    documentRef?.addEventListener('keydown', handleKeyDown, true);

    return () => {
      clearTimeout(focusTimer);
      documentRef?.removeEventListener('keydown', handleKeyDown, true);
      const target = returnFocusRef.current;
      if (restoreFocusOnCloseRef.current) setTimeout(() => target?.focus?.(), 0);
    };
  }, [visible]);

  const chooseAction = (item: ChatActionMenuEntry) => {
    restoreFocusOnCloseRef.current = false;
    onSelect(item.text, item.mode);
    onClose();
  };

  const handleDialogKeyDown = (event: any) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCloseRef.current();
  };

  const renderActions = (items: readonly ChatActionMenuEntry[]) => (
    <View style={styles.actionList}>
      {items.map((item) => (
        <ActionRow
          key={item.id}
          item={item}
          accentColor={accentColor}
          onPress={() => chooseAction(item)}
        />
      ))}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable
          accessible={false}
          {...(Platform.OS === 'web'
            ? ({ 'aria-hidden': true, tabIndex: -1 } as any)
            : {})}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        <View
          nativeID="chat-actions-dialog"
          testID="chat-actions-menu"
          accessibilityViewIsModal
          accessibilityLabel="Chat actions"
          {...(Platform.OS === 'web'
            ? ({
                role: 'dialog',
                'aria-modal': true,
                'aria-labelledby': 'chat-actions-title',
                'aria-describedby': 'chat-actions-description',
                onKeyDown: handleDialogKeyDown,
              } as any)
            : {})}
          style={[
            styles.dialog,
            {
              width: dialogWidth,
              maxHeight: dialogMaxHeight,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text nativeID="chat-actions-title" style={styles.title}>
                Actions
              </Text>
              <Text nativeID="chat-actions-description" style={styles.subtitle}>
                Find a command, tool, or workflow.
              </Text>
            </View>
            <Pressable
              {...WEB_FOCUS_PROPS}
              testID="chat-actions-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close actions"
              style={({ hovered, focused, pressed }: any) => [
                styles.closeButton,
                (hovered || pressed) && styles.controlActive,
                focused && [styles.keyboardFocus, { borderColor: accentColor }],
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              ref={searchRef}
              testID="chat-actions-search"
              value={query}
              onChangeText={(value) => {
                setQuery(value);
                if (value.trim()) setActiveSectionId(null);
              }}
              placeholder="Search actions"
              placeholderTextColor={TEXT_DIM}
              selectionColor={accentColor}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search chat actions"
              {...(Platform.OS === 'web' ? ({ role: 'searchbox' } as any) : {})}
              style={[styles.searchInput, { borderColor: query ? accentColor : BORDER }]}
            />
            {query ? (
              <Pressable
                {...WEB_FOCUS_PROPS}
                onPress={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear actions search"
                style={({ hovered, focused, pressed }: any) => [
                  styles.clearButton,
                  (hovered || pressed) && styles.controlActive,
                  focused && [styles.keyboardFocus, { borderColor: accentColor }],
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
              >
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {hasQuery ? (
              <>
                <SectionHeading
                  title="Search results"
                  description={`${searchResults.length} ${searchResults.length === 1 ? 'action' : 'actions'}`}
                />
                {regularSearchResults.length > 0
                  ? renderActions(regularSearchResults)
                  : dangerSearchResults.length === 0
                    ? (
                        <View style={styles.emptyState}>
                          <Text style={styles.emptyTitle}>No matching actions</Text>
                          <Text style={styles.emptyDescription}>
                            Try a command, app, task, or workflow name.
                          </Text>
                        </View>
                      )
                    : null}
                {dangerSearchResults.length > 0 ? (
                  <View style={styles.dangerBlock}>
                    <SectionHeading
                      title="Danger zone"
                      description="These actions can remove or revoke data."
                      danger
                    />
                    {renderActions(dangerSearchResults)}
                  </View>
                ) : null}
              </>
            ) : activeSection ? (
              <>
                <Pressable
                  {...WEB_FOCUS_PROPS}
                  onPress={() => setActiveSectionId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to all action categories"
                  style={({ hovered, focused, pressed }: any) => [
                    styles.backButton,
                    (hovered || pressed) && styles.controlActive,
                    focused && [styles.keyboardFocus, { borderColor: accentColor }],
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                  ]}
                >
                  <Text style={styles.backText}>All actions</Text>
                </Pressable>
                <SectionHeading
                  title={activeSection.label}
                  description={activeSection.description}
                  danger={activeSection.id === 'danger' || activeSection.items.every(isDangerItem)}
                />
                {activeSection.id === 'danger' ? renderActions(activeSection.items) : (
                  <View style={styles.groupedActions}>
                    {activeSectionGroups.map((group) => (
                      <View key={group.id} style={styles.actionGroup}>
                        <SectionHeading title={group.label} />
                        {renderActions(group.items)}
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                {common.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <SectionHeading
                      title="Common"
                      description="Frequently used Chat actions"
                    />
                    {renderActions(common)}
                  </View>
                ) : null}

                {regularSections.length > 0 ? (
                  <View style={styles.sectionBlock}>
                    <SectionHeading
                      title="Browse"
                      description="Open a focused action category"
                    />
                    <View style={styles.sectionList}>
                      {regularSections.map((section) => (
                        <SectionCard
                          key={section.id}
                          section={section}
                          accentColor={accentColor}
                          onPress={() => setActiveSectionId(section.id)}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {dangerSections.length > 0 ? (
                  <View style={[styles.sectionBlock, styles.dangerBlock]}>
                    <SectionHeading
                      title="Danger zone"
                      description="Destructive actions are kept separate."
                      danger
                    />
                    <View style={styles.sectionList}>
                      {dangerSections.map((section) => (
                        <SectionCard
                          key={section.id}
                          section={section}
                          accentColor={accentColor}
                          onPress={() => setActiveSectionId(section.id)}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: 'rgba(2, 5, 10, 0.76)',
  },
  dialog: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    backgroundColor: SURFACE,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.48,
    shadowRadius: 42,
    elevation: 24,
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_QUIET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: TEXT,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 2,
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    minWidth: 56,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE_RAISED,
  },
  closeText: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '700',
  },
  searchWrap: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_QUIET,
    justifyContent: 'center',
  },
  searchInput: {
    minHeight: 46,
    paddingLeft: 14,
    paddingRight: 76,
    borderWidth: 1,
    borderRadius: 11,
    backgroundColor: SURFACE_RAISED,
    color: TEXT,
    fontSize: 15,
    lineHeight: 20,
    outlineStyle: 'none',
  } as any,
  clearButton: {
    position: 'absolute',
    right: 22,
    top: 15,
    minWidth: 58,
    minHeight: 44,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  scroll: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 22,
  },
  sectionBlock: {
    marginBottom: 22,
  },
  sectionHeading: {
    marginBottom: 9,
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sectionDescription: {
    marginTop: 2,
    color: TEXT_DIM,
    fontSize: 12,
    lineHeight: 17,
  },
  actionList: {
    gap: 7,
  },
  groupedActions: {
    gap: 20,
  },
  actionGroup: {
    gap: 0,
  },
  actionRow: {
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 11,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: BORDER_QUIET,
    borderRadius: 11,
    backgroundColor: SURFACE_RAISED,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionRowDanger: {
    borderColor: '#4b2025',
    backgroundColor: '#1b1216',
  },
  actionMark: {
    width: 3,
    height: 30,
    borderRadius: 3,
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
  },
  actionLabel: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  actionDescription: {
    marginTop: 2,
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  behaviorBadge: {
    minHeight: 24,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e1218',
  },
  behaviorBadgeDanger: {
    borderColor: '#64252c',
    backgroundColor: '#211216',
  },
  behaviorText: {
    color: TEXT_MUTED,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  sectionList: {
    gap: 7,
  },
  sectionCard: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER_QUIET,
    borderRadius: 11,
    backgroundColor: SURFACE_RAISED,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionCardDanger: {
    borderColor: '#4b2025',
    backgroundColor: '#1b1216',
  },
  sectionCardMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionCardCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionCardTitle: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  sectionCardDescription: {
    marginTop: 2,
    color: TEXT_DIM,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionCardMeta: {
    alignItems: 'flex-end',
  },
  sectionCount: {
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  sectionView: {
    marginTop: 1,
    color: TEXT_DIM,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    minWidth: 92,
    marginBottom: 10,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE_RAISED,
  },
  backText: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: '800',
  },
  controlActive: {
    borderColor: '#475569',
    backgroundColor: SURFACE_ACTIVE,
  },
  keyboardFocus: {
    borderWidth: 1,
    backgroundColor: SURFACE_ACTIVE,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.55)' } as any
      : {}),
  },
  dangerBlock: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#4b2025',
  },
  dangerText: {
    color: '#f87171',
  },
  emptyState: {
    minHeight: 132,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER_QUIET,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE_RAISED,
  },
  emptyTitle: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  emptyDescription: {
    marginTop: 4,
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
