/**
 * Source-level regression coverage for the Office addon/editor integration.
 *
 * The Office surface imports React Native and browser-only modules, so this
 * smoke pins the cross-component wiring without pretending to be a rendered
 * browser test. Keep assertions focused on durable behavioral boundaries.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFFICE_ADDON_TYPES } from '../src/lib/officeConfig';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0, `source contains section start: ${start}`);
  assert(endIndex > startIndex, `source contains section end after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const officeTab = read('src/screens/circles/tabs/OfficeTab.tsx');
const officeSections = read('src/screens/circles/tabs/office/OfficeSections.tsx');
const officeFloor = read('src/screens/circles/tabs/office/OfficeFloor.tsx');
const interactiveFurniture = read('src/screens/circles/tabs/office/InteractiveFurniture.tsx');
const statusPicker = read('src/components/office/StatusPicker.tsx');
const animationHelpers = read('src/lib/animationHelpers.ts');
const phoneMessenger = read('src/components/PhoneMessenger.tsx');
const agentPanelShell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const connectAllBridgesPanel = read('src/components/office/ConnectAllBridgesPanel.tsx');
const officeBridgeDiagPanel = read('src/components/office/OfficeBridgeDiagPanel.tsx');
const officeBridgeReadinessStrip = read('src/components/office/OfficeBridgeReadinessStrip.tsx');
const officeTerminal = read('src/components/OfficeTerminal.tsx');
const officeTerminalRelay = read('src/lib/officeTerminal.ts');
const oauthConnect = read('src/lib/oauthConnect.ts');

const furnitureRenderer = section(
  officeFloor,
  'function renderFurnitureContent(',
  '//  MAIN FLOOR COMPONENT',
);
const renderedAddonTypes = new Set(
  [...furnitureRenderer.matchAll(/case '([^']+)'/g)].map((match) => match[1]),
);
assert.deepEqual(
  OFFICE_ADDON_TYPES.filter((type) => !renderedAddonTypes.has(type)),
  [],
  'every canonical Office addon has a dedicated floor renderer',
);
assert(!furnitureRenderer.includes('>LIVE</Text>'), 'decorative floor renderers never claim live data');

// Catalog discovery, room kits, and reversible editor history share one core.
assert.match(
  officeSections,
  /from ['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/officeAddonExperienceCore['"];/,
  'Office workspace imports the canonical addon experience core',
);
for (const token of [
  'queryOfficeAddonCatalog(FURNITURE_CATALOG',
  'OFFICE_ROOM_KITS.map',
  'catalogSearch',
  'setCatalogStatus',
  "setCatalogScope('all')",
  "catalogScope === 'favorites'",
  "catalogScope === 'recent'",
  "catalogScope === 'problems'",
  'favoriteTypes: favoriteOfficeAddonTypes',
  'onToggleCatalogFavorite(item.type)',
  'historyAvailability?.canUndo',
  'historyAvailability?.canRedo',
  'onApplyRoomKit(kit.id)',
]) {
  assert(officeSections.includes(token), `Office workspace wires ${token}`);
}
assert(
  officeSections.includes('Search ${FURNITURE_CATALOG.length} Office items'),
  'catalog search communicates the complete dynamic catalog size',
);
assert(
  officeSections.includes('statusLabels[viewItem.status]'),
  'catalog cards expose their truthful runtime/setup/demo state',
);
for (const token of [
  'createOfficeEditorHistory',
  'commitOfficeEditorSnapshot',
  'undoOfficeEditorHistory',
  'redoOfficeEditorHistory',
  'commitCurrentFloorEdit',
  'planOfficeRoomKit',
  'parseOfficeAddonCatalogPreferences',
  'serializeOfficeAddonCatalogPreferences',
  'setOfficeAddonFavorite',
  'recordOfficeAddonRecentType',
  'officeAddonPreferencesStorageKey(currentUserId, circleId)',
]) {
  assert(officeTab.includes(token), `Office controller wires ${token}`);
}
assert(
  officeTab.includes('favoriteOfficeAddonTypes={officeAddonPreferences.favoriteTypes}')
    && officeTab.includes('recentOfficeAddonTypes={officeAddonPreferences.recentTypes}')
    && officeTab.includes('onToggleCatalogFavorite={toggleOfficeAddonFavorite}'),
  'catalog personalization is loaded, persisted, and wired into the visible catalog',
);
assert(
  officeTab.includes('`${OFFICE_ADDON_PREFERENCES_STORAGE_KEY}:${userId}:${circleId}`')
    && officeTab.includes('if (!scope) return')
    && officeTab.includes('[circleId, currentUserId]'),
  'catalog personalization is isolated by authenticated user and circle',
);
assert(
  officeSections.includes("event.stopPropagation?.()")
    && officeSections.includes("width: 30, height: 30")
    && officeSections.includes("viewItem.favorite ? '★' : '☆'"),
  'favorite action is an isolated, accessible target rather than triggering item placement',
);

// Mobile edit mode must render the actual floor instead of trapping users in
// the read-only mobile dashboard.
assert.match(
  officeTab,
  /!isDesktop\s*&&\s*!editMode\s*\?\s*\(/,
  'mobile read-only dashboard is bypassed while editing',
);
assert(
  officeTab.includes('if (!isDesktop) {\n      placeOfficeAddon(type);'),
  'mobile catalog selection immediately places the addon',
);

// Selection is reversible; deletion is explicit and resize commits one atomic
// position/size transform when that capability is available.
const deleteHandler = section(officeTab, 'const handleFurnitureDelete =', 'const loadUserNfts =');
assert(deleteHandler.includes('showConfirm({'), 'item deletion asks for confirmation');
assert(deleteHandler.includes('commitCurrentFloorEdit('), 'item deletion is captured in editor history');
assert(deleteHandler.includes('.filter((candidate) => candidate.id !== id)'), 'item deletion removes only the exact selected item');
assert(
  deleteHandler.includes('const requestedScope = floorLayoutScope')
    && deleteHandler.includes('const requestedGeneration = floorLayoutGenerationRef.current')
    && deleteHandler.includes('currentFloorIdRef.current !== targetFloorId'),
  'item deletion cancels a stale confirmation after a user, circle, generation, or floor change',
);
assert(
  officeTab.includes('onFurnitureDelete={editMode ? handleFurnitureDelete : undefined}'),
  'explicit item deletion is passed to the floor only in edit mode',
);
assert(
  officeTab.includes('onFurnitureTransform={editMode ? handleFurnitureTransform : undefined}'),
  'atomic transforms are passed to the floor only in edit mode',
);
assert(
  officeFloor.includes('transformRef.current({ x: pending.x, y: pending.y, itemWidth: pending.w, itemHeight: pending.h });'),
  'corner resizing commits one atomic transform',
);
assert(
  officeFloor.includes('onDelete={onFurnitureDelete ? () => onFurnitureDelete(item.id) : undefined}'),
  'the floor binds deletion to the exact item id',
);
const fileInputHandler = section(officeTab, 'const handleFileInputChange =', '// ── Sticky note save');
assert(
  fileInputHandler.includes('const requestedScope = floorLayoutScope')
    && fileInputHandler.includes('const targetItemId = nftPickerTargetId')
    && fileInputHandler.includes('floorLayoutGenerationRef.current !== requestedGeneration')
    && fileInputHandler.includes('nftPickerTargetId !== targetItemId'),
  'asynchronous image processing cannot write into a later user, circle, floor, or item selection',
);
const presetRefresh = section(officeTab, 'const refreshFloorPresets =', '// Fix stale currentFloorId');
assert(
  presetRefresh.includes('const requestedScope = floorLayoutScope')
    && presetRefresh.includes('const requestedGeneration = floorLayoutGenerationRef.current')
    && presetRefresh.includes('const requestId = ++floorPresetLoadRequestRef.current')
    && presetRefresh.includes('if (!requestIsCurrent()) return')
    && presetRefresh.includes('if (requestIsCurrent()) setFloorPresetsLoading(false)'),
  'a slower preset response from a previous user or circle cannot overwrite the active Office preset list',
);
assert(
  officeFloor.includes("editMode && selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)"),
  'only the selected item consumes keyboard movement keys',
);
assert(
  officeFloor.includes("editMode && selected && (key === 'Delete' || key === 'Backspace')"),
  'only the selected item accepts the destructive keyboard shortcut',
);
assert(
  officeFloor.includes('itemWidth: sizeRef.current.w')
    && officeFloor.includes('itemHeight: sizeRef.current.h')
    && officeFloor.includes('rotation,'),
  'pointer and keyboard movement bounds use the item’s actual size and rotation',
);
assert(
  officeFloor.includes("document.addEventListener('pointercancel'")
    && officeFloor.includes("document.removeEventListener('pointercancel'"),
  'pointer resize/move listeners recover from cancelled gestures',
);
assert(
  officeFloor.includes("pointerEvents={editMode ? 'none' : 'auto'}")
    && officeFloor.includes("importantForAccessibility={editMode ? 'no-hide-descendants' : 'auto'}")
    && officeFloor.includes("Platform.OS === 'web' && editMode ? { 'aria-hidden': true } : {}"),
  'edit mode hides and disables nested widget controls so the selected item is one semantic control',
);
assert(
  officeFloor.includes("contentElement.setAttribute('inert', '')")
    && officeFloor.includes('if (contentElement.contains(document.activeElement)) wrapperElement?.focus?.()')
    && officeFloor.includes("contentElement.removeAttribute('inert')"),
  'web edit mode removes nested widget controls from the sequential focus order and transfers focus safely',
);
assert(
  officeFloor.includes('accessibilityValue={accessibilityValue}')
    && officeFloor.includes('Rotation ${rotation} degrees'),
  'screen readers receive selected item position, size, and rotation',
);
assert(
  officeSections.includes('onResizeSelected(dw, dh)')
    && officeTab.includes('onResizeSelected={(dw: number, dh: number)'),
  'the inspector exposes a non-drag resize alternative',
);
assert(
  officeSections.includes('onLongPress={() => { setRenamingFloorId(floor.id)')
    && officeSections.includes('onRenameFloor(floor.id, renamingFloorName)')
    && officeSections.includes('accessibilityLabel={`Rename floor ${floor.name}`}'),
  'floor names can be edited through both long-press and an explicit accessible action',
);
assert(
  officeSections.includes('accessibilityLabel={title}')
    && officeSections.includes('accessibilityHint={description}')
    && officeSections.includes('accessibilityLabel="Office tools"'),
  'Office tools and every menu action expose stable semantic browser-test and screen-reader targets',
);
assert(
  officeSections.includes('testID="office-workspace-ready"')
    && officeSections.includes('testID="office-layout-save-status"')
    && officeSections.includes('testID={`office-catalog-item-${item.type}`}')
    && officeSections.includes('testID={`office-catalog-favorite-${item.type}`}')
    && officeSections.includes('testID={`office-catalog-scope-${option.value}`}')
    && officeSections.includes('testID="office-editor-open"')
    && officeSections.includes('testID="office-catalog-ready"')
    && officeFloor.includes('testID="office-floor-canvas"')
    && officeFloor.includes('officeAddonType: item.type')
    && officeFloor.includes('officeAddonRotation: rotation'),
  'authenticated Office canaries have stable readiness, catalog, floor, and placed-item selectors',
);
assert(
  officeTab.includes('const [floorLayoutHydratedCircleId, setFloorLayoutHydratedCircleId] = useState<string | null>(null)')
    && officeTab.includes('setFloorLayoutHydratedCircleId(requestedScope)')
    && officeTab.includes('if (!floorLayoutHydrated || !floorsInitializedRef.current) return')
    && officeSections.includes('testID="office-workspace-loading"')
    && officeSections.includes('if (!floorLayoutHydrated)'),
  'Office readiness and persistence stay closed until local and remote layouts finish merging',
);
assert(
  officeSections.includes("if (value.trim()) setActiveCatalogCat('all')"),
  'Office catalog search should search globally instead of inheriting the last category tab',
);
assert(
  officeTab.includes('if (floorsRef.current.length >= 10)')
    && officeTab.includes('setCurrentFloorId(newFloorId)')
    && officeTab.includes('setEditMode(true)')
    && officeTab.includes("setFloorPresetStatus('New floor opened. Choose a room kit or add individual items.')"),
  'new floors respect the saved-layout bound, open immediately, and enter guided editing',
);
assert(
  officeTab.includes('sanitizeOfficeText(newName, 80)')
    && officeTab.includes("setFloorPresetStatus('Floor name cannot be empty.')"),
  'floor rename rejects empty or unsafe names',
);
const officeTabStyles = read('src/screens/circles/tabs/office/officeTabStyles.ts');
const floorControlRail = section(
  officeSections,
  '<View testID="office-workspace-ready"',
  '</ScrollView>',
);
assert(
  officeSections.includes('accessibilityLiveRegion="polite"')
    && officeSections.includes('testID="office-workspace-status"'),
  'floor and room-kit outcomes remain visible outside the presets drawer',
);
assert(officeSections.includes('testID="office-floor-presets-toggle"') && officeSections.includes('accessibilityState={{ expanded: showFloorPresets }}'), 'floor preset disclosure exposes expanded state');
assert(officeSections.includes('testID="office-floor-presets-close"') && officeSections.includes('minWidth: 44, minHeight: 44'), 'floor preset close action has a labelled minimum target');
assert(
  officeSections.includes('floors.length > 1 && renamingFloorId !== floor.id')
    && !officeTabStyles.includes("position: 'absolute',\n    right: 2,\n    top: '50%'"),
  'floor rename and delete controls should remain separate and non-overlapping',
);
assert(
  officeTab.includes('planOfficeRoomKit({')
    && officeTab.includes("scan_limit: 'Open regions may remain")
    && officeTab.includes('gridSize: OFFICE_FLOOR_GRID_SIZE')
    && officeSections.includes("['←', -OFFICE_FLOOR_GRID_SIZE"),
  'room-kit errors are typed and every editor surface shares the canonical 16px grid',
);
for (const [label, start, end] of [
  ['floor switch', 'floorChip: {', 'floorChipActive:'],
  ['floor add and presets', 'floorAddBtn: {', 'floorAddBtnText:'],
  ['floor rename save and cancel', 'floorInlineActionBtn: {', 'floorRenameBtn:'],
  ['floor rename', 'floorRenameBtn: {', 'floorDeleteBtn:'],
  ['floor delete', 'floorDeleteBtn: {', 'floorDeleteBtnText:'],
] as const) {
  const controlStyle = section(officeTabStyles, start, end);
  assert.match(controlStyle, /height:\s*32/, `${label} uses the shared compact 32px rail height`);
}
assert(
  floorControlRail.includes('style={styles.floorInlineActionBtn}')
    && floorControlRail.includes('styles.floorRenameBtn')
    && !floorControlRail.includes('styles.floorChipWithDelete')
    && !floorControlRail.includes('minHeight: 36'),
  'floor actions share compact aligned styles without stale padding or legacy sizing',
);
assert(
  (officeTab.match(/constrainOfficeFurnitureGeometry\(\{/g) || []).length >= 7
    && officeFloor.includes("from '../../../../lib/officeValidation'")
    && (officeFloor.match(/constrainOfficeFurnitureGeometry\(\{/g) || []).length >= 3,
  'hydration, controller mutations, pointer edits, and keyboard edits share rotation-aware floor bounds',
);
assert(
  officeFloor.includes("document.addEventListener('pointercancel', onCancel)")
    && officeFloor.includes("document.addEventListener('pointercancel', onPointerCancel)")
    && (officeFloor.match(/\.pointerId !== pointerId/g) || []).length >= 6
    && (officeFloor.match(/setPointerCapture\(pointerId\)/g) || []).length >= 2
    && (officeFloor.match(/lostpointercapture/g) || []).length >= 4
    && (officeFloor.match(/window\.addEventListener\('blur', onWindowBlur\)/g) || []).length >= 2
    && officeFloor.includes('activePointerCleanupRef.current?.()'),
  'pointer gestures stay bound to their initiating stream and capture loss or window blur restores previews without committing',
);
assert(
  (officeFloor.match(/!e\.isPrimary \|\| \(e\.pointerType === 'mouse' && e\.button !== 0\)/g) || []).length >= 2,
  'move and resize ignore secondary touch streams and non-primary mouse buttons before capture',
);
assert(
  officeFloor.includes('testID={`office-floor-resize-${item.id}-tl`}')
    && officeFloor.includes('testID={`office-floor-resize-${item.id}-br`}'),
  'selected furniture exposes stable resize-handle selectors for real pointer evaluation',
);
assert(
  !officeFloor.includes('ref={deleteButtonRef}')
    && !officeFloor.includes('accessibilityLabel={`Delete ${itemName}`}'),
  'the editable furniture button does not contain a nested delete button; inspector, keyboard, and accessibility actions own deletion',
);
assert(
  officeFloor.includes("'aria-pressed': editMode ? !!selected : undefined"),
  'web furniture buttons expose their edit selection state with valid button semantics',
);
assert(
  officeSections.includes("testID=\"office-compact-editor-panels\"")
    && officeSections.includes("testID: 'office-compact-editor-tray'")
    && officeSections.includes('style: { maxHeight: 180 }')
    && officeSections.includes("current === panel ? null : panel"),
  'compact Catalog, Kits, and Items controls use a bounded, independently collapsible tray so the floor retains space',
);
assert(
  officeSections.includes('testID="office-compact-placed-items"')
    && officeSections.includes('testID={`office-compact-placed-item-${item.id}`}')
    && officeSections.includes('minHeight: 44')
    && officeTab.includes('onSelectFurniture={(id: string) => setSelectedFurnitureId(id)}'),
  'compact users can select tiny or reloaded items through a semantic 44px placed-item control',
);
assert(
  officeTab.includes('!isDesktop && editMode && { minHeight: 360 }')
    && officeTab.includes('{!editMode ? (')
    && officeTab.includes('<OfficeConnectBridgesSection circleId={circleId} />'),
  'compact editing reserves a floor region and temporarily removes unrelated bridge setup panels',
);
assert(
  officeTab.includes('<OfficeRuntimeSection')
    && officeTab.includes('presentationHidden={editMode}')
    && officeSections.includes('presentationHidden = false')
    && officeSections.includes("display: 'none'")
    && officeSections.includes("importantForAccessibility: 'no-hide-descendants'"),
  'edit mode hides the runtime presentation without unmounting terminal state or subscriptions',
);
assert(
  agentPanelShell.includes('primaryTabNavItem: {')
    && agentPanelShell.includes('contextualTabNavItem: {')
    && (agentPanelShell.match(/minHeight: 44/g) || []).length >= 2
    && (agentPanelShell.match(/minWidth: 44/g) || []).length >= 2
    && agentPanelShell.includes('accessibilityRole="tablist"')
    && agentPanelShell.includes('accessibilityRole="tab"')
    && agentPanelShell.includes('accessibilityState={{ selected }}')
    && agentPanelShell.includes("tabIndex: selected ? 0 : -1")
    && agentPanelShell.includes('WAI-ARIA manual-activation model'),
  'compact agent-panel navigation exposes 44px tab targets, selected state, and manual keyboard activation semantics',
);
assert(
  connectAllBridgesPanel.includes('accessibilityState={{ disabled: running, busy: running }}')
    && connectAllBridgesPanel.includes('accessibilityRole="alert"')
    && connectAllBridgesPanel.includes('minHeight: 44'),
  'bridge connection actions expose busy, error, and minimum-target semantics',
);
assert(
  officeBridgeDiagPanel.includes('accessibilityState={{ expanded }}')
    && officeBridgeDiagPanel.includes('width: 44')
    && officeBridgeDiagPanel.includes('height: 44'),
  'bridge diagnostics expose disclosure state and a full-size dismiss target',
);
assert(
  officeBridgeDiagPanel.includes('setModel(buildBridgeDiagPanelModel([], Date.now()))')
    && !officeBridgeDiagPanel.includes('prev ?? buildBridgeDiagPanelModel([], Date.now())'),
  'a failed bridge refresh replaces any stale healthy snapshot with an honest no-results model',
);
assert(
  officeBridgeReadinessStrip.includes('accessibilityRole="alert"')
    && officeBridgeReadinessStrip.includes("accessibilityLiveRegion={snapshot.tone === 'danger' ? 'assertive' : 'polite'}"),
  'bridge readiness warnings are announced without requiring visual inspection',
);
assert(
  officeFloor.includes("item.type === 'whack_a_mole'")
    && officeFloor.includes("item.type === 'farm_plot'")
    && officeFloor.includes("item.type === 'office_pet'"),
  'widgets with their own buttons never receive an outer interactive button wrapper',
);
assert(
  officeFloor.includes('(editMode || wrapperInteractive) ? 30 + layerIndex : 4'),
  'actionable/editable widgets stay above agents while read-mode decorations remain behind them',
);
assert(
  officeTabStyles.includes("agentPosition: { position: 'absolute', zIndex: 7 }")
    && officeTab.includes('agentLayer={agents.map((agent, i) => {')
    && officeFloor.includes('{agentLayer}')
    && officeFloor.indexOf('{agentLayer}') < officeFloor.indexOf('{furniture.map((item, layerIndex) => ('),
  'agent sprites and placed objects share one stacking context with per-item semantic layers',
);
assert(
  officeFloor.includes('<FarmPlotItem item={item} theme={theme} onItemUpdate={onItemUpdate} />'),
  'Farm Plot user actions persist through the canonical furniture update callback',
);
for (const field of ['farmUpgrades', 'farmFertilizerUses', 'farmCropsGrown']) {
  assert(interactiveFurniture.includes(field), `Farm Plot persists ${field}`);
}
assert(
  interactiveFurniture.includes('const bars = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current'),
  'Music Visualizer creates its animation refs through one stable hook',
);

// A saved link is not proof that a third-party integration is connected or
// live. Only OAuth/fetch paths may later promote an item to live.
const serviceSave = section(officeTab, 'const handleServiceSave =', 'const handleServiceOpen =');
for (const fabricatedFlag of [
  /updates\.spotifyConnected\s*=\s*true/,
  /updates\.discordConnected\s*=\s*true/,
  /updates\.twitchLive\s*=\s*true/,
  /updates\.videoCallActive\s*=\s*true/,
  /updates\.figmaBoardConnected\s*=\s*true/,
  /updates\.emailConnected\s*=\s*true/,
  /updates\.dataState\s*=\s*['"]live['"]/,
]) {
  assert.doesNotMatch(serviceSave, fabricatedFlag, `service setup does not fabricate ${fabricatedFlag.source}`);
}
for (const truthfulSetup of [
  'updates.spotifyConnected = false',
  'updates.discordConnected = false',
  'updates.twitchLive = false',
  'updates.videoCallActive = false',
  'updates.figmaBoardConnected = false',
  "safeServiceUrl ? 'local' : 'setup'",
]) {
  assert(serviceSave.includes(truthfulSetup), `service setup preserves ${truthfulSetup}`);
}
assert(!officeTab.includes('SAVE & CONNECT'), 'setup save never promises a connection');
assert(officeTab.includes('SAVE SETUP'), 'setup save uses truthful action copy');
assert(
  serviceSave.includes("setServiceUrlError('Use a complete HTTPS link. Your previous setup has not been changed.')")
    && serviceSave.includes("setServiceUrlError('Enter a valid HTTPS link. Your previous setup has not been changed.')")
    && serviceSave.includes('return;'),
  'invalid service links fail visibly without clearing or overwriting the prior saved setup',
);
assert(
  serviceSave.includes('Math.max(40, Math.min(OFFICE_FLOOR_WIDTH')
    && serviceSave.includes('Math.max(40, Math.min(OFFICE_FLOOR_HEIGHT'),
  'Smart TV setup dimensions are bounded to the Office floor before persistence',
);
assert(
  officeTab.includes('accessibilityViewIsModal')
    && officeTab.includes('accessibilityLabel="Close service setup"')
    && officeTab.includes('accessibilityLabel="Save service setup"')
    && officeTab.includes('accessibilityLiveRegion="assertive"'),
  'service setup exposes modal, close, save, and validation-error semantics',
);
assert(
  officeTab.includes("'🎧 SET UP SPOTIFY'")
    && officeTab.includes("'💬 SET UP DISCORD'")
    && officeTab.includes("'🎨 SET UP FIGMA'")
    && !officeTab.includes("'🎧 CONNECT SPOTIFY'"),
  'link-only widgets describe setup without claiming a provider connection',
);

const furnitureInteraction = section(
  officeTab,
  'const handleFurnitureInteract = useCallback',
  '// ─── Poker player action handler',
);
const buttonPanelInteraction = section(furnitureInteraction, "case 'button_panel':", "case 'alarm_bell':");
const launchPadInteraction = section(furnitureInteraction, "case 'launch_pad':", "case 'jukebox':");
for (const [label, branch] of [
  ['Button Panel', buttonPanelInteraction],
  ['Launch Pad', launchPadInteraction],
] as const) {
  assert(!branch.includes('sendTerminalCommand('), `${label} never dispatches agent work on its first click`);
  assert(branch.includes('setInteractInputId(id)') && branch.includes('setInteractAgentTarget(commandTargetAgents[0]?.id || null)'), `${label} stages a visible exact-agent review`);
}
assert(
  officeTab.includes('buildTerminalNativeCommandTargets({')
    && officeTab.includes('openSwanReadyAgentIds')
    && officeTab.includes('resolveOfficeAgentSessionBinding({')
    && officeTab.includes('commandTargetAgents.find(agent => agent.id === interactAgentTarget)')
    && officeTab.includes('{commandTargetAgents.slice(0, 6).map(a => ('),
  'command reviews use only the canonical Swan target or one exact connected UUID-backed target',
);
for (const type of ['spotify_jukebox', 'discord_hub', 'video_call', 'twitch_stream', 'figma_board'] as const) {
  const branchStart = `case '${type}':`;
  const startIndex = furnitureInteraction.indexOf(branchStart);
  assert(startIndex >= 0, `${type} interaction branch exists`);
  const branch = furnitureInteraction.slice(startIndex, furnitureInteraction.indexOf('\n      case ', startIndex + branchStart.length));
  assert(branch.includes('openFurnitureConfiguration(id)'), `${type} opens setup instead of a vendor homepage or no-op when unconfigured`);
}
assert(
  !furnitureInteraction.includes("item.spotifyUrl || 'https://open.spotify.com'")
    && !furnitureInteraction.includes("item.discordUrl || 'https://discord.com/app'"),
  'unconfigured connected widgets do not pretend the provider homepage is their configured action',
);
const interactSubmit = section(officeTab, 'const handleInteractSubmit = useCallback', '// ─── Floor action handlers');
assert(
  interactSubmit.includes("item.type === 'button_panel'")
    && interactSubmit.includes("item.type === 'launch_pad'")
    && interactSubmit.includes('if (requiresExactAgent && !target)')
    && interactSubmit.includes('params.targetAgentIds = [target.id]')
    && interactSubmit.includes('params.targetAgentName = target.terminalTargetName')
    && interactSubmit.includes('const requestedAuthority = captureOfficeAuthority()')
    && interactSubmit.includes('const result = await sendTerminalCommandExact(')
    && interactSubmit.includes('if (!result.messageId || !result.receipt)')
    && interactSubmit.includes('isTerminalCommandDispatchReceiptCurrent({')
    && interactSubmit.includes('handleCommandSent({'),
  'reviewed furniture commands persist under exact authority, retain failures, and dispatch only one terminal-native target',
);
assert(
  officeTab.includes("fi.type === 'button_panel'")
    && officeTab.includes("fi.type === 'launch_pad'")
    && officeTab.includes("placeholder={isTargetedCommand ? 'Review command…' : 'Task for all agents…'}")
    && officeTab.includes('testID="office-command-review-input"')
    && officeTab.includes('disabled={interactSending || (isTargetedCommand && !interactAgentTarget)}')
    && officeTab.includes('CONNECT AN AGENT BEFORE SENDING'),
  'side-effecting furniture shows its command and agent choice before dispatch',
);
assert(
  !launchPadInteraction.includes("addFloorEffect('rocket')")
    && interactSubmit.includes("item.type === 'launch_pad'")
    && interactSubmit.includes("type: 'rocket'"),
  'Launch Pad success animation appears only after durable persistence',
);
assert(
  officeTerminal.includes('const [sendError, setSendError]')
    && officeTerminal.includes('if (!result.messageId || !result.receipt)')
    && officeTerminal.includes('isTerminalCommandDispatchReceiptCurrent({')
    && officeTerminal.includes('Your draft is still here')
    && officeTerminalRelay.includes("wakeupStatus !== 'ok'")
    && officeTerminalRelay.includes('Command saved, but the real-time delivery wake-up could not be confirmed.'),
  'the full terminal preserves failed drafts and distinguishes durable save from advisory wake-up failure',
);
assert(
  officeTab.includes('const terminalCommandAgents = useMemo<CircleOfficeAgent[]>')
    && officeTab.includes('mergedCircleAgents={terminalCommandAgents}')
    && officeTab.includes("target.id === BLACKSWAN_AGENT_ID")
    && officeTab.includes("status: durable.status === 'active' || durable.status === 'building'"),
  'the full Office terminal receives only visible BlackSwan and terminal-native exact live targets',
);
assert(
  officeTab.indexOf('const terminalDispatchAgents = useMemo<CircleOfficeAgent[]>') < officeTab.indexOf('const handleCommandSent = useCallback')
    && officeTab.split('const dispatchableAgents = terminalDispatchAgentsRef.current;').length - 1 >= 2
    && officeTab.includes("status: durable.status === 'active' || durable.status === 'building'"),
  'direct and Realtime @all dispatch re-read the exact picker authority instead of widening or using a stale captured gateway',
);
assert(
  officeTab.includes('const terminalDispatchAgentsRef = useRef<CircleOfficeAgent[]>(terminalDispatchAgents);')
    && officeTab.includes('const ownedTerminalListenerSignature = ownedTerminalListenerIds.join')
    && officeTab.includes('const dispatchableAgents = terminalDispatchAgentsRef.current;')
    && officeTab.includes('subscribeToTerminalCommandsExact(')
    && officeTab.includes('}, [captureOfficeInvocationExecution, circleId, isOfficeAuthorityCurrent]);')
    && officeTab.includes('}, [circleId, committedAuthAuthority?.generation, committedAuthScopeKey, currentUserId, ownedTerminalListenerSignature]);')
    && !officeTab.includes('}, [circleId, currentUserId, terminalDispatchAgents, resolvedGatewayUrl]);'),
  'the no-backlog command listener stays mounted across heartbeat/session polls while reading current exact dispatch authority',
);
assert(
  officeTerminal.includes('testID="office-terminal-command-input"')
    && officeTerminal.includes('accessibilityLabel="Office terminal command"')
    && officeTerminal.includes('accessibilityLabel="Send Office terminal command"')
    && officeTerminal.includes('accessibilityState={{ disabled: !input.trim() || sending, busy: sending }}'),
  'the full terminal exposes stable, explicitly named command and send controls',
);
assert(
  serviceSave.includes("if (parsed.protocol !== 'https:')")
    && serviceSave.includes('safeServiceUrl = parsed.toString()')
    && officeTab.includes("if (parsed.protocol !== 'https:') return;"),
  'connected-widget links are stored and opened over HTTPS only',
);
assert(
  officeTab.includes('serviceOAuthGenerationRef')
    && officeTab.includes('isServiceOAuthScopeCurrent(scope)')
    && officeTab.includes('oauthMutationTokenRef.current !== null')
    && officeTab.includes('invalidateOAuthProviderFurniture(provider)')
    && officeTab.includes('invalidateServiceWidgetRefreshes()')
    && officeTab.includes('buildOfficeOAuthWidgetReset({')
    && officeTab.includes('const providerChanged = current?.calendarProvider !== serviceCalendarProvider')
    && officeTab.includes('const providerChanged = current?.emailProvider !== serviceEmailProvider')
    && oauthConnect.includes("state: 'unavailable'")
    && oauthConnect.includes("'reconnect_required'")
    && officeTab.includes("oauthStatus.state === 'unavailable'")
    && officeTab.includes("oauthStatus.state === 'reconnect_required'"),
  'OAuth status, reads, provider switches, and mutations are scoped, serialized, provider-wide, and fail unavailable instead of disconnected',
);
assert(
  officeTab.includes('const serviceWidgetRefreshEpochRef = useRef(0);')
    && officeTab.includes('serviceWidgetRefreshEpochRef.current += 1;')
    && officeTab.split('serviceWidgetRefreshEpochRef.current === refreshEpoch').length - 1 >= 2
    && officeTab.includes('}, [circleId, currentFloorId, closeServiceModal, invalidateServiceWidgetRefreshes]);'),
  'calendar and email reads use a monotonic invalidation epoch so cleared per-widget generations cannot create an ABA race',
);
assert(
  officeTab.split("if (item.dataState !== 'live' && item.dataState !== 'stale') {").length - 1 >= 2
    && officeTab.split('openFurnitureConfiguration(id);').length - 1 >= 2,
  'new or failed Calendar and Email widgets open setup instead of issuing doomed provider reads',
);
assert(
  officeTab.includes('patchFurnitureStateDurably(currentFloorId, activeScrabbleItemId')
    && officeTab.includes('patchFurnitureStateDurably(currentFloorId, activePokerItemId')
    && officeTab.includes('patchFurnitureStateDurably(currentFloorId, activePhoneItemId'),
  'duplicate game and message widgets update only the opened instance',
);
assert(
  phoneMessenger.includes('chat.unread ?? 0') && !phoneMessenger.includes('|| data.length'),
  'phone messaging preserves a truthful zero unread count',
);
assert(
  officeTab.includes('onConfigureSelected={() => selectedFurnitureId && openFurnitureConfiguration(selectedFurnitureId)}'),
  'the inspector can configure an already-selected or newly-placed widget',
);
assert(
  officeTab.includes('layoutFingerprint(history.present.floor) === layoutFingerprint(current)'),
  'runtime widget updates do not invalidate reversible layout history',
);
assert(
  officeTab.includes('mergeOfficeEditorFurnitureState(')
    && officeTab.includes('officeEditorItemStateRef')
    && officeTab.includes('Math.max(0, 200 - liveItemIds.length)'),
  'Undo and Redo retain bounded newest item configuration even while an item is absent',
);
assert(
  officeTab.includes('validation.sanitizedLayout.floors as OfficeFloor[]'),
  'the local-storage fast path applies only the canonical sanitized layout',
);

// Placed connected addons expose the canonical state in both visuals and the
// accessibility label, and connected renderers require live evidence.
for (const token of [
  'getOfficeAddonRuntimeState(item, { nowMs: runtimeNow })',
  'showRuntimeState',
  'runtimeState.label.toUpperCase()',
  'runtimeState.state === \'stale\'',
  'setInterval(() => setRuntimeNow(Date.now()), 60_000)',
]) {
  assert(officeFloor.includes(token), `Office floor wires truthful state behavior: ${token}`);
}
for (const flag of ['spotifyConnected', 'discordConnected', 'videoCallActive', 'twitchLive', 'figmaBoardConnected', 'emailConnected']) {
  assert.match(
    interactiveFurniture,
    new RegExp(`getOfficeAddonRuntimeState\\(item,[\\s\\S]{0,90}state === ['"]live['"][\\s\\S]{0,40}item\\.${flag}`),
    `${flag} UI requires fresh live runtime evidence`,
  );
}

// Game modal callbacks must use the scoped durable item helper. Direct mutation
// or raw setState here used to bypass the synchronous save snapshot.
assert.match(
  officeTab,
  /onStateChange=\{\(state\) => \{\s*patchFurnitureStateDurably\(currentFloorId, activeScrabbleItemId/,
  'Scrabble state callback uses scoped durable item replacement',
);
assert.match(
  officeTab,
  /onStateChange=\{\(summary\) => \{\s*patchFurnitureStateDurably\(currentFloorId, activePokerItemId/,
  'Poker state callback uses scoped durable item replacement',
);
assert.doesNotMatch(
  officeTab,
  /\b(?:item|fi|furniture)\.(?:scrabble|poker)[A-Za-z0-9_]*\s*=(?!=)/,
  'game callbacks contain no direct furniture state mutation',
);

// Presence remains intentionally off the primary dashboard, but the reusable
// component must fail visibly and retain accessible controls if reintroduced
// on a secondary surface.
assert(!officeTab.includes('<StatusPicker'), 'primary Office dashboard keeps the presence picker unmounted');
assert(!officeTab.includes('components/office/StatusPicker'), 'primary Office bundle does not load the dormant presence picker');
assert(statusPicker.includes("setSaveState('error')"), 'presence component surfaces load/save failures');
assert(statusPicker.includes('accessibilityLiveRegion="polite"'), 'presence save/error feedback is announced');
assert(statusPicker.includes('accessibilityState={{ expanded }}'), 'presence disclosure exposes its expanded state');
assert(statusPicker.includes('minHeight: 44'), 'presence primary control retains a full touch target');
assert(
  statusPicker.includes('saveStatusRef.current({ ...DEFAULT_STATUS })')
    && statusPicker.includes('saveStatusRef.current = saveStatus'),
  'presence expiry invokes the latest user/circle persistence callback',
);

// The catalog includes dozens of ambient animations. They all share this loop
// helper, so the system preference can stop decorative motion at one boundary.
assert(animationHelpers.includes("'(prefers-reduced-motion: reduce)'"), 'ambient animation loops read the reduced-motion preference');
assert(animationHelpers.includes('if (prefersReducedMotion())'), 'ambient animation loops stop before starting another cycle');

console.log('office-addon-ui-wiring smoketest: all assertions passed');
