/**
 * DevicePanel — Device discovery & control panel
 *
 * Shows local bridge connection status, discovers printers / serial ports /
 * 3D printers / USB / network devices, and exposes quick-action buttons
 * (print test page, send G-code, ping, etc.) for each device.
 *
 * Requires a companion bridge server running locally.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  discoverAllDevicesResult,
  detect3DPrintersResult,
  scanNetworkResult,
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
type PendingGCode = Readonly<{
  command: string;
  target: GCodeTarget;
  port?: string;
  serviceUrl?: string;
}>;

function deviceErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

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
  const [selectedSerialPort, setSelectedSerialPort] = useState<string | null>(null);
  const [pendingGCode, setPendingGCode] = useState<PendingGCode | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState<'success' | 'error' | 'info'>('info');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Feedback helper ───────────────────────────────────────────────────────

  const showFeedback = useCallback(
    (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      setActionFeedback(msg);
      setFeedbackType(type);
      feedbackTimerRef.current = setTimeout(() => {
        feedbackTimerRef.current = null;
        setActionFeedback('');
      }, 4000);
    },
    [],
  );

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

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
      const [inventoryResult, printerResult, networkResult] = await Promise.all([
        discoverAllDevicesResult(),
        detect3DPrintersResult(),
        scanNetworkResult(),
      ]);
      if (!inventoryResult.ok || !inventoryResult.data) {
        throw new Error(inventoryResult.error || 'The authenticated device bridge did not return an inventory.');
      }
      const inv = inventoryResult.data;
      const printers = printerResult.ok ? printerResult.data?.services || [] : [];
      const network = networkResult.ok ? networkResult.data?.devices || [] : [];
      setInventory(inv);
      setPrinters3D(printers);
      setNetworkDevices(network);
      setSelectedSerialPort(current => (
        current && inv.serialPorts.some(port => port.path === current)
          ? current
          : inv.serialPorts[0]?.path || null
      ));

      const total =
        (inv?.printers?.length ?? 0) +
        (inv?.serialPorts?.length ?? 0) +
        (inv?.usbDevices?.length ?? 0) +
        printers.length +
        network.length;
      const unavailableReads = [
        !printerResult.ok ? `3D printer discovery (${printerResult.error || 'unavailable'})` : null,
        !networkResult.ok ? `network discovery (${networkResult.error || 'unavailable'})` : null,
      ].filter((value): value is string => Boolean(value));
      showFeedback(
        unavailableReads.length > 0
          ? `Inventory loaded, but ${unavailableReads.join(' and ')} failed. Retry the scan for a complete result.`
          : `Scan complete — ${total} device${total !== 1 ? 's' : ''} found`,
        unavailableReads.length > 0 ? 'error' : 'success',
      );

      // Auto-expand first non-empty section
      if (inv?.printers?.length) setExpandedSection('printers');
      else if (printers.length) setExpandedSection('3d');
      else if (inv?.serialPorts?.length) setExpandedSection('serial');
      else if (inv?.usbDevices?.length) setExpandedSection('usb');
      else if (network.length) setExpandedSection('network');
    } catch (err: unknown) {
      showFeedback(`Scan failed: ${deviceErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setScanning(false);
    }
  }, [showFeedback]);

  // ── Quick actions ─────────────────────────────────────────────────────────

  const handlePrintTest = useCallback(
    async (printerName?: string) => {
      if (mutationBusy) return;
      setMutationBusy(true);
      try {
        showFeedback(`Printing test page${printerName ? ` on ${printerName}` : ''}...`, 'info');
        const result = await printText(
          'Test page from The Underground Circle\n' +
            `Circle: ${circleId}\n` +
            `Date: ${new Date().toISOString()}\n` +
            '─'.repeat(40) + '\n' +
            'If you can read this, your printer is connected.\n',
          { printer: printerName },
        );
        if (!result.ok) throw new Error(result.error || 'The bridge rejected the print job.');
        showFeedback('Test page sent successfully', 'success');
      } catch (err: unknown) {
        showFeedback(`Print failed: ${deviceErrorMessage(err, 'Unknown error')}`, 'error');
      } finally {
        setMutationBusy(false);
      }
    },
    [circleId, mutationBusy, showFeedback],
  );

  const requestSendGCode = useCallback(() => {
    const cmd = gcodeInput.trim();
    if (!cmd) {
      showFeedback('Enter a G-code command first', 'error');
      return;
    }

    if (gcodeTarget === 'serial' && !selectedSerialPort) {
      showFeedback('Choose an exact serial port before reviewing this command.', 'error');
      return;
    }
    const serviceMatches = printers3D.filter(service => service.type === gcodeTarget);
    if (gcodeTarget !== 'serial' && serviceMatches.length !== 1) {
      showFeedback(
        serviceMatches.length === 0
          ? `No ${gcodeTarget} service is available for this command.`
          : `Multiple ${gcodeTarget} services were found. Use a single bound service before sending commands.`,
        'error',
      );
      return;
    }
    const matchedService = gcodeTarget === 'serial' ? null : serviceMatches[0];
    if (matchedService && !matchedService.url) {
      showFeedback(`The detected ${gcodeTarget} service has no verified URL. Scan again before sending commands.`, 'error');
      return;
    }

    setPendingGCode({
      command: cmd,
      target: gcodeTarget,
      port: gcodeTarget === 'serial' ? selectedSerialPort || undefined : undefined,
      serviceUrl: matchedService?.url,
    });
  }, [gcodeInput, gcodeTarget, printers3D, selectedSerialPort, showFeedback]);

  const confirmSendGCode = useCallback(async () => {
    if (!pendingGCode || mutationBusy) return;
    setMutationBusy(true);
    try {
      const targetIdentity = pendingGCode.port || pendingGCode.serviceUrl;
      const targetLabel = targetIdentity
        ? `${pendingGCode.target} (${targetIdentity})`
        : pendingGCode.target;
      showFeedback(`Sending ${pendingGCode.command} via ${targetLabel}...`, 'info');
      const result = await sendGCode(
        pendingGCode.target,
        pendingGCode.command,
        pendingGCode.port || pendingGCode.serviceUrl
          ? { port: pendingGCode.port, serviceUrl: pendingGCode.serviceUrl }
          : undefined,
      );
      if (!result.ok) throw new Error(result.error || 'The bridge rejected the G-code command.');
      showFeedback(`G-code sent: ${pendingGCode.command}`, 'success');
      setGcodeInput('');
      setPendingGCode(null);
    } catch (err: unknown) {
      showFeedback(`G-code failed: ${deviceErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setMutationBusy(false);
    }
  }, [mutationBusy, pendingGCode, showFeedback]);

  const handleSerialSend = useCallback(
    async (port: string) => {
      if (mutationBusy) return;
      setMutationBusy(true);
      try {
        showFeedback(`Pinging ${port}...`, 'info');
        const result = await sendToSerial(port, 'PING\n');
        if (!result.ok) throw new Error(result.error || 'The bridge rejected the serial write.');
        showFeedback(`Sent PING to ${port}`, 'success');
      } catch (err: unknown) {
        showFeedback(`Serial send failed: ${deviceErrorMessage(err, 'Unknown error')}`, 'error');
      } finally {
        setMutationBusy(false);
      }
    },
    [mutationBusy, showFeedback],
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
          accessibilityRole="button"
          accessibilityLabel={bridgeOnline ? 'Scan for connected devices' : 'Retry device bridge connection'}
          accessibilityState={{ busy: scanning, disabled: scanning }}
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
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.feedbackBanner, { borderColor: feedbackColor + '60' }]}
        >
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
            <Text style={styles.codeText}>$ npm run start</Text>
          </View>
          <Text style={styles.offlineBody}>
            The authenticated local bridge listens on localhost:7778 and discovers{'\n'}
            printers, serial ports, USB devices, and network hosts for this app.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check device bridge connection"
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
              (inventory.printers ?? []).map((p, i) => (
                <View key={`${p.name}-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{p.name || `Printer ${i + 1}`}</Text>
                    <Text style={styles.deviceMeta}>
                      {p.isDefault ? 'Default printer' : 'Available printer'}
                      {p.status ? ` \u2022 ${p.status}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Print a test page on ${p.name}`}
                    accessibilityState={{ busy: mutationBusy, disabled: mutationBusy }}
                    disabled={mutationBusy}
                    onPress={() => handlePrintTest(p.name)}
                    style={({ pressed }) => [
                      styles.actionButton,
                      mutationBusy && styles.actionButtonDisabled,
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
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${t.label} G-code target`}
                  accessibilityState={{ selected: gcodeTarget === t.key }}
                  onPress={() => {
                    setGcodeTarget(t.key);
                    setPendingGCode(null);
                  }}
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

            {gcodeTarget === 'serial' && (
              <View style={styles.serialTargetSelector}>
                <Text style={styles.serialTargetLabel}>EXACT SERIAL PORT</Text>
                {(inventory.serialPorts ?? []).length === 0 ? (
                  <Text style={styles.serialTargetEmpty}>
                    No serial port is available. Scan again after connecting the device.
                  </Text>
                ) : (
                  <View style={styles.serialTargetOptions}>
                    {(inventory.serialPorts ?? []).map((port) => (
                      <Pressable
                        key={port.path}
                        accessibilityRole="button"
                        accessibilityLabel={`Use serial port ${port.path}`}
                        accessibilityState={{ selected: selectedSerialPort === port.path }}
                        onPress={() => {
                          setSelectedSerialPort(port.path);
                          setPendingGCode(null);
                        }}
                        style={[
                          styles.serialTargetOption,
                          selectedSerialPort === port.path && styles.serialTargetOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.serialTargetOptionText,
                            selectedSerialPort === port.path && styles.serialTargetOptionTextActive,
                          ]}
                        >
                          {port.path}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {gcodeTarget !== 'serial' && (
              <Text style={styles.targetBindingText}>
                {printers3D.filter(service => service.type === gcodeTarget).length === 1
                  ? `Bound to ${printers3D.find(service => service.type === gcodeTarget)?.url || gcodeTarget}`
                  : `Requires exactly one detected ${gcodeTarget} service before review.`}
              </Text>
            )}

            {/* Presets */}
            <View style={styles.gcodePresetsRow}>
              {GCODE_PRESETS.map((p) => (
                <Pressable
                  key={p.cmd}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${p.label} G-code preset`}
                  onPress={() => {
                    setGcodeInput(p.cmd);
                    setPendingGCode(null);
                  }}
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
                accessibilityLabel="G-code command"
                onChangeText={(value) => {
                  setGcodeInput(value);
                  setPendingGCode(null);
                }}
                placeholder="G28, M104 S200, ..."
                placeholderTextColor={PIXEL_COLORS.text3}
                autoCapitalize="characters"
                returnKeyType="send"
                onSubmitEditing={requestSendGCode}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Review G-code command"
                accessibilityHint="Shows the exact hardware target and asks for confirmation before sending"
                accessibilityState={{ busy: mutationBusy, disabled: !gcodeInput.trim() || mutationBusy }}
                onPress={requestSendGCode}
                disabled={!gcodeInput.trim() || mutationBusy}
                style={({ pressed }) => [
                  styles.gcodeSendButton,
                  (!gcodeInput.trim() || mutationBusy) && styles.gcodeSendDisabled,
                  pressed && gcodeInput.trim() && !mutationBusy ? styles.gcodeSendPressed : undefined,
                ]}
              >
                <Text
                  style={[
                    styles.gcodeSendText,
                    (!gcodeInput.trim() || mutationBusy) && { color: PIXEL_COLORS.text3 },
                  ]}
                >
                  REVIEW
                </Text>
              </Pressable>
            </View>

            {pendingGCode && (
              <View
                style={styles.confirmationCard}
                accessibilityRole="alert"
                testID="device-gcode-confirmation"
              >
                <Text style={styles.confirmationTitle}>CONFIRM HARDWARE ACTION</Text>
                <Text style={styles.confirmationMeta}>
                  Target: {pendingGCode.port || pendingGCode.serviceUrl
                    ? `${pendingGCode.target} at ${pendingGCode.port || pendingGCode.serviceUrl}`
                    : pendingGCode.target}
                </Text>
                <Text style={styles.confirmationCommand} selectable>
                  {pendingGCode.command}
                </Text>
                <Text style={styles.confirmationWarning}>
                  This command can move hardware or change temperatures. Verify the target and keep the device in view.
                </Text>
                <View style={styles.confirmationActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel G-code command"
                    disabled={mutationBusy}
                    onPress={() => setPendingGCode(null)}
                    style={({ pressed }) => [
                      styles.confirmationCancel,
                      mutationBusy && styles.actionButtonDisabled,
                      pressed && styles.actionButtonPressed,
                    ]}
                  >
                    <Text style={styles.confirmationCancelText}>CANCEL</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Run G-code command on ${pendingGCode.port || pendingGCode.serviceUrl || pendingGCode.target}`}
                    accessibilityState={{ busy: mutationBusy, disabled: mutationBusy }}
                    testID="device-gcode-confirm-run"
                    disabled={mutationBusy}
                    onPress={confirmSendGCode}
                    style={({ pressed }) => [
                      styles.confirmationRun,
                      mutationBusy && styles.actionButtonDisabled,
                      pressed && !mutationBusy && styles.gcodeSendPressed,
                    ]}
                  >
                    <Text style={styles.confirmationRunText}>{mutationBusy ? 'SENDING…' : 'RUN COMMAND'}</Text>
                  </Pressable>
                </View>
              </View>
            )}
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
              (inventory.serialPorts ?? []).map((p, i) => (
                <View key={p.path || `serial-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{p.path || `Port ${i + 1}`}</Text>
                    <Text style={styles.deviceMeta}>{p.description || 'Serial device'}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Send a PING receipt check to ${p.path}`}
                    accessibilityHint="Writes a reversible test message to this exact serial port"
                    accessibilityState={{ busy: mutationBusy, disabled: mutationBusy }}
                    disabled={mutationBusy}
                    onPress={() => handleSerialSend(p.path)}
                    style={({ pressed }) => [
                      styles.actionButton,
                      mutationBusy && styles.actionButtonDisabled,
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
              (inventory.usbDevices ?? []).map((u, i) => (
                <View key={`${u.bus}-${u.device}-${i}`} style={styles.deviceRow}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{u.description || `USB Device ${i + 1}`}</Text>
                    <Text style={styles.deviceMeta}>
                      Bus {u.bus || 'unknown'} • Device {u.device || 'unknown'} • {u.id || 'Unknown ID'}
                    </Text>
                  </View>
                  <View style={styles.usbClassBadge}>
                    <Text style={styles.usbClassText}>USB</Text>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}, ${count} detected`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ focused, pressed }: any) => [
          styles.sectionHeader,
          focused && styles.sectionHeaderFocused,
          pressed && styles.sectionHeaderPressed,
        ]}
      >
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
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm + 2,
  },
  sectionHeaderFocused: {
    ...Platform.select({
      web: { outlineStyle: 'none', boxShadow: 'inset 0 0 0 2px rgba(34,211,238,0.6)' } as any,
      default: {},
    }),
  },
  sectionHeaderPressed: { backgroundColor: PIXEL_COLORS.bg3 },
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
    minHeight: 40,
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
  actionButtonDisabled: { opacity: 0.5 },
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
    minHeight: 40,
    justifyContent: 'center',
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
  serialTargetSelector: {
    marginBottom: GRID.sm,
    gap: GRID.xs,
  },
  serialTargetLabel: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 1,
  },
  serialTargetEmpty: {
    color: ACCENT_RED,
    fontSize: 10,
    fontFamily: MONO,
    lineHeight: 15,
  },
  serialTargetOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.xs,
  },
  serialTargetOption: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: GRID.sm,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    backgroundColor: PIXEL_COLORS.bg0,
  },
  serialTargetOptionActive: {
    borderColor: ACCENT + '80',
    backgroundColor: ACCENT + '14',
  },
  serialTargetOptionText: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: MONO,
  },
  serialTargetOptionTextActive: { color: ACCENT },
  targetBindingText: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontFamily: MONO,
    lineHeight: 15,
    marginBottom: GRID.sm,
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
  confirmationCard: {
    marginTop: GRID.sm,
    padding: GRID.md,
    borderWidth: 1,
    borderColor: '#f59e0b66',
    backgroundColor: '#f59e0b10',
    gap: GRID.xs,
  },
  confirmationTitle: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 1.2,
  },
  confirmationMeta: {
    color: PIXEL_COLORS.text1,
    fontSize: 10,
    fontFamily: MONO,
  },
  confirmationCommand: {
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: MONO,
    paddingVertical: GRID.xs,
  },
  confirmationWarning: {
    color: '#d6b56d',
    fontSize: 10,
    fontFamily: MONO,
    lineHeight: 15,
  },
  confirmationActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: GRID.sm,
    marginTop: GRID.xs,
  },
  confirmationCancel: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: GRID.md,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    backgroundColor: PIXEL_COLORS.bg0,
  },
  confirmationCancelText: {
    color: PIXEL_COLORS.text1,
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
  },
  confirmationRun: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: GRID.md,
    borderWidth: 1,
    borderColor: '#f59e0b88',
    backgroundColor: '#f59e0b20',
  },
  confirmationRunText: {
    color: '#fbbf24',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 0.5,
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
