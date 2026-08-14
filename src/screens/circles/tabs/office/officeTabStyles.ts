/**
 * officeTabStyles — every StyleSheet the Office tab renders with.
 *
 * Extracted verbatim from `OfficeTab.tsx` (the same move the OpenSwan console
 * decomposition made: 6534 → 4198). Pure style data, no logic and no imports
 * beyond StyleSheet, so it carries zero behaviour risk while taking ~900 lines
 * of noise out of the component file. Each export keeps its original name and
 * ordering so a `git diff -M` of the move stays readable.
 */

import { Platform, StyleSheet } from 'react-native';

// ─── Manual Publish Modal Styles ──────────────────────────────────────────────
export const pmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000bb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#000000',
    borderRadius: 16,
    padding: 24,
    width: 340,
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: '#6f6f6f',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 20,
  },
  label: {
    color: '#a3a3a3',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    marginBottom: 18,
  },
  providerRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
    marginBottom: 20,
  },
  providerChip: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    minWidth: 64,
  },
  providerChipActive: {
    backgroundColor: '#6366f115',
    borderColor: '#6366f1',
  },
  providerIcon: { fontSize: 20, marginBottom: 4 },
  providerLabel: { color: '#6f6f6f', fontSize: 10, fontWeight: '600' },
  providerLabelActive: { color: '#6366f1' },
  submitBtn: {
    backgroundColor: '#252525',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: '#2a2a2a',
    opacity: 0.6,
  },
  submitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export const coStyles = StyleSheet.create({
  // Compact (desktop)
  compactBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    backgroundColor: '#000000',
    gap: 10,
  },
  compactLabel: { color: '#444', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  compactScroll: { flexDirection: 'row', gap: 8 },
  compactChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, backgroundColor: '#0a0a0a',
    position: 'relative',
  },
  buildingDot: {
    position: 'absolute', top: 4, right: 4,
    width: 6, height: 6, borderRadius: 3,
  },
  compactIcon: { fontSize: 14 },
  compactOwner: { color: '#888', fontSize: 10 },
  compactAgentName: { color: '#ccc', fontSize: 12, fontWeight: '600', maxWidth: 80 },
  compactBuildXp: { color: '#60a5fa', fontSize: 9, fontWeight: '800', marginTop: 1, letterSpacing: 0.4 },
  compactTask: { color: '#555', fontSize: 11, maxWidth: 120, fontStyle: 'italic' },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, marginLeft: 2 },

  // Full card (mobile)
  panel: { paddingHorizontal: 4, paddingBottom: 8 },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
  },
  panelTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  connectionDot: { width: 7, height: 7, borderRadius: 3.5 },
  connectionLabel: { fontSize: 11, fontWeight: '600' },
  panelStats: { flexDirection: 'row', gap: 10 },
  statBuilding: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  statIdle: { color: '#f59e0b', fontSize: 12 },
  statOffline: { color: '#444', fontSize: 12 },

  agentCard: {
    backgroundColor: '#111', borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 10, marginHorizontal: 4,
  },
  buildingAgentCard: {
    shadowColor: '#3b82f6',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ownAgentCard: { borderStyle: 'dashed' },
  offlineCard: { opacity: 0.6 },

  agentCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  providerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  providerIcon: { fontSize: 14 },
  providerLabel: { fontSize: 11, fontWeight: '700' },

  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { color: '#666', fontSize: 12 },
  statusTextBuilding: { color: '#60a5fa', fontWeight: '900', letterSpacing: 0.6 },

  agentIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  ownerAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ownerAvatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  agentName: { color: '#ddd', fontSize: 14, fontWeight: '700' },
  ownerName: { color: '#555', fontSize: 12 },

  taskBlock: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  taskLabel: { color: '#60a5fa', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginBottom: 4 },
  taskText: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  goalText: { color: '#888', fontSize: 12, marginTop: 4 },
  buildStatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 8 },
  buildStatPill: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2c3344',
    backgroundColor: '#111827',
  },
  buildStatValue: { color: '#f8fafc', fontSize: 12, fontWeight: '900' },
  buildStatLabel: { color: '#7dd3fc', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 1 },
  buildingFlavor: { color: '#93c5fd', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  sessionLink: { marginBottom: 4 },
  sessionLinkText: { fontSize: 12, fontWeight: '600' },
  returnTime: { color: '#444', fontSize: 11 },

  publishBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 8, padding: 14,
    backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1,
    borderStyle: 'dashed',
  },
  publishBtnIcon: { fontSize: 24 },
  publishBtnTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  publishBtnSub: { color: '#555', fontSize: 12 },
});

