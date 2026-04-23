/**
 * ComputerUseButton.tsx — Initiates a computer-use session
 *
 * Compact button for chat/task UI. Plans actions on press,
 * shows permission dialog, then starts the session.
 * Web-only: computer-use requires a real browser.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
  Animated,
} from 'react-native';
import {
  createSession,
  describeComputerUsePlan,
  type ComputerUseSession,
  type ComputerUsePermission,
  type BrowserAction,
  type BrowserPlanCardData,
} from '../../lib/computerUse';
import ComputerUsePermissionDialog from './ComputerUsePermissionDialog';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ComputerUseButtonProps {
  task?: string;
  agentName?: string;
  circleId: string;
  onSessionStart: (session: ComputerUseSession) => void;
  accentColor: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ComputerUseButton({
  task: initialTask,
  agentName = 'BlackSwan',
  circleId,
  onSessionStart,
  accentColor,
}: ComputerUseButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [taskInput, setTaskInput] = useState(initialTask || '');
  const [showPermission, setShowPermission] = useState(false);
  const [plannedActions, setPlannedActions] = useState<BrowserAction[]>([]);
  const [pendingTask, setPendingTask] = useState('');
  const [pendingPlan, setPendingPlan] = useState<BrowserPlanCardData | null>(null);

  // Web-only guard
  if (Platform.OS !== 'web') {
    return null;
  }

  const handlePress = useCallback(() => {
    if (initialTask) {
      // If task is pre-set, go straight to planning
      startPlanning(initialTask);
    } else {
      // Show task input
      setShowTaskInput(true);
    }
  }, [initialTask]);

  const startPlanning = useCallback(async (taskText: string) => {
    if (!taskText.trim()) return;
    setLoading(true);
    setPendingTask(taskText.trim());

    try {
      const plan = await describeComputerUsePlan({ task: taskText.trim(), circleId, agentName });
      setPendingPlan({
        planId: `browser-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        task: plan.task,
        intent: plan.intent,
        backend: plan.backend,
        backendLabel: plan.backendLabel,
        backendDetails: plan.backendDetails,
        requiresApproval: plan.requiresApproval,
        recommendedPermission: plan.recommendedPermission,
        status: 'planned',
        actions: plan.actions.map((action) => ({
          id: action.id,
          type: action.type,
          target: action.target,
          value: action.value,
          description: action.description,
          requiresApproval: action.requiresApproval,
          approvalReason: action.approvalReason,
          blockedReason: action.blockedReason,
        })),
      });
      setPlannedActions(plan.actions);
      setShowPermission(true);
      setShowTaskInput(false);
    } catch (err: any) {
      console.error('Failed to plan actions:', err);
      // Create a minimal fallback plan
      setPlannedActions([
        {
          id: `action_${Date.now()}_0`,
          type: 'navigate',
          target: taskText.trim(),
          description: `Complete task: ${taskText.trim()}`,
          requiresApproval: true,
          status: 'pending',
        },
      ]);
      setPendingPlan(null);
      setShowPermission(true);
      setShowTaskInput(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAllow = useCallback(async (permission: ComputerUsePermission) => {
    setShowPermission(false);

    const session = await createSession(agentName, pendingTask, permission, {
      circleId,
      intent: pendingPlan?.intent,
      recommendedPermission: pendingPlan?.recommendedPermission,
    });
    session.actions = plannedActions.map(a => ({
      ...a,
      status: permission === 'trusted' ? 'approved' as const : 'pending' as const,
    }));
    session.status = permission === 'trusted' ? 'executing' : 'awaiting_approval';

    onSessionStart(session);

    // Reset state
    setPlannedActions([]);
    setPendingTask('');
    setTaskInput('');
    setPendingPlan(null);
  }, [agentName, pendingTask, plannedActions, onSessionStart, circleId, pendingPlan]);

  const handleDeny = useCallback(() => {
    setShowPermission(false);
    setPlannedActions([]);
    setPendingTask('');
    setPendingPlan(null);
  }, []);

  return (
    <>
      {/* ── Task Input Modal ── */}
      {showTaskInput && (
        <View style={styles.taskInputOverlay} nativeID="section-computer-use-task-input">
          <View style={styles.taskInputDialog}>
            <Text style={styles.taskInputTitle}>COMPUTER TASK</Text>
            <Text style={styles.taskInputDesc}>
              What should the agent do on the computer?
            </Text>
            <TextInput
              style={styles.taskInputField}
              value={taskInput}
              onChangeText={setTaskInput}
              placeholder="e.g. Search for React docs on MDN..."
              placeholderTextColor="#3e3e3e"
              multiline
              autoFocus
            />
            <View style={styles.taskInputButtons}>
              <Pressable
                onPress={() => { setShowTaskInput(false); setTaskInput(''); }}
                accessibilityRole="button"
                style={styles.taskCancelButton}
              >
                <Text style={styles.taskCancelText}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={() => startPlanning(taskInput)}
                accessibilityRole="button"
                disabled={!taskInput.trim() || loading}
                style={[styles.taskGoButton, { backgroundColor: accentColor, opacity: taskInput.trim() && !loading ? 1 : 0.4 }]}
              >
                <Text style={styles.taskGoText}>
                  {loading ? 'PLANNING...' : 'PLAN'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── Permission Dialog ── */}
      {showPermission && (
        <ComputerUsePermissionDialog
          task={pendingTask}
          agentName={agentName}
          actions={plannedActions}
          intent={pendingPlan?.intent}
          recommendedPermission={pendingPlan?.recommendedPermission}
          onAllow={handleAllow}
          onDeny={handleDeny}
        />
      )}

      {/* ── Button ── */}
      <Pressable
        onPress={handlePress}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Use Computer"
        style={[styles.button, { borderColor: accentColor + '40' }]}
      >
        <View style={[styles.buttonIcon, { backgroundColor: accentColor + '15', borderColor: accentColor + '30' }]}>
          <Text style={[styles.buttonIconText, { color: accentColor }]}>{'[_]'}</Text>
        </View>
        <Text style={[styles.buttonLabel, { color: loading ? '#6f6f6f' : '#e8e8e8' }]}>
          {loading ? 'Planning...' : 'Use Computer'}
        </Text>
      </Pressable>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 2,
    backgroundColor: '#0a0a0f',
  },
  buttonIcon: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIconText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
  },
  buttonLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
  },
  taskInputOverlay: {
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
  taskInputDialog: {
    backgroundColor: '#0a0a0f',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    maxWidth: 480,
    width: '100%' as any,
    padding: 20,
    ...(Platform.OS === 'web' ? { boxShadow: '8px 8px 0px #050508' } : {}),
  },
  taskInputTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#e8e8e8',
    letterSpacing: 2,
    marginBottom: 8,
  },
  taskInputDesc: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#6f6f6f',
    marginBottom: 12,
  },
  taskInputField: {
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#e8e8e8',
    minHeight: 60,
    maxHeight: 120,
  },
  taskInputButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  taskCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#3e3e3e',
    borderRadius: 2,
    backgroundColor: '#1a1a2e',
  },
  taskCancelText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 1,
  },
  taskGoButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 2,
  },
  taskGoText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 1,
  },
});
