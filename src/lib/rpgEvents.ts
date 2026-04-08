// rpgEvents.ts — Central event bus for RPG-style XP popups across the app
// Singleton pattern: components subscribe, progression.ts emits after awarding XP.

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface XPEvent {
  id: string;
  xpAmount: number;
  xpType: 'bond' | 'mastery';
  source: string;
  agentName?: string;
  levelUp?: boolean;
  newLevel?: number;
  newTitle?: string;
  timestamp: number;
}

export type XPEventCallback = (event: XPEvent) => void;

// ─── Singleton Event Bus ────────────────────────────────────────────────────

const listeners: Set<XPEventCallback> = new Set();
let eventCounter = 0;

/** Subscribe to XP events. Returns unsubscribe function. */
export function onXPEvent(callback: XPEventCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Emit an XP event to all listeners. */
export function emitXPEvent(event: Omit<XPEvent, 'id' | 'timestamp'>): void {
  const fullEvent: XPEvent = {
    ...event,
    id: `xp_${Date.now()}_${++eventCounter}`,
    timestamp: Date.now(),
  };
  listeners.forEach(cb => {
    try {
      cb(fullEvent);
    } catch (err) {
      console.warn('[rpgEvents] listener error:', err);
    }
  });
}

// ─── React Hook ─────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = 20;
const EVENT_DISPLAY_DURATION = 3500; // ms before auto-clear

/**
 * Hook that returns a queue of recent XP events.
 * Events auto-clear after display duration.
 */
export function useXPEvents(): {
  events: XPEvent[];
  dismissEvent: (id: string) => void;
  clearAll: () => void;
} {
  const [events, setEvents] = useState<XPEvent[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const clearAll = useCallback(() => {
    setEvents([]);
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    const unsubscribe = onXPEvent((event) => {
      setEvents(prev => {
        const next = [event, ...prev];
        // Trim to max queue size
        if (next.length > MAX_QUEUE_SIZE) {
          const removed = next.slice(MAX_QUEUE_SIZE);
          removed.forEach(e => {
            const timer = timersRef.current.get(e.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(e.id);
            }
          });
          return next.slice(0, MAX_QUEUE_SIZE);
        }
        return next;
      });

      // Auto-dismiss after duration
      const timer = setTimeout(() => {
        setEvents(prev => prev.filter(e => e.id !== event.id));
        timersRef.current.delete(event.id);
      }, EVENT_DISPLAY_DURATION);
      timersRef.current.set(event.id, timer);
    });

    return () => {
      unsubscribe();
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return { events, dismissEvent, clearAll };
}

// ─── Helper: Map event_kind to human-readable source label ──────────────────

export function eventKindToLabel(eventKind: string): string {
  const labels: Record<string, string> = {
    session_started: 'Session Started',
    message_sent: 'Message Sent',
    meaningful_reply: 'Meaningful Reply',
    task_completed: 'Task Completed',
    user_feedback_positive: 'Positive Feedback',
    long_session: 'Long Session',
    customization_saved: 'Customization',
    name_given: 'Named Agent',
    daily_interaction: 'Daily Interaction',
    streak_day: 'Streak Day',
    trust_escalation: 'Trust Escalation',
    milestone_reached: 'Milestone',
    successful_turn: 'Successful Turn',
    successful_task: 'Task Success',
    user_accepted_output: 'Output Accepted',
    user_reused_artifact: 'Artifact Reused',
    high_quality_rating: 'High Quality',
    streak_same_spirit_day: 'Spirit Streak',
    challenge_completed: 'Challenge Done',
    role_promotion: 'Role Promotion',
  };
  return labels[eventKind] || eventKind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