export const nftStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', alignItems: 'center' },
  card: { width: 380, maxHeight: 500, backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#2a2a2a' },
  headerText: { color: '#eee', fontSize: 14, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 2 },
  closeBtn: { padding: 6 },
  closeText: { color: '#666', fontSize: 16 },
  emptyState: { padding: 40, alignItems: 'center', gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: '#888', fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  emptyHint: { color: '#555', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', lineHeight: 16 },
  grid: { maxHeight: 380 },
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 },
  nftCard: { width: '30%' as any, backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden', padding: 4, alignItems: 'center' },
  nftImage: { width: '100%' as any, aspectRatio: 1, borderRadius: 6 },
  nftName: { color: '#ccc', fontSize: 9, fontFamily: 'monospace', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  nftCollection: { color: '#555', fontSize: 7, fontFamily: 'monospace', textAlign: 'center' },
  clearBtn: { margin: 12, padding: 10, backgroundColor: '#2a2a2a', borderRadius: 8, alignItems: 'center' },
  clearText: { color: '#9e9e9e', fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
});

export const imgPickerStyles = StyleSheet.create({
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#2a2a2a' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#000000' },
  tabActive: { backgroundColor: '#0a0a0a', borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { color: '#555', fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  tabTextActive: { color: '#eee' },
  uploadArea: { padding: 40, alignItems: 'center', gap: 12 },
  uploadTitle: { color: '#ccc', fontSize: 14, fontFamily: 'monospace', fontWeight: '700' },
  uploadHint: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },
  uploadBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#6366f1', borderRadius: 8 },
  uploadBtnText: { color: '#e8e8e8', fontSize: 11, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
});

export const stickyStyles = StyleSheet.create({
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#2a2a2a' },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#333' },
  colorDotActive: { borderColor: '#fff', borderWidth: 3 },
  writeArea: { padding: 12, flex: 1 },
  textInput: {
    minHeight: 140, borderRadius: 6, padding: 12,
    color: '#000000', fontSize: 14, fontFamily: 'monospace',
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  drawArea: { padding: 12, alignItems: 'center', gap: 8 },
  canvasWrap: { width: '100%' as any, height: 200, borderRadius: 6, overflow: 'hidden' },
  clearDrawBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#333', backgroundColor: '#000000',
  },
  clearDrawText: { color: '#888', fontSize: 9, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 },
  gifArea: { padding: 12, gap: 10 },
  gifInput: {
    backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#222',
    borderRadius: 8, padding: 10, color: '#ddd', fontSize: 12, fontFamily: 'monospace',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  gifPreview: { height: 150, borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  gifImage: { width: '100%' as any, height: '100%' as any },
  gifHint: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  gifHintText: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },
  saveBtn: {
    margin: 12, paddingVertical: 12, borderRadius: 8, backgroundColor: '#252525',
    alignItems: 'center',
  },
  saveBtnText: { color: '#e8e8e8', fontSize: 12, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
});

// ─── Service Connector Modal Styles ──────────────────────────────────────────
export const svcStyles = StyleSheet.create({
  sectionLabel: {
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
  },
  appGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  appCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 72,
    position: 'relative',
  },
  appIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  appName: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  appCheck: {
    position: 'absolute',
    top: 4,
    right: 6,
    fontSize: 12,
    fontWeight: '900',
  },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sizeField: {
    flex: 1,
    alignItems: 'center',
  },
  sizeLabel: {
    color: '#666',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sizeInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    width: '100%',
  },
  sizeX: {
    color: '#555',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  openBtn: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  openBtnText: {
    color: '#e8e8e8',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  serviceHero: {
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '900',
    fontFamily: 'monospace',
    marginTop: 8,
  },
  heroDesc: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
    maxWidth: 260,
  },
  connectBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  saveBtn: {
    backgroundColor: '#252525',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    color: '#e8e8e8',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
});

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  tagsActionBtn: {
    flex: 1,
    backgroundColor: '#6366f118',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tagsActionBtnSecondary: {
    backgroundColor: '#ffffff10',
    borderColor: '#ffffff20',
  },
  tagsActionBtnText: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  tagsActionBtnTextSecondary: { color: '#6366f1' },
  toolbarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#181818', borderWidth: 1, borderColor: '#2a2a2a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  toolbarBtnActiveGreen: {
    borderColor: '#ffffff20', backgroundColor: '#ffffff10',
  },
  toolbarBtnActiveMemory: {
    backgroundColor: '#22c55e18',
    borderColor: '#22c55e40',
  },
  toolbarBtnIcon: { fontSize: 13 },
  toolbarBtnText: { fontSize: 11, fontWeight: '700', color: '#888', fontFamily: 'monospace' },
  toolbarBtnTextActiveMemory: { color: '#22c55e' },
  reconnectBtnStyle: {
    backgroundColor: '#ffffff08', borderColor: '#ffffff15',
  },
  tgBadge: { fontSize: 7, marginRight: 1 },

  // Office enhancement panels
  enhancementRow: {
    flexDirection: 'row' as const, alignItems: 'stretch' as const,
    gap: 4, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#050508',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  feedPanel: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#050508',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },

  // Combined floor + actions bar
  floorBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#000000',
    gap: 8,
    position: 'relative',
    zIndex: 40,
    overflow: 'visible',
  },
  floorList: { gap: 4, flexDirection: 'row', alignItems: 'center' },
  barActions: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, zIndex: 50, overflow: 'visible' },
  officeDashboardPanels: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    flexWrap: 'wrap',
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    zIndex: 1,
  },
  officeDashboardPanel: {
    minWidth: 220,
    maxWidth: 360,
    flexShrink: 1,
  },
  soundPanelWrap: {
    maxWidth: 220,
  },
  floorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 5, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000000',
  },
  floorChipActive: {
    borderColor: '#ffffff30', backgroundColor: '#ffffff10',
  },
  floorChipText: {
    fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: '600',
  },
  floorChipTextActive: {
    color: '#fff', fontWeight: '700',
  },
  floorThemeDot: {
    width: 7, height: 7, borderRadius: 4,
  },
  floorAgentBadge: {
    backgroundColor: '#ffffff10',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floorAgentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6366f1',
    fontFamily: 'monospace',
  },
  floorAddBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 6, borderWidth: 1, borderColor: '#6366f130', backgroundColor: '#6366f115',
  },
  floorAddBtnText: {
    fontSize: 11, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1,
  },

  // Connections bar
  connectionsBar: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a', backgroundColor: '#000000',
    flexDirection: 'row', alignItems: 'center',
  },
  connectionsToggle: { paddingRight: 8, paddingVertical: 2 },
  connectionsToggleText: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  connectionsBarInner: { gap: 8, flexDirection: 'row', alignItems: 'center', flex: 1 },
  connectionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0a0a0a',
  },
  connectionChipDot: { width: 6, height: 6, borderRadius: 3 },
  connectionChipStatus: { width: 5, height: 5, borderRadius: 3 },
  connectionChipName: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', fontWeight: '600', maxWidth: 120 },
  connectionChipLabel: { fontSize: 9, fontFamily: 'monospace', fontWeight: '600' },
  connectionChipLocal: { fontSize: 10, marginLeft: 2 },
  connectionAddChip: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    borderColor: '#ffffff20', backgroundColor: '#ffffff08',
    alignItems: 'center', justifyContent: 'center',
  },
  connectionAddChipText: { fontSize: 14, color: '#6366f1', fontWeight: '700' },

  editToolbar: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a', backgroundColor: '#0a0a0a',
  },
  editLabel: { fontSize: 8, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  editItems: { gap: 8, flexDirection: 'row', paddingRight: 12 },
  editItem: {
    alignItems: 'center', justifyContent: 'center',
    width: 88, height: 88,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#2a2a2a', backgroundColor: '#000000',
    gap: 3, paddingHorizontal: 4, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  editItemActive: {
    borderColor: '#ffffff30', backgroundColor: '#ffffff10',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 12px rgba(99,102,241,0.3)' } as any : {}),
  },
  editItemIcon: { fontSize: 28 },
  editItemName: { fontSize: 10, color: '#aaa', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center' },
  editItemDesc: { fontSize: 8, color: '#555', fontFamily: 'monospace', maxWidth: 80, textAlign: 'center', lineHeight: 10 },
  editToolbarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  editToolbarActions: { flexDirection: 'row', gap: 6 },
  editActionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  editActionBtnText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  editCatalogWrap: {
    position: 'relative' as const,
  },
  editCatTabs: {
    flexDirection: 'row' as const, gap: 6, paddingBottom: 8, paddingRight: 12,
  },
  editCatTab: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    backgroundColor: '#0a0a0a',
  },
  editCatTabText: {
    fontSize: 8, fontFamily: 'monospace', fontWeight: '800' as const, letterSpacing: 1,
  },
  editCatTabCount: {
    fontSize: 7, fontFamily: 'monospace', fontWeight: '700' as const,
  },
  editCatRowWrap: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
  },
  editScrollArrow: {
    width: 24, height: 80, borderRadius: 6, borderWidth: 1,
    backgroundColor: '#0a0a0a90', alignItems: 'center' as const, justifyContent: 'center' as const,
    zIndex: 2,
  },
  editScrollArrowLeft: { marginRight: 4 },
  editScrollArrowRight: { marginLeft: 4 },
  editScrollArrowText: {
    fontSize: 22, fontWeight: '700' as const,
  },
  floorChipWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 6 },
  floorChipWithDelete: { paddingRight: 28 },
  floorDeleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#160b0b',
    borderWidth: 1,
    borderColor: '#ef444455',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  floorDeleteBtnText: { fontSize: 10, color: '#ef4444', fontWeight: '800', lineHeight: 20 },
  clearBtn: {
    marginTop: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4,
    backgroundColor: '#ffffff10', alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  clearBtnText: { fontSize: 8, color: '#9e9e9e', fontFamily: 'monospace', fontWeight: '700' },
  mainContent: { flex: 1 },

  // Mobile agent cards
  mobileAgentScroll: { flex: 1 },
  mobileAgentList: { padding: 16, gap: 12 },
  mobileEmpty: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12,
  },
  mobileEmptyIcon: { fontSize: 40 },
  mobileEmptyTitle: { fontSize: 18, color: '#999', fontFamily: 'monospace', fontWeight: '800' },
  mobileEmptyText: { fontSize: 14, color: '#666', fontFamily: 'monospace', textAlign: 'center', paddingHorizontal: 24 },
  mobileEmptyBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#252525', minHeight: 48,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileEmptyBtnText: { fontSize: 14, color: '#e8e8e8', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 },
  mobileAgentCard: {
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 14, padding: 16, gap: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mobileCardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  mobileCardAvatar: {
    width: 48, height: 48, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  mobileCardAvatarText: { fontSize: 20, fontWeight: '900', fontFamily: 'monospace' },
  mobileCardInfo: { flex: 1, gap: 3 },
  mobileCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileCardName: { fontSize: 16, fontWeight: '800', color: '#eee', fontFamily: 'monospace' },
  mobileCardMainBadge: { fontSize: 10, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
  mobileCardStatus: { width: 8, height: 8, borderRadius: 4 },
  mobileCardStatusText: { fontSize: 12, fontFamily: 'monospace', fontWeight: '600', textTransform: 'uppercase' as any },
  mobileCardRole: { fontSize: 13, color: '#888', fontFamily: 'monospace' },
  mobileCardModel: { fontSize: 12, color: '#666', fontFamily: 'monospace' },
  mobileCardRight: { alignItems: 'flex-end', gap: 2 },
  mobileCardCost: { fontSize: 16, fontWeight: '900', color: '#6366f1', fontFamily: 'monospace' },
  mobileCardCostLabel: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  mobileCardActivity: { fontSize: 13, color: '#777', fontFamily: 'monospace', paddingLeft: 62 },
  officeScroll: { flex: 1 },
  // Ops board (Building Now + Tokens) — desktop row beneath the office floor
  opsBoardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  officeScaleOuter: { overflow: 'hidden' },
  officeWrapper: { position: 'relative', transformOrigin: 'top left' as any },
  emptyOverlay: {
    position: 'absolute', top: '35%' as any, left: 0, right: 0, alignItems: 'center', zIndex: 20, gap: 6, paddingHorizontal: 20,
  },
  emptyIcon: { fontSize: 28 },
  emptyTitle: { fontSize: 13, color: '#666', fontFamily: 'monospace', fontWeight: '800', textAlign: 'center' },
  emptyText: { fontSize: 10, color: '#555', fontFamily: 'monospace', textAlign: 'center' },
  emptySub: { fontSize: 9, color: '#444', fontFamily: 'monospace', fontStyle: 'italic', textAlign: 'center' },
  desktopWidgetPlaceholder: {
    position: 'absolute', top: 12, right: 12, minWidth: 148, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#05050bcc', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 10, zIndex: 6,
  },
  desktopWidgetPlaceholderRack: {
    top: 104,
  },
  desktopWidgetPlaceholderTitle: {
    fontSize: 10, color: '#7a7a8a', fontFamily: 'monospace', fontWeight: '700',
  },
  // User-placed furniture starts at zIndex 8. Keep agents above the built-in
  // floor art but below placed objects so visible tools never become blocked
  // by a sprite at the same coordinates.
  agentPosition: { position: 'absolute', zIndex: 7 },
  quickBar: {
    borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingVertical: 6, paddingHorizontal: 8,
  },
  quickBarInner: { gap: 6, flexDirection: 'row' },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8,
    paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000000',
  },
  quickProviderDot: { width: 4, height: 4, borderRadius: 2 },
  quickMainMark: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace' },
  quickDot: { width: 4, height: 4, borderRadius: 2 },
  quickName: { fontSize: 9, color: '#666', fontFamily: 'monospace', fontWeight: '600' },
  quickCost: { fontSize: 8, color: '#444', fontFamily: 'monospace' },
  chatToggle: {
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
    backgroundColor: '#0a0a0a',
  },
  terminalBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 12, gap: 12,
  },
  terminalBarBtn: {
    paddingVertical: 4, paddingHorizontal: 12,
  },
  terminalLoader: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#040409',
  },
  terminalLoaderText: {
    fontSize: 12, color: '#7a7a8a', fontFamily: 'monospace',
  },
  chatToggleText: { fontSize: 13, color: '#888', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 },
  terminalSizeButtons: {
    flexDirection: 'row', gap: 4,
  },
  terminalSizeBtn: {
    width: 32, height: 28, borderRadius: 6,
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  terminalSizeBtnActive: {
    borderColor: '#6366f1', backgroundColor: '#6366f115',
  },
  terminalSizeBtnText: {
    fontSize: 12, color: '#555',
  },
  terminalSizeBtnTextActive: {
    color: '#6366f1',
  },
  chatPane: { height: 320 },

  // Action Result Toast
  actionResultToast: {
    position: 'absolute',
    bottom: 280,
    left: 12,
    right: 12,
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    zIndex: 1000,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  toastClose: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff10',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1001,
  },
  toastCloseText: {
    fontSize: 12,
    color: '#999',
    fontWeight: '700',
  },
  actionResultText: {
    fontSize: 12,
    color: '#fff',
    fontFamily: 'monospace',
    lineHeight: 18,
    paddingRight: 32,
  },
  terminalFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    backgroundColor: '#000',
  },
  terminalFullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#000000',
  },
  terminalFullscreenBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff15',
  },
  terminalFullscreenBtnText: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});

// ─── Filter chip row above the agent list ───────────────────────────────────

export const officeFilterChipStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#0a0a0a',
  },
  chipActive: {
    borderColor: '#ffffff',
    backgroundColor: '#141414',
  },
  label: {
    color: '#a3a3a3',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  labelActive: {
    color: '#ffffff',
  },
  count: {
    color: '#525252',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: '#000000',
    minWidth: 16,
    textAlign: 'center',
  },
  countActive: {
    color: '#ffffff',
    backgroundColor: '#1f1f1f',
  },
});
