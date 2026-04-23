/**
 * ComputerUsePermissionDialog.tsx — Permission request dialog
 *
 * Shown before any computer-use session starts. Displays the task,
 * planned actions, and lets the user choose a permission level.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import type { BrowserAction, ComputerUsePermission } from '../../lib/computerUse';
import type { BrowserTaskIntent } from '../../lib/browserTaskIntent';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ComputerUsePermissionDialogProps {
  task: string;
  agentName: string;
  actions: BrowserAction[];
  intent?: BrowserTaskIntent;
  recommendedPermission?: ComputerUsePermission;
  grantSummary?: string | null;
  approvalSummary?: string | null;
  onAllow: (permission: ComputerUsePermission) => void;
  onDeny: () => void;
}

// ─── Permission Options ─────────────────────────────────────────────────────

const PERMISSION_OPTIONS: { value: ComputerUsePermission; label: string; desc: string; safety: string }[] = [
  {
    value: 'ask_every_time',
    label: 'Ask me before each action',
    desc: 'You approve every click, navigation, and form fill individually.',
    safety: 'SAFEST',
  },
  {
    value: 'ask_for_new_sites',
    label: 'Ask only for new websites',
    desc: 'Auto-approve actions on sites you have already allowed.',
    safety: 'BALANCED',
  },
  {
    value: 'trusted',
    label: 'Trust this agent for this task',
    desc: 'The agent will execute all planned actions without asking.',
    safety: 'FASTEST',
  },
];

const ACTION_TYPE_LABELS: Record<string, string> = {
  navigate: 'Navigate',
  click: 'Click',
  fill: 'Fill form',
  screenshot: 'Screenshot',
  select: 'Select',
  press_key: 'Key press',
  wait: 'Wait',
  scroll: 'Scroll',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ComputerUsePermissionDialog({
  task,
  agentName,
  actions,
  intent: _intent,
  recommendedPermission,
  grantSummary,
  approvalSummary,
  onAllow,
  onDeny,
}: ComputerUsePermissionDialogProps) {
  const [selectedPermission, setSelectedPermission] = useState<ComputerUsePermission>(recommendedPermission || 'ask_every_time');

  return (
    <View style={styles.overlay} nativeID="section-computer-use-permission">
      <View style={styles.dialog}>
        {/* ── Title ── */}
        <View style={styles.titleRow}>
          <View style={styles.agentIconBox}>
            <Text style={styles.agentIconText}>AI</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {agentName} wants to use the computer
            </Text>
            <Text style={styles.subtitle}>Computer-Use Permission Request</Text>
          </View>
        </View>

        {/* ── Task Description ── */}
        <View style={styles.taskBox}>
          <Text style={styles.taskLabel}>TASK</Text>
          <Text style={styles.taskText}>{task}</Text>
        </View>

        {(grantSummary || approvalSummary) && (
          <View style={styles.accessBox}>
            <Text style={styles.taskLabel}>ACCESS PLAN</Text>
            {grantSummary ? <Text style={styles.accessText}>{grantSummary}</Text> : null}
            {approvalSummary ? <Text style={styles.accessWarning}>{approvalSummary}</Text> : null}
          </View>
        )}

        {/* ── Planned Actions Preview ── */}
        <View style={styles.actionsPreview}>
          <Text style={styles.sectionLabel}>PLANNED ACTIONS ({actions.length})</Text>
          <ScrollView style={styles.actionsList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {actions.map((action, index) => (
              <View key={action.id} style={styles.actionPreviewRow}>
                <Text style={styles.actionIndex}>{index + 1}.</Text>
                <View style={styles.actionTypeBadge}>
                  <Text style={styles.actionTypeText}>
                    {ACTION_TYPE_LABELS[action.type] || action.type}
                  </Text>
                </View>
                <Text style={styles.actionDesc} numberOfLines={1}>{action.description}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Permission Options ── */}
        <View style={styles.permissionsSection}>
          <Text style={styles.sectionLabel}>PERMISSION LEVEL</Text>
          {PERMISSION_OPTIONS.map((opt) => {
            const isSelected = selectedPermission === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setSelectedPermission(opt.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={opt.label}
                style={[
                  styles.permissionOption,
                  isSelected && styles.permissionOptionSelected,
                ]}
              >
                <View style={styles.radioRow}>
                  <View style={[styles.radio, isSelected && styles.radioSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.permissionLabel, isSelected && styles.permissionLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.permissionDesc}>{opt.desc}</Text>
                  </View>
                  <View style={[
                    styles.safetyBadge,
                    { backgroundColor: opt.safety === 'SAFEST' ? '#22c55e15' : opt.safety === 'BALANCED' ? '#f59e0b15' : '#ef444415' },
                    { borderColor: opt.safety === 'SAFEST' ? '#22c55e40' : opt.safety === 'BALANCED' ? '#f59e0b40' : '#ef444440' },
                  ]}>
                    <Text style={[
                      styles.safetyText,
                      { color: opt.safety === 'SAFEST' ? '#22c55e' : opt.safety === 'BALANCED' ? '#f59e0b' : '#ef4444' },
                    ]}>
                      {opt.safety}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── Warning ── */}
        <View style={styles.warningBox}>
          <Text style={styles.warningIcon}>!</Text>
          <Text style={styles.warningText}>
            The agent will control a browser window on your computer. Actions are logged and can be paused at any time.
          </Text>
        </View>

        {/* ── Buttons ── */}
        <View style={styles.buttonRow}>
          <Pressable
            onPress={onDeny}
            accessibilityRole="button"
            accessibilityLabel="Deny computer access"
            style={styles.denyButton}
          >
            <Text style={styles.denyButtonText}>DENY</Text>
          </Pressable>
          <Pressable
            onPress={() => onAllow(selectedPermission)}
            accessibilityRole="button"
            accessibilityLabel="Allow computer access"
            style={styles.allowButton}
          >
            <Text style={styles.allowButtonText}>ALLOW</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...(Platform.OS === 'web' ? {
      position: 'fixed' as any,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    } : {
      ...StyleSheet.absoluteFillObject,
    }),
    backgroundColor: '#000000cc',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  dialog: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    maxWidth: 540,
    width: '100%' as any,
    padding: 20,
    ...(Platform.OS === 'web' ? { boxShadow: '8px 8px 0px #050508' } : {}),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  agentIconBox: {
    width: 40,
    height: 40,
    borderWidth: 2,
    borderColor: '#6366f140',
    borderRadius: 2,
    backgroundColor: '#111118',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentIconText: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#6366f1',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#e8e8e8',
  },
  subtitle: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
    letterSpacing: 1,
    marginTop: 2,
  },
  taskBox: {
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 12,
    marginBottom: 16,
  },
  taskLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  taskText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#e8e8e8',
    lineHeight: 18,
  },
  accessBox: {
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#24243a',
    borderRadius: 2,
    padding: 12,
    marginBottom: 16,
  },
  accessText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#b6b6c8',
    lineHeight: 16,
  },
  accessWarning: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#f59e0b',
    lineHeight: 14,
    marginTop: 6,
  },
  actionsPreview: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  actionsList: {
    maxHeight: 140,
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 8,
  },
  actionPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  actionIndex: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#3e3e3e',
    fontWeight: '700',
    width: 20,
  },
  actionTypeBadge: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  actionTypeText: {
    fontFamily: 'monospace',
    fontSize: 8,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as any,
  },
  actionDesc: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#9e9e9e',
    flex: 1,
  },
  permissionsSection: {
    marginBottom: 16,
  },
  permissionOption: {
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 12,
    marginBottom: 8,
  },
  permissionOptionSelected: {
    borderColor: '#6366f150',
    backgroundColor: '#6366f108',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radio: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: '#3e3e3e',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#6366f1',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366f1',
  },
  permissionLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#9e9e9e',
  },
  permissionLabelSelected: {
    color: '#e8e8e8',
  },
  permissionDesc: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#6f6f6f',
    marginTop: 2,
  },
  safetyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 2,
  },
  safetyText: {
    fontFamily: 'monospace',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#f59e0b08',
    borderWidth: 1,
    borderColor: '#f59e0b30',
    borderRadius: 2,
    padding: 10,
    marginBottom: 16,
  },
  warningIcon: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#f59e0b',
  },
  warningText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#f59e0b',
    flex: 1,
    lineHeight: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  denyButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#3e3e3e',
    borderRadius: 2,
    backgroundColor: '#1a1a2e',
  },
  denyButtonText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 1,
  },
  allowButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#6366f150',
    borderRadius: 2,
    backgroundColor: '#6366f1',
  },
  allowButtonText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 1,
  },
});
