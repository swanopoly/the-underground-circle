import React, { useEffect, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BACKPACK_COMPARTMENTS,
  type BackpackCompartmentDefinition,
  type BackpackCompartmentKey,
  type BackpackCompartmentZone,
} from '../../lib/backpackCompartments';

export interface BackpackCompartmentStatus {
  miniStat: string;
  hasActivity: boolean;
}

interface Props {
  onOpenCompartment: (key: BackpackCompartmentKey) => void;
  restoreFocusKey?: BackpackCompartmentKey | null;
  stats?: Partial<Record<BackpackCompartmentKey, BackpackCompartmentStatus>>;
}

type PocketVariant = 'lid' | 'main' | 'front' | 'side' | 'base';
type FocusableNode = { focus?: () => void } | null;

const compartmentsInZone = (zone: BackpackCompartmentZone) =>
  BACKPACK_COMPARTMENTS.filter(compartment => compartment.zone === zone);

const LID_COMPARTMENTS = compartmentsInZone('lid');
const MAIN_COMPARTMENTS = compartmentsInZone('main');
const FRONT_COMPARTMENTS = compartmentsInZone('front');
const LEFT_COMPARTMENTS = compartmentsInZone('side-left');
const RIGHT_COMPARTMENTS = compartmentsInZone('side-right');
const BASE_COMPARTMENTS = compartmentsInZone('base');

