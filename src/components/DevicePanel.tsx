/**
 * DevicePanel — Device discovery & control panel
 *
 * Shows local bridge connection status, discovers printers / serial ports /
 * 3D printers / USB / network devices, and exposes quick-action buttons
 * (print test page, send G-code, ping, etc.) for each device.
 *
 * Requires a companion bridge server running locally.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  checkBridgeHealth,
  discoverAllDevices,
  detect3DPrinters,
  scanNetwork,
  printText,
  sendGCode,
  sendToSerial,
  type DeviceInventory,
  type PrinterService3D,
  type NetworkDevice,
} from '../lib/deviceManager';
import {
  PIXEL_COLORS,
  GRID,
  PX,
  pixelCard,
  pixelInset,
} from '../lib/pixelDesign';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCENT = PIXEL_COLORS.cyan;
const ACCENT_GREEN = PIXEL_COLORS.green;
const ACCENT_RED = PIXEL_COLORS.red;
const MONO = Platform.OS === 'web' ? 'monospace' : 'Courier';

type GCodeTarget = 'octoprint' | 'klipper' | 'serial';

const GCODE_TARGETS: { key: GCodeTarget; label: string }[] = [
  { key: 'serial', label: 'SERIAL' },
  { key: 'octoprint', label: 'OCTOPRINT' },
  { key: 'klipper', label: 'KLIPPER' },
];

const GCODE_PRESETS = [
  { label: 'Home All', cmd: 'G28' },
  { label: 'Home X/Y', cmd: 'G28 X Y' },
  { label: 'Bed Temp 60', cmd: 'M140 S60' },
  { label: 'Hotend 200', cmd: 'M104 S200' },
  { label: 'Motors Off', cmd: 'M84' },
  { label: 'Status', cmd: 'M115' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DevicePanel({ circleId }: Props) {
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [printers3D, setPrinters3D] = useState<PrinterService3D[]>([]);
  const [networkDevices, setNetworkDevices] = useState<NetworkDevice[]>([]);
  const [gcodeInput, setGcodeInput] = useState('');
  const [gcodeTarget, setGcodeTarget] = useState<GCodeTarget>('serial');
  const [actionFeedback, setActionFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState<'success' | 'error' | 'info'>('info');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // ── Feedback helper ───────────────────────────────────────────────────────

  const showFeedback = useCallback(
    (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
      setActionFeedback(msg);
      setFeedbackType(type);
      setTimeout(() => setActionFeedback(''), 4000);
    },
    [],
  );

  // ── Bridge health ─────────────────────────────────────────────────────────

  const checkBridge = useCallback(async () => {
    try {
      const online = await checkBridgeHealth();
      setBridgeOnline(online);
      if (online) {
        scanDevices();
      }
    } catch {
      setBridgeOnline(false);
    }
  }, []);

  useEffect(() => {
    checkBridge();
  }, [checkBridge]);

  // ── Device scanning ───────────────────────────────────────────────────────

  const scanDevices = useCallback(async () => {
    setScanning(true);
    showFeedback('Scanning devices...', 'info');
    try {
      const [inv, printers, network] = await Promise.all([
        discoverAllDevices(),
        detect3DPrinters().catch(() => [] as PrinterService3D[]),
        scanNetwork().catch(() => [] as NetworkDevice[]),
      ]);
      setInventory(inv);
      setPrinters3D(printers);
      setNetworkDevices(network);

      const total =
        (inv?.printers?.length ?? 0) +
        (inv?.serialPorts?.length ?? 0) +
        (inv?.usbDevices?.length ?? 0) +
        printers.length +
        network.length;
      showFeedback(`Scan complete — ${total} device${total !== 1 ? 's' : ''} found`, 'success');

      // Auto-expand first non-empty section
      if (inv?.printers?.length) setExpandedSection('printers');
      else if (printers.length) setExpandedSection('3d');
      else if (inv?.serialPorts?.length) setExpandedSection('serial');
      else if (inv?.usbDevices?.length) setExpandedSection('usb');
      else if (network.length) setExpandedSection('network');
    } catch (err: any) {
      showFeedback(`Scan failed: ${err?.message ?? 'Unknown error'}`, 'error');
    } finally {
      setScanning(false);
    }
  }, [showFeedback]);

  // ── Quick actions ─────────────────────────────────────────────────────────

  const handlePrintTest = useCallback(
    async (printerName?: string) => {
      try {
        showFeedback(`Printing test page${printerName ? ` on ${printerName}` : ''}...`, 'info');
        await printText(
          'Test page from The Underground Circle\n' +
            `Circle: ${circleId}\n` +
            `Date: ${new Date().toISOString()}\n` +
            '─'.repeat(40) + '\n' +
            'If you can read this, your printer is connected.\n',
          { printer: printerName },
        );
        showFeedback('Test page sent successfully', 'success');
      } catch (err: any) {
        showFeedback(`Print failed: ${err?.message ?? 'Unknown error'}`, 'error');
      }
    },
    [circleId, showFeedback],
  );

  const handleSendGCode = useCallback(async () => {
    const cmd = gcodeInput.trim();
    if (!cmd) {
      showFeedback('Enter a G-code command first', 'error');
      return;
    }
    try {
      showFeedback(`Sending ${cmd} via ${gcodeTarget}...`, 'info');
      await sendGCode(gcodeTarget, cmd);
      showFeedback(`G-code sent: ${cmd}`, 'success');
      setGcodeInput('');
    } catch (err: any) {
      showFeedback(`G-code failed: ${err?.message ?? 'Unknown error'}`, 'error');
    }
  }, [gcodeInput, gcodeTarget, showFeedback]);

  const handleSerialSend = useCallback(
    async (port: string) => {
      try {
        showFeedback(`Pinging ${port}...`, 'info');
        await sendToSerial(port, 'PING\n');
        showFeedback(`Sent PING to ${port}`, 'success');
      } catch (err: any) {
        showFeedback(`Serial send failed: ${err?.message ?? 'Unknown error'}`, 'error');
      }
    },
    [showFeedback],
  );

  // ── Section toggle ────────────────────────────────────────────────────────

  const toggleSection = useCallback(
    (key: string) => {
      setExpandedSection((prev) => (prev === key ? null : key));
    },
    [],
  );

  // ── Feedback color ────────────────────────────────────────────────────────

  const feedbackColor =
    feedbackType === 'success'
      ? ACCENT_GREEN
      : feedbackType === 'error'
        ? ACCENT_RED
        : ACCENT;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: bridgeOnline ? ACCENT_GREEN : ACCENT_RED },
            ]}
          />
          <Text style={styles.headerTitle}>DEVICE MANAGER</Text>
          <Text
            style={[
              styles.headerStatus,
              { color: bridgeOnline ? ACCENT_GREEN : ACCENT_RED },
            ]}
          >
            {bridgeOnline ? 'BRIDGE ONLINE' : 'BRIDGE OFFLINE'}
          </Text>
        </View>
        <Pressable
          onPress={bridgeOnline ? scanDevices : checkBridge}
          disabled={scanning}
          style={({ pressed }) => [
            styles.scanButton,
            scanning && styles.scanButtonDisabled,
            pressed && styles.scanButtonPressed,
          ]}
        >
          {scanning ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <Text style={styles.scanButtonText}>
              {bridgeOnline ? '\u27F3 SCAN' : '\u27F3 RETRY'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* ── Feedback Banner ───────────────────────────────────────────────── */}
      {actionFeedback !== '' && (
        <View style={[styles.feedbackBanner, { borderColor: feedbackColor + '60' }]}>
          <View style={[styles.feedbackDot, { backgroundColor: feedbackColor }]} />
          <Text style={[styles.feedbackText, { color: feedbackColor }]}>
            {actionFeedback}
          </Text>
        </View>
      )}

      {/* ── Bridge Offline ────────────────────────────────────────────────── */}
      {!bridgeOnline && (
        <View style={styles.offlineCard}>
          <Text style={styles.offlineTitle}>BRIDGE NOT DETECTED</Text>
          <Text style={styles.offlineBody}>
            The device bridge connects this app to local hardware.{'\n'}
            Start the bridge server on your machine:
          </Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText}>$ npx @tuc/device-bridge start</Text>
          </View>
          <Text style={styles.offlineBody}>
            The bridge listens on localhost:7531 and discovers{'\n'}
            printers, serial ports, USB devices, and network hosts.
          </Text>
          <Pressable
            onPress={checkBridge}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
          >
            <Text style={styles.retryButtonText}>CHECK CONNECTION</Text>
          </Pressable>
        </View>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {bridgeOnline && scanning && !inventory && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Discovering devices...</Text>
        </View>
      )}

      {/* ── Device Sections ───────────────────────────────────────────────── */}
      {inventory && (
        <>
          {/* Printers */}
          <DeviceSection
            title="PRINTERS"
            icon={'\uD83D\uDDA8'}
            count={inventory.printers?.length ?? 0}
            expanded={expandedSection === 'printers'}
            onToggle={() => toggleSection('printers')}
            accentColor="#22c55e"
          >
            {(inventory.printers ?? []).length === 0 ? (
              <Text style={styles.emptyText}>No printers detected</Text>
            ) : (
              (inventory.printers ?? []).map((p: any, i: number) => (
                <View key={`printer-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{p.name ?? p.id ?? `Printer ${i + 1}`}</Text>
                    <Text style={styles.deviceMeta}>
                      {p.driver ?? p.type ?? 'Unknown driver'}
                      {p.status ? ` \u2022 ${p.status}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handlePrintTest(p.name ?? p.id)}
                    style={({ pressed }) => [
                      styles.actionButton,
                      pressed && styles.actionButtonPressed,
                    ]}
                  >
                    <Text style={styles.actionButtonText}>PRINT TEST</Text>
                  </Pressable>
                </View>
              ))
            )}
          </DeviceSection>

          {/* 3D Printers */}
          <DeviceSection
            title="3D PRINTERS"
            icon={'\uD83D\uDD27'}
            count={printers3D.length}
            expanded={expandedSection === '3d'}
            onToggle={() => toggleSection('3d')}
            accentColor="#8b5cf6"
          >
            {printers3D.length === 0 ? (
              <Text style={styles.emptyText}>
                No 3D printer services found (OctoPrint / Klipper)
              </Text>
            ) : (
              printers3D.map((s, i) => (
                <View key={`3d-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{s.type.toUpperCase()} — Service ${i + 1}</Text>
                    <Text style={styles.deviceMeta}>
                      {s.type} {'\u2022'} {s.url ?? s.port ?? 'No address'}
                      {s.version ? ` \u2022 v${s.version}` : ''}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          s.status === 'operational' || s.status === 'ready'
                            ? ACCENT_GREEN + '20'
                            : s.status === 'printing'
                              ? ACCENT + '20'
                              : ACCENT_RED + '20',
                        borderColor:
                          s.status === 'operational' || s.status === 'ready'
                            ? ACCENT_GREEN + '40'
                            : s.status === 'printing'
                              ? ACCENT + '40'
                              : ACCENT_RED + '40',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color:
                            s.status === 'operational' || s.status === 'ready'
                              ? ACCENT_GREEN
                              : s.status === 'printing'
                                ? ACCENT
                                : ACCENT_RED,
                        },
                      ]}
                    >
                      {s.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              ))
            )}

            {/* G-code input */}
            <View style={styles.gcodeDivider} />
            <Text style={styles.gcodeLabel}>G-CODE TERMINAL</Text>

            {/* Target selector */}
            <View style={styles.gcodeTargetRow}>
              {GCODE_TARGETS.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setGcodeTarget(t.key)}
                  style={[
                    styles.gcodeTargetButton,
                    gcodeTarget === t.key && styles.gcodeTargetActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.gcodeTargetText,
                      gcodeTarget === t.key && styles.gcodeTargetTextActive,
                    ]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Presets */}
            <View style={styles.gcodePresetsRow}>
              {GCODE_PRESETS.map((p) => (
                <Pressable
                  key={p.cmd}
                  onPress={() => setGcodeInput(p.cmd)}
                  style={({ pressed }) => [
                    styles.presetChip,
                    pressed && styles.presetChipPressed,
                  ]}
                >
                  <Text style={styles.presetChipText}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Input bar */}
            <View style={styles.gcodeInputRow}>
              <Text style={styles.gcodePrompt}>&gt;</Text>
              <TextInput
                style={styles.gcodeInput}
                value={gcodeInput}
                onChangeText={setGcodeInput}
                placeholder="G28, M104 S200, ..."
                placeholderTextColor={PIXEL_COLORS.text3}
                autoCapitalize="characters"
                returnKeyType="send"
                onSubmitEditing={handleSendGCode}
              />
              <Pressable
                onPress={handleSendGCode}
                disabled={!gcodeInput.trim()}
                style={({ pressed }) => [
                  styles.gcodeSendButton,
                  !gcodeInput.trim() && styles.gcodeSendDisabled,
                  pressed && gcodeInput.trim() ? styles.gcodeSendPressed : undefined,
                ]}
              >
                <Text
                  style={[
                    styles.gcodeSendText,
                    !gcodeInput.trim() && { color: PIXEL_COLORS.text3 },
                  ]}
                >
                  SEND
                </Text>
              </Pressable>
            </View>
          </DeviceSection>

          {/* Serial Ports */}
          <DeviceSection
            title="SERIAL PORTS"
            icon={'\u26A1'}
            count={inventory.serialPorts?.length ?? 0}
            expanded={expandedSection === 'serial'}
            onToggle={() => toggleSection('serial')}
            accentColor="#f59e0b"
          >
            {(inventory.serialPorts ?? []).length === 0 ? (
              <Text style={styles.emptyText}>No serial ports detected</Text>
            ) : (
              (inventory.serialPorts ?? []).map((p: any, i: number) => (
                <View key={`serial-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>
                      {p.path ?? p.port ?? `Port ${i + 1}`}
                    </Text>
                    <Text style={styles.deviceMeta}>
                      {p.manufacturer ?? 'Unknown manufacturer'}
                      {p.vendorId ? ` \u2022 VID:${p.vendorId}` : ''}
                      {p.productId ? ` PID:${p.productId}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleSerialSend(p.path ?? p.port)}
                    style={({ pressed }) => [
                      styles.actionButton,
                      pressed && styles.actionButtonPressed,
                    ]}
                  >
                    <Text style={styles.actionButtonText}>PING</Text>
                  </Pressable>
                </View>
              ))
            )}
          </DeviceSection>

          {/* USB Devices */}
          <DeviceSection
            title="USB DEVICES"
            icon={'\uD83D\uDD0C'}
            count={inventory.usbDevices?.length ?? 0}
            expanded={expandedSection === 'usb'}
            onToggle={() => toggleSection('usb')}
            accentColor="#ec4899"
          >
            {(inventory.usbDevices ?? []).length === 0 ? (
              <Text style={styles.emptyText}>No USB devices detected</Text>
            ) : (
              (inventory.usbDevices ?? []).map((u: any, i: number) => (
                <View key={`usb-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>
                      {u.product ?? u.description ?? `USB Device ${i + 1}`}
                    </Text>
                    <Text style={styles.deviceMeta}>
                      {u.manufacturer ?? 'Unknown'}
                      {u.vendorId ? ` \u2022 VID:${u.vendorId}` : ''}
                      {u.productId ? ` PID:${u.productId}` : ''}
                      {u.serialNumber ? ` \u2022 S/N:${u.serialNumber}` : ''}
                    </Text>
                  </View>
                  <View style={styles.usbClassBadge}>
                    <Text style={styles.usbClassText}>
                      {u.deviceClass ?? u.class ?? 'DEV'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </DeviceSection>

          {/* Network */}
          <DeviceSection
            title="NETWORK"
            icon={'\uD83C\uDF10'}
            count={networkDevices.length}
            expanded={expandedSection === 'network'}
            onToggle={() => toggleSection('network')}
            accentColor="#3b82f6"
          >
            {networkDevices.length === 0 ? (
              <Text style={styles.emptyText}>No network devices found</Text>
            ) : (
              networkDevices.map((d, i) => (
                <View key={`net-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>
                      {d.hostname ?? d.ip ?? `Host ${i + 1}`}
                    </Text>
                    <Text style={styles.deviceMeta}>
                      {d.ip ?? 'No IP'}
                      {d.mac ? ` \u2022 ${d.mac}` : ''}
                    </Text>
                    {d.services && d.services.length > 0 && (
                      <Text style={styles.devicePorts}>
                        Services: {d.services.join(', ')}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: ACCENT_GREEN + '20',
                        borderColor: ACCENT_GREEN + '40',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        { color: ACCENT_GREEN },
                      ]}
                    >
                      FOUND
                    </Text>
                  </View>
                </View>
              ))
            )}
          </DeviceSection>
        </>
      )}

      {/* ── Quick Connect Tips ────────────────────────────────────────────── */}
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>SUPPORTED DEVICES</Text>
        <View style={styles.tipRow}>
          <Text style={styles.tipIcon}>{'\uD83D\uDDA8'}</Text>
          <Text style={styles.tipText}>
            CUPS / IPP / Windows printers (test pages, raw text)
          </Text>
        </View>
        <View style={styles.tipRow}>
          <Text style={styles.tipIcon}>{'\uD83D\uDD27'}</Text>
          <Text style={styles.tipText}>
            OctoPrint / Klipper / Moonraker (G-code, status, temp)
          </Text>
        </View>
        <View style={styles.tipRow}>
          <Text style={styles.tipIcon}>{'\u26A1'}</Text>
          <Text style={styles.tipText}>
            Serial / COM ports (Arduino, CNC, embedded boards)
          </Text>
        </View>
        <View style={styles.tipRow}>
          <Text style={styles.tipIcon}>{'\uD83D\uDD0C'}</Text>
          <Text style={styles.tipText}>
            USB HID, storage, and vendor-specific devices
          </Text>
        </View>
        <View style={styles.tipRow}>
          <Text style={styles.tipIcon}>{'\uD83C\uDF10'}</Text>
          <Text style={styles.tipText}>
            LAN scan: hostname, MAC, open ports, mDNS services
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── DeviceSection — Collapsible card ────────────────────────────────────────

interface DeviceSectionProps {
  title: string;
  icon: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  accentColor: string;
  children: React.ReactNode;
}

function DeviceSection({
  title,
  icon,
  count,
  expanded,
  onToggle,
  accentColor,
  children,
}: DeviceSectionProps) {
  return (
    <View style={[styles.sectionCard, { borderColor: expanded ? accentColor + '40' : PIXEL_COLORS.border1 }]}>
      <Pressable onPress={onToggle} style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconBox, { backgroundColor: accentColor + '18', borderColor: accentColor + '30' }]}>
            <Text style={[styles.sectionIconText, { color: accentColor }]}>{icon}</Text>
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={[styles.countBadge, { backgroundColor: accentColor + '20', borderColor: accentColor + '40' }]}>
            <Text style={[styles.countBadgeText, { color: accentColor }]}>{count}</Text>
          </View>
        </View>
        <Text style={[styles.chevron, { color: accentColor }]}>
          {expanded ? '\u25B4' : '\u25BE'}
        </Text>
      </Pressable>
      {expanded && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PIXEL_COLORS.bg1,
  },
  content: {
    padding: GRID.md,
    paddingBottom: GRID.xxl,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: GRID.md,
    paddingBottom: GRID.sm,
    borderBottomWidth: 2,
    borderBottomColor: PIXEL_COLORS.border1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 1,
  },
  headerTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 14,
    fontWeight: '900',
    fontFamily: MONO,
    letterSpacing: 2,
  },
  headerStatus: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // Scan button
  scanButton: {
    backgroundColor: PIXEL_COLORS.bg3,
    borderWidth: 2,
    borderTopColor: PIXEL_COLORS.border2,
    borderLeftColor: PIXEL_COLORS.border2,
    borderRightColor: PIXEL_COLORS.bg0,
    borderBottomColor: PIXEL_COLORS.bg0,
    borderRadius: 0,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.xs,
    minWidth: 80,
    alignItems: 'center',
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanButtonPressed: {
    borderTopColor: PIXEL_COLORS.bg0,
    borderLeftColor: PIXEL_COLORS.bg0,
    borderRightColor: PIXEL_COLORS.border2,
    borderBottomColor: PIXEL_COLORS.border2,
  },
  scanButtonText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // Feedback banner
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIXEL_COLORS.bg0,
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    marginBottom: GRID.md,
    gap: GRID.sm,
  },
  feedbackDot: {
    width: 6,
    height: 6,
    borderRadius: 1,
  },
  feedbackText: {
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Offline card
  offlineCard: {
    ...pixelCard,
    padding: GRID.lg,
    marginBottom: GRID.md,
    alignItems: 'center',
  },
  offlineTitle: {
    color: ACCENT_RED,
    fontSize: 13,
    fontWeight: '900',
    fontFamily: MONO,
    letterSpacing: 2,
    marginBottom: GRID.sm,
  },
  offlineBody: {
    color: PIXEL_COLORS.text2,
    fontSize: 11,
    fontFamily: MONO,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: GRID.sm,
  },
  codeBlock: {
    ...pixelInset,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    marginVertical: GRID.sm,
    alignSelf: 'stretch',
  },
  codeText: {
    color: ACCENT_GREEN,
    fontSize: 12,
    fontFamily: MONO,
    fontWeight: '600',
  },
  retryButton: {
    backgroundColor: PIXEL_COLORS.bg3,
    borderWidth: 2,
    borderTopColor: PIXEL_COLORS.border2,
    borderLeftColor: PIXEL_COLORS.border2,
    borderRightColor: PIXEL_COLORS.bg0,
    borderBottomColor: PIXEL_COLORS.bg0,
    borderRadius: 0,
    paddingHorizontal: GRID.lg,
    paddingVertical: GRID.sm,
    marginTop: GRID.md,
  },
  retryButtonPressed: {
    borderTopColor: PIXEL_COLORS.bg0,
    borderLeftColor: PIXEL_COLORS.bg0,
    borderRightColor: PIXEL_COLORS.border2,
    borderBottomColor: PIXEL_COLORS.border2,
  },
  retryButtonText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // Loading
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: GRID.xxl,
    gap: GRID.md,
  },
  loadingText: {
    color: PIXEL_COLORS.text2,
    fontSize: 11,
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // Section card (collapsible)
  sectionCard: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 2,
    borderRadius: 2,
    marginBottom: GRID.sm,
    ...(Platform.OS === 'web'
      ? { boxShadow: `${PX}px ${PX}px 0px ${PIXEL_COLORS.bg0}` }
      : {
          shadowColor: PIXEL_COLORS.bg0,
          shadowOffset: { width: PX, height: PX },
          shadowOpacity: 1,
          shadowRadius: 0,
          elevation: 4,
        }),
  } as any,
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm + 2,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
  },
  sectionIconBox: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionIconText: {
    fontSize: 14,
  },
  sectionTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1.5,
  },
  countBadge: {
    borderWidth: 1,
    borderRadius: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 22,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
  },
  chevron: {
    fontSize: 14,
    fontWeight: '800',
  },
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: PIXEL_COLORS.border0,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
  },

  // Device row
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: GRID.sm,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
  },
  deviceInfo: {
    flex: 1,
    marginRight: GRID.sm,
  },
  deviceName: {
    color: PIXEL_COLORS.text0,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
  },
  deviceMeta: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontFamily: MONO,
    marginTop: 2,
  },
  devicePorts: {
    color: PIXEL_COLORS.cyan,
    fontSize: 10,
    fontFamily: MONO,
    marginTop: 2,
  },
  emptyText: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
    fontFamily: MONO,
    fontStyle: 'italic',
    paddingVertical: GRID.sm,
  },

  // Action button (small)
  actionButton: {
    backgroundColor: PIXEL_COLORS.bg0,
    borderWidth: 2,
    borderTopColor: PIXEL_COLORS.border1,
    borderLeftColor: PIXEL_COLORS.border1,
    borderRightColor: PIXEL_COLORS.bg0,
    borderBottomColor: PIXEL_COLORS.bg0,
    borderRadius: 0,
    paddingHorizontal: GRID.sm + 2,
    paddingVertical: GRID.xs,
  },
  actionButtonPressed: {
    borderTopColor: PIXEL_COLORS.bg0,
    borderLeftColor: PIXEL_COLORS.bg0,
    borderRightColor: PIXEL_COLORS.border1,
    borderBottomColor: PIXEL_COLORS.border1,
  },
  actionButtonText: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // Status badge
  statusBadge: {
    borderWidth: 1,
    borderRadius: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 0.5,
  },

  // USB class badge
  usbClassBadge: {
    backgroundColor: PIXEL_COLORS.bg0,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  usbClassText: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 0.5,
  },

  // G-code section
  gcodeDivider: {
    height: 1,
    backgroundColor: PIXEL_COLORS.border0,
    marginVertical: GRID.sm,
  },
  gcodeLabel: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 2,
    marginBottom: GRID.sm,
  },
  gcodeTargetRow: {
    flexDirection: 'row',
    gap: GRID.xs,
    marginBottom: GRID.sm,
  },
  gcodeTargetButton: {
    backgroundColor: PIXEL_COLORS.bg0,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 0,
    paddingHorizontal: GRID.sm,
    paddingVertical: GRID.xs,
  },
  gcodeTargetActive: {
    borderColor: ACCENT + '60',
    backgroundColor: ACCENT + '10',
  },
  gcodeTargetText: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 1,
  },
  gcodeTargetTextActive: {
    color: ACCENT,
  },
  gcodePresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.xs,
    marginBottom: GRID.sm,
  },
  presetChip: {
    backgroundColor: PIXEL_COLORS.bg0,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 0,
    paddingHorizontal: GRID.sm,
    paddingVertical: 3,
  },
  presetChipPressed: {
    backgroundColor: ACCENT + '10',
    borderColor: ACCENT + '40',
  },
  presetChipText: {
    color: PIXEL_COLORS.text1,
    fontSize: 9,
    fontWeight: '600',
    fontFamily: MONO,
  },
  gcodeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIXEL_COLORS.bg0,
    borderWidth: 2,
    borderTopColor: PIXEL_COLORS.bg0,
    borderLeftColor: PIXEL_COLORS.bg0,
    borderRightColor: PIXEL_COLORS.border1,
    borderBottomColor: PIXEL_COLORS.border1,
    borderRadius: 0,
    gap: GRID.xs,
  },
  gcodePrompt: {
    color: ACCENT_GREEN,
    fontSize: 14,
    fontWeight: '900',
    fontFamily: MONO,
    paddingLeft: GRID.sm,
  },
  gcodeInput: {
    flex: 1,
    color: PIXEL_COLORS.text0,
    fontSize: 12,
    fontFamily: MONO,
    paddingVertical: GRID.sm,
    paddingHorizontal: GRID.xs,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  } as any,
  gcodeSendButton: {
    backgroundColor: ACCENT + '18',
    borderLeftWidth: 1,
    borderLeftColor: PIXEL_COLORS.border0,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  gcodeSendDisabled: {
    backgroundColor: 'transparent',
  },
  gcodeSendPressed: {
    backgroundColor: ACCENT + '30',
  },
  gcodeSendText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1,
  },

  // Tips card
  tipsCard: {
    ...pixelInset,
    padding: GRID.md,
    marginTop: GRID.md,
  },
  tipsTitle: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 2,
    marginBottom: GRID.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GRID.sm,
    paddingVertical: 3,
  },
  tipIcon: {
    fontSize: 12,
    width: 20,
    textAlign: 'center',
  },
  tipText: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontFamily: MONO,
    lineHeight: 16,
    flex: 1,
  },
});