export default function InteractiveBackpack2D({
  onOpenCompartment,
  restoreFocusKey = null,
  stats = {},
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const responsiveWidth = measuredWidth || windowWidth;
  const compact = responsiveWidth < 700;
  const tiny = responsiveWidth < 420;
  const pocketRefs = useRef<Partial<Record<BackpackCompartmentKey, FocusableNode>>>({});

  const handleStageLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setMeasuredWidth(currentWidth => currentWidth === nextWidth ? currentWidth : nextWidth);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || !restoreFocusKey) return;

    const frame = requestAnimationFrame(() => {
      pocketRefs.current[restoreFocusKey]?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [restoreFocusKey]);

  const renderPocket = (
    item: BackpackCompartmentDefinition,
    variant: PocketVariant,
  ) => (
    <BackpackPocket
      key={item.key}
      item={item}
      variant={variant}
      compact={compact}
      tiny={tiny}
      status={stats[item.key]}
      onPress={() => onOpenCompartment(item.key)}
      setRef={(node) => {
        pocketRefs.current[item.key] = node;
      }}
    />
  );

  return (
    <View style={styles.section} testID="backpack-overview-ready">
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.title}>Your loadout</Text>
        <View style={styles.countBadge}>
          <View style={styles.countDot} />
          <Text style={styles.countText}>{BACKPACK_COMPARTMENTS.length} workspaces</Text>
        </View>
      </View>

      <View
        style={[styles.stage, compact && styles.stageCompact, tiny && styles.stageTiny]}
        accessibilityLabel="Interactive Backpack dashboard selector"
        onLayout={handleStageLayout}
      >
        <View pointerEvents="none" style={[styles.stageHalo, compact && styles.stageHaloCompact]} />
        <View pointerEvents="none" style={styles.handleBack} />
        <View pointerEvents="none" style={styles.handleOuter}>
          <View style={styles.handleInner} />
        </View>
        <View pointerEvents="none" style={[styles.handleAnchor, styles.handleAnchorLeft]}>
          <View style={styles.hardwareRivet} />
        </View>
        <View pointerEvents="none" style={[styles.handleAnchor, styles.handleAnchorRight]}>
          <View style={styles.hardwareRivet} />
        </View>
        <View pointerEvents="none" style={[styles.shoulderStrap, styles.shoulderStrapLeft]} />
        <View pointerEvents="none" style={[styles.shoulderStrap, styles.shoulderStrapRight]} />
        <View pointerEvents="none" style={styles.floorShadow} />
        <View pointerEvents="none" style={styles.contactShadow} />

        <View style={[styles.packAssembly, compact && styles.packAssemblyCompact]}>
          <View pointerEvents="none" style={[styles.bodyGusset, styles.bodyGussetLeft]} />
          <View pointerEvents="none" style={[styles.bodyGusset, styles.bodyGussetRight]} />
          <View pointerEvents="none" style={styles.packDepth} />

          <View style={[styles.packBody, compact && styles.packBodyCompact, tiny && styles.packBodyTiny]}>
            <View pointerEvents="none" style={styles.canvasTopBand} />
            <View pointerEvents="none" style={styles.canvasWeave} />
            <View pointerEvents="none" style={styles.canvasSideShade} />
            <View pointerEvents="none" style={styles.canvasBottomShade} />
            <View pointerEvents="none" style={styles.canvasHighlight} />
            <View pointerEvents="none" style={styles.innerSeam} />

            <View style={styles.lidShell}>
              <View pointerEvents="none" style={styles.lidDepth} />
              <View style={styles.lidWrap}>
                {LID_COMPARTMENTS.map(item => renderPocket(item, 'lid'))}
              </View>
              <View pointerEvents="none" style={styles.lidHighlight} />
            </View>

            <View pointerEvents="none" style={styles.buckleRail}>
              <View style={styles.buckleStrap}>
                <View style={styles.strapStitch} />
              </View>
              <View style={styles.buckle}>
                <View style={styles.buckleInset} />
              </View>
              <View style={styles.buckleStrap}>
                <View style={styles.strapStitch} />
              </View>
            </View>

            <View style={styles.raisedPocketShell}>
              <View pointerEvents="none" style={styles.mainPocketDepth} />
              <View style={styles.mainPocket}>
                <View pointerEvents="none" style={styles.pocketTopHighlight} />
                <View style={styles.pocketHeadingRow}>
                  <Text style={styles.pocketHeading}>CORE LOADOUT</Text>
                  <View pointerEvents="none" style={styles.zipTrack}>
                    {Array.from({ length: 8 }, (_, index) => (
                      <View key={index} style={styles.zipTooth} />
                    ))}
                  </View>
                </View>
                <View style={styles.mainGrid}>
                  {MAIN_COMPARTMENTS.map(item => renderPocket(item, 'main'))}
                </View>
              </View>
            </View>

            <View style={styles.raisedPocketShell}>
              <View pointerEvents="none" style={styles.frontPocketDepth} />
              <View style={styles.frontPocket}>
                <View pointerEvents="none" style={styles.frontPocketLip} />
                <Text style={styles.pocketHeading}>QUICK ACCESS</Text>
                <View style={[styles.frontGrid, compact && styles.frontGridCompact]}>
                  {FRONT_COMPARTMENTS.map(item => renderPocket(item, 'front'))}
                </View>
              </View>
            </View>

            {compact && (
              <View style={[styles.compactSideRow, tiny && styles.compactSideRowTiny]}>
                {LEFT_COMPARTMENTS.map(item => renderPocket(item, 'side'))}
                {RIGHT_COMPARTMENTS.map(item => renderPocket(item, 'side'))}
              </View>
            )}

            <View style={styles.baseSleeveShell}>
              <View pointerEvents="none" style={styles.baseSleeveDepth} />
              <View style={styles.baseSleeve}>
                <View pointerEvents="none" style={styles.baseSleeveLip} />
                {BASE_COMPARTMENTS.map(item => renderPocket(item, 'base'))}
              </View>
            </View>

            <View pointerEvents="none" style={styles.fieldLabel}>
              <View style={styles.fieldLabelPin} />
              <Text style={styles.fieldLabelText}>UC / FIELD SYSTEM</Text>
              <View style={styles.fieldLabelPin} />
            </View>
          </View>
        </View>

        {!compact && (
          <>
            <View style={[styles.sidePocketWrap, styles.sidePocketLeft]}>
              <View pointerEvents="none" style={[styles.sidePocketDepth, styles.sidePocketDepthLeft]} />
              <View style={styles.sidePocketSurface}>
                <View pointerEvents="none" style={styles.sidePocketLip} />
                {LEFT_COMPARTMENTS.map(item => renderPocket(item, 'side'))}
              </View>
            </View>
            <View style={[styles.sidePocketWrap, styles.sidePocketRight]}>
              <View pointerEvents="none" style={[styles.sidePocketDepth, styles.sidePocketDepthRight]} />
              <View style={styles.sidePocketSurface}>
                <View pointerEvents="none" style={styles.sidePocketLip} />
                {RIGHT_COMPARTMENTS.map(item => renderPocket(item, 'side'))}
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function BackpackPocket({
  item,
  variant,
  compact,
  tiny,
  status,
  onPress,
  setRef,
}: {
  item: BackpackCompartmentDefinition;
  variant: PocketVariant;
  compact: boolean;
  tiny: boolean;
  status?: BackpackCompartmentStatus;
  onPress: () => void;
  setRef: (node: FocusableNode) => void;
}) {
  const statusText = status?.miniStat?.trim() || (status?.hasActivity ? 'Recent activity' : '');
  const desktopSidePocket = variant === 'side' && !compact;

  return (
    <Pressable
      ref={(node) => setRef(node as unknown as FocusableNode)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.label}`}
      accessibilityHint={item.description}
      accessibilityValue={statusText ? { text: statusText } : undefined}
      testID={`backpack-compartment-${item.key}`}
      onPress={onPress}
      style={({ hovered, pressed, focused }: any) => [
        styles.pocket,
        variant === 'lid' && styles.lidPocket,
        variant === 'main' && styles.mainGridPocket,
        variant === 'front' && styles.frontGridPocket,
        variant === 'side' && styles.sidePocket,
        variant === 'base' && styles.basePocket,
        compact && variant === 'main' && styles.mainGridPocketCompact,
        compact && variant === 'side' && styles.sidePocketCompact,
        tiny && variant === 'main' && styles.mainGridPocketTiny,
        tiny && variant === 'front' && styles.frontGridPocketTiny,
        tiny && variant === 'side' && styles.sidePocketTiny,
        hovered && Platform.OS === 'web' ? styles.pocketHovered : null,
        hovered && Platform.OS === 'web' ? { borderColor: `${item.color}8c` } : null,
        focused ? styles.pocketFocused : null,
        focused ? { borderColor: item.color } : null,
        pressed ? styles.pocketPressed : null,
      ]}
    >
      <View
        style={[
          styles.iconPlate,
          variant === 'lid' && styles.iconPlateFeatured,
          { backgroundColor: `${item.color}1f`, borderColor: `${item.color}70` },
        ]}
      >
        <Text style={[styles.iconText, variant === 'lid' && styles.iconTextFeatured, { color: item.color }]}>
          {item.iconLabel}
        </Text>
      </View>

      <View style={[styles.pocketCopy, desktopSidePocket && styles.sidePocketCopy]}>
        <View style={styles.pocketLabelRow}>
          <Text
            style={[
              styles.pocketLabel,
              variant === 'lid' && styles.pocketLabelFeatured,
              desktopSidePocket && styles.sidePocketLabel,
            ]}
          >
            {compact ? item.shortLabel : item.label}
          </Text>
          {status?.hasActivity && (
            <View
              accessible={false}
              style={[styles.activityDot, { backgroundColor: item.color }]}
            />
          )}
        </View>
        {variant === 'lid' && (
          <Text style={styles.featureDescription}>Graph, capture, search, review, and agent-ready briefs.</Text>
        )}
        {statusText ? (
          <Text
            style={[styles.pocketStat, desktopSidePocket && styles.sidePocketStat]}
            numberOfLines={1}
          >
            {statusText}
          </Text>
        ) : null}
      </View>

      <View style={styles.openMark}>
        <Text style={[styles.openMarkText, { color: item.color }]}>›</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sectionHeader: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 14,
  },
  title: {
    color: '#eef2f7',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  countBadge: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: '#2b3441',
    borderRadius: 999,
    backgroundColor: '#111722',
  },
  countDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#4ade80' },
  countText: { color: '#aeb8c8', fontSize: 11, fontWeight: '600' },

  stage: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    position: 'relative',
    paddingTop: 46,
    paddingBottom: 28,
    paddingHorizontal: 24,
  },
  stageCompact: { paddingHorizontal: 0, paddingTop: 40, paddingBottom: 18 },
  stageTiny: { paddingTop: 38 },
  stageHalo: {
    position: 'absolute',
    zIndex: 0,
    top: 74,
    left: '9%',
    right: '9%',
    bottom: 30,
    borderRadius: 96,
    backgroundColor: '#14251c66',
  },
  stageHaloCompact: { left: -5, right: -5, borderRadius: 54 },
  handleBack: {
    position: 'absolute',
    zIndex: 0,
    top: 5,
    left: '50%',
    width: 124,
    height: 72,
    marginLeft: -57,
    borderWidth: 10,
    borderBottomWidth: 0,
    borderColor: '#16221b',
    borderTopLeftRadius: 42,
    borderTopRightRadius: 42,
  },
  handleOuter: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    left: '50%',
    width: 124,
    height: 72,
    marginLeft: -62,
    borderWidth: 9,
    borderBottomWidth: 0,
    borderColor: '#405247',
    borderTopLeftRadius: 42,
    borderTopRightRadius: 42,
    backgroundColor: '#111a15',
  },
  handleInner: {
    flex: 1,
    margin: 6,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#738477',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleAnchor: {
    position: 'absolute',
    zIndex: 4,
    top: 48,
    width: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#53695b',
    borderRadius: 9,
    backgroundColor: '#1b3025',
    ...Platform.select({
      web: { boxShadow: '0 5px 8px rgba(0,0,0,0.34)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.26,
        shadowRadius: 4,
        elevation: 3,
      },
    }),
  },
  handleAnchorLeft: { left: '39%' },
  handleAnchorRight: { right: '39%' },
  hardwareRivet: {
    width: 8,
    height: 8,
    borderWidth: 1,
    borderColor: '#d2c48d',
    borderRadius: 999,
    backgroundColor: '#716a4c',
  },
  shoulderStrap: {
    position: 'absolute',
    zIndex: 0,
    top: 84,
    bottom: 44,
    width: 58,
    borderWidth: 1,
    borderColor: '#303d34',
    borderRadius: 30,
    backgroundColor: '#121b16',
  },
  shoulderStrapLeft: { left: '22%', transform: [{ rotate: '4deg' }] },
  shoulderStrapRight: { right: '22%', transform: [{ rotate: '-4deg' }] },
  floorShadow: {
    position: 'absolute',
    zIndex: 0,
    left: '15%',
    right: '12%',
    bottom: 7,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#00000052',
    transform: [{ scaleX: 1.04 }],
  },
  contactShadow: {
    position: 'absolute',
    zIndex: 0,
    left: '25%',
    right: '21%',
    bottom: 14,
    height: 15,
    borderRadius: 999,
    backgroundColor: '#00000094',
  },
  packAssembly: {
    zIndex: 2,
    width: '76%',
    alignSelf: 'center',
    position: 'relative',
  },
  packAssemblyCompact: { width: '100%' },
  bodyGusset: {
    position: 'absolute',
    zIndex: 0,
    top: 70,
    bottom: 28,
    width: 22,
    borderWidth: 1,
    borderColor: '#35483b',
    backgroundColor: '#17271f',
  },
  bodyGussetLeft: {
    left: -9,
    borderTopLeftRadius: 32,
    borderBottomLeftRadius: 22,
    transform: [{ rotate: '-1.25deg' }],
  },
  bodyGussetRight: {
    right: -12,
    borderTopRightRadius: 32,
    borderBottomRightRadius: 22,
    transform: [{ rotate: '1.25deg' }],
  },
  packDepth: {
    position: 'absolute',
    zIndex: 1,
    top: 10,
    left: 9,
    right: -11,
    bottom: -12,
    borderWidth: 1,
    borderColor: '#304238',
    borderTopLeftRadius: 58,
    borderTopRightRadius: 58,
    borderBottomLeftRadius: 29,
    borderBottomRightRadius: 29,
    backgroundColor: '#0f1c16',
    ...Platform.select({
      web: { boxShadow: '0 26px 48px rgba(0,0,0,0.42)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 8, height: 18 },
        shadowOpacity: 0.34,
        shadowRadius: 20,
        elevation: 12,
      },
    }),
  },
  packBody: {
    zIndex: 2,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    gap: 12,
    padding: 18,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: '#5c7162',
    borderTopLeftRadius: 58,
    borderTopRightRadius: 58,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    backgroundColor: '#284535',
    ...Platform.select({
      web: { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)' } as any,
      default: {},
    }),
  },
  packBodyCompact: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderTopLeftRadius: 42,
    borderTopRightRadius: 42,
  },
  packBodyTiny: { paddingHorizontal: 10, gap: 11 },
  canvasTopBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 118,
    backgroundColor: '#345642',
  },
  canvasWeave: {
    position: 'absolute',
    zIndex: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.22,
    ...Platform.select({
      web: {
        backgroundImage: [
          'repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 4px)',
          'repeating-linear-gradient(0deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0.10) 1px, transparent 1px, transparent 4px)',
        ].join(', '),
      } as any,
      default: {},
    }),
  },
  canvasSideShade: {
    position: 'absolute',
    zIndex: 0,
    top: 38,
    right: 0,
    bottom: 0,
    width: 24,
    backgroundColor: '#07100b30',
  },
  canvasBottomShade: {
    position: 'absolute',
    zIndex: 0,
    left: 0,
    right: 0,
    bottom: 0,
    height: 28,
    backgroundColor: '#07100b38',
  },
  canvasHighlight: {
    position: 'absolute',
    zIndex: 1,
    top: 16,
    left: 8,
    bottom: 35,
    width: 2,
    borderRadius: 2,
    backgroundColor: '#b4c7b54a',
  },
  innerSeam: {
    position: 'absolute',
    top: 9,
    left: 9,
    right: 9,
    bottom: 9,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#8ca08f70',
    borderRadius: 45,
  },
  lidShell: {
    zIndex: 3,
    position: 'relative',
    paddingBottom: 6,
  },
  lidDepth: {
    position: 'absolute',
    zIndex: 0,
    top: 7,
    left: 4,
    right: -3,
    bottom: 0,
    borderWidth: 1,
    borderColor: '#35493d',
    borderRadius: 23,
    backgroundColor: '#0c1712',
  },
  lidWrap: { zIndex: 2 },
  lidHighlight: {
    position: 'absolute',
    zIndex: 3,
    top: 1,
    left: 22,
    right: 22,
    height: 1,
    borderRadius: 1,
    backgroundColor: '#dce8dd26',
  },
  buckleRail: {
    zIndex: 3,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -3,
  },
  buckleStrap: {
    width: 38,
    height: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#37423a',
    borderRadius: 4,
    backgroundColor: '#0d1410',
  },
  strapStitch: { width: 26, height: 1, backgroundColor: '#7d897f72' },
  buckle: {
    width: 34,
    height: 22,
    padding: 3,
    borderWidth: 1,
    borderColor: '#b9a66f',
    borderRadius: 6,
    backgroundColor: '#625a3d',
    ...Platform.select({ web: { boxShadow: '0 3px 6px rgba(0,0,0,0.35)' } as any, default: {} }),
  },
  buckleInset: { flex: 1, borderWidth: 1, borderColor: '#d5c58c', borderRadius: 3 },
  raisedPocketShell: {
    zIndex: 2,
    position: 'relative',
    paddingBottom: 5,
  },
  mainPocketDepth: {
    position: 'absolute',
    zIndex: 0,
    top: 7,
    left: 4,
    right: -3,
    bottom: 0,
    borderWidth: 1,
    borderColor: '#304439',
    borderRadius: 19,
    backgroundColor: '#0f1d17',
  },
  frontPocketDepth: {
    position: 'absolute',
    zIndex: 0,
    top: 7,
    left: 4,
    right: -3,
    bottom: 0,
    borderWidth: 1,
    borderColor: '#374c3e',
    borderBottomLeftRadius: 23,
    borderBottomRightRadius: 23,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    backgroundColor: '#13231b',
  },
  mainPocket: {
    zIndex: 1,
    position: 'relative',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#5d7463',
    borderRadius: 18,
    backgroundColor: '#1d3328',
    ...Platform.select({
      web: { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' } as any,
      default: {},
    }),
  },
  pocketTopHighlight: {
    position: 'absolute',
    top: 1,
    left: 18,
    right: 18,
    height: 1,
    borderRadius: 1,
    backgroundColor: '#dce8dd1f',
  },
  pocketHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pocketHeading: { color: '#9eac9f', fontSize: 9, fontWeight: '700', letterSpacing: 0.9 },
  zipTrack: { flexDirection: 'row', gap: 3 },
  zipTooth: { width: 5, height: 2, borderRadius: 1, backgroundColor: '#a89e76' },
  mainGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frontPocket: {
    zIndex: 1,
    position: 'relative',
    gap: 9,
    padding: 12,
    paddingTop: 17,
    borderWidth: 1,
    borderColor: '#617b67',
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#2b4a39',
    ...Platform.select({
      web: { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)' } as any,
      default: {},
    }),
  },
  frontPocketLip: {
    position: 'absolute',
    top: 6,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 2,
    backgroundColor: '#93a493a8',
  },
  frontGrid: { flexDirection: 'row', gap: 8 },
  frontGridCompact: { flexWrap: 'wrap' },
  compactSideRow: { zIndex: 3, flexDirection: 'row', gap: 8 },
  compactSideRowTiny: { flexWrap: 'wrap' },
  baseSleeveShell: {
    zIndex: 3,
    position: 'relative',
    paddingBottom: 4,
  },
  baseSleeveDepth: {
    position: 'absolute',
    zIndex: 0,
    top: 5,
    left: 4,
    right: -3,
    bottom: 0,
    borderWidth: 1,
    borderColor: '#2e4035',
    borderRadius: 15,
    backgroundColor: '#0b1510',
  },
  baseSleeve: {
    zIndex: 1,
    position: 'relative',
    padding: 7,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: '#556c5c',
    borderRadius: 14,
    backgroundColor: '#172a20',
  },
  baseSleeveLip: {
    position: 'absolute',
    top: 4,
    left: 16,
    right: 16,
    height: 1,
    backgroundColor: '#81938380',
  },
  fieldLabel: {
    zIndex: 3,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#687b6d',
    borderRadius: 6,
    backgroundColor: '#17231c',
  },
  fieldLabelPin: { width: 3, height: 3, borderRadius: 999, backgroundColor: '#a89f79' },
  fieldLabelText: { color: '#95a398', fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  sidePocketWrap: {
    position: 'absolute',
    zIndex: 4,
    top: '40%',
    width: '17%',
  },
  sidePocketLeft: { left: 0, transform: [{ rotate: '-1.75deg' }] },
  sidePocketRight: { right: 0, transform: [{ rotate: '1.75deg' }] },
  sidePocketDepth: {
    position: 'absolute',
    zIndex: 0,
    top: 7,
    bottom: -8,
    borderWidth: 1,
    borderColor: '#2d4035',
    borderRadius: 19,
    backgroundColor: '#0d1812',
  },
  sidePocketDepthLeft: { left: -6, right: 5 },
  sidePocketDepthRight: { left: 5, right: -6 },
  sidePocketSurface: {
    zIndex: 1,
    position: 'relative',
    padding: 5,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: '#566e5d',
    borderRadius: 18,
    backgroundColor: '#223b2e',
    ...Platform.select({
      web: { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)' } as any,
      default: {},
    }),
  },
  sidePocketLip: {
    position: 'absolute',
    top: 5,
    left: 15,
    right: 15,
    height: 1,
    backgroundColor: '#82958588',
  },

  pocket: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 9,
    borderWidth: 1,
    borderColor: '#3d5044',
    borderRadius: 12,
    backgroundColor: '#101b16f2',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
    } as any : {}),
  },
  lidPocket: {
    minHeight: 106,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: '#172820f5',
  },
  mainGridPocket: { flexBasis: '31%', flexGrow: 1, minWidth: 128, minHeight: 66 },
  mainGridPocketCompact: { flexBasis: '46%', minWidth: 112, minHeight: 68 },
  mainGridPocketTiny: { width: '100%', flexBasis: 'auto', flexGrow: 0, flexShrink: 0, minWidth: 0 },
  frontGridPocket: { flex: 1, minWidth: 100, minHeight: 66 },
  frontGridPocketTiny: { width: '100%', flex: 0, flexBasis: 'auto', minWidth: 0 },
  sidePocket: {
    minHeight: 132,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 7,
  },
  sidePocketCompact: { flex: 1, minHeight: 74, flexDirection: 'row', justifyContent: 'flex-start' },
  sidePocketTiny: { width: '100%', flex: 0, flexBasis: 'auto', minWidth: 0 },
  basePocket: { minHeight: 66, backgroundColor: '#0e1914f5' },
  pocketHovered: {
    backgroundColor: '#192820',
    ...Platform.select({ web: { boxShadow: '0 4px 12px rgba(0,0,0,0.26)' } as any, default: {} }),
  },
  pocketFocused: {
    borderColor: '#f8fafc',
    ...Platform.select({ web: { outlineStyle: 'none', boxShadow: '0 0 0 3px rgba(167,139,250,0.42)' } as any, default: {} }),
  },
  pocketPressed: { opacity: 0.82, backgroundColor: '#1d2d25' },
  iconPlate: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 9,
  },
  iconPlateFeatured: { width: 44, height: 44, borderRadius: 12 },
  iconText: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
  iconTextFeatured: { fontSize: 12, lineHeight: 16 },
  pocketCopy: { flex: 1, minWidth: 0 },
  sidePocketCopy: { flexGrow: 0, width: '100%', alignItems: 'center' },
  pocketLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pocketLabel: { flexShrink: 1, color: '#e5ebe7', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  pocketLabelFeatured: { fontSize: 15, lineHeight: 20 },
  sidePocketLabel: { textAlign: 'center' },
  featureDescription: { color: '#9ba8a0', fontSize: 10, lineHeight: 15, marginTop: 3 },
  pocketStat: { color: '#91a097', fontSize: 9, lineHeight: 13, marginTop: 3 },
  sidePocketStat: { width: '100%', textAlign: 'center' },
  activityDot: { width: 6, height: 6, flexShrink: 0, borderRadius: 999 },
  openMark: {
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#38473e',
    borderRadius: 999,
    backgroundColor: '#0b120f',
  },
  openMarkText: { fontSize: 17, lineHeight: 18, fontWeight: '600', marginTop: -1 },
});
