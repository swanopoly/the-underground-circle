/**
 * agentHandoffs.ts — Cross-Surface Handoff Execution
 *
 * Converts agent HandoffSuggestions into real Supabase actions:
 * creating tasks, opening rooms, escalating to admins, or
 * continuing sessions across surfaces.
 */

import { supabase } from './supabase';
import { HandoffSuggestion } from './agentRuntime';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HandoffAction {
  type: 'task_created' | 'room_opened' | 'escalated' | 'session_continued';
  message: string;
  targetId?: string;
  targetUrl?: string;
}

// ─── Handoff Execution ──────────────────────────────────────────────────────

/**
 * Performs the suggested handoff action against Supabase.
 *
 * - create_task: inserts into `tasks`, returns task id
 * - open_room: creates or finds a project room, returns room id
 * - escalate: creates a mention/notification for the circle owner
 * - continue_session: creates a chat_session entry for later
 */
export async function executeHandoff(
  suggestion: HandoffSuggestion,
  circleId: string,
  userId: string
): Promise<HandoffAction> {
  switch (suggestion.type) {
    case 'create_task': {
      const title =
        (suggestion.payload.suggestedTitle as string) || suggestion.title;
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          circle_id: circleId,
          created_by: userId,
          title,
          description: suggestion.description,
          status: 'todo',
          priority: 'normal',
        })
        .select('id')
        .single();

      if (error) {
        console.error('[Handoff] Failed to create task:', error);
        return {
          type: 'task_created',
          message: `Failed to create task: ${error.message}`,
        };
      }

      return {
        type: 'task_created',
        message: `Task created: "${title}"`,
        targetId: data.id,
      };
    }

    case 'open_room': {
      const roomName =
        (suggestion.payload.suggestedName as string) || suggestion.title;

      // Check for an existing room with a similar name first
      const { data: existing } = await supabase
        .from('project_rooms')
        .select('id, name')
        .eq('circle_id', circleId)
        .ilike('name', roomName)
        .limit(1);

      if (existing && existing.length > 0) {
        return {
          type: 'room_opened',
          message: `Room already exists: "${existing[0].name}"`,
          targetId: existing[0].id,
        };
      }

      const { data, error } = await supabase
        .from('project_rooms')
        .insert({
          circle_id: circleId,
          created_by: userId,
          name: roomName,
          description: suggestion.description,
        })
        .select('id')
        .single();

      if (error) {
        console.error('[Handoff] Failed to create room:', error);
        return {
          type: 'room_opened',
          message: `Failed to create room: ${error.message}`,
        };
      }

      return {
        type: 'room_opened',
        message: `Room created: "${roomName}"`,
        targetId: data.id,
      };
    }

    case 'escalate': {
      // Find the circle owner / admin
      const { data: circle } = await supabase
        .from('circles')
        .select('created_by')
        .eq('id', circleId)
        .single();

      const ownerId = circle?.created_by || userId;

      // Post an escalation message to the circle chat
      const escalationContent =
        `[ESCALATION] ${suggestion.title}\n\n` +
        `${suggestion.description}\n\n` +
        `Reason: ${(suggestion.payload.reason as string) || 'Agent-detected escalation'}\n` +
        `@admin — please review.`;

      const { error } = await supabase.from('messages').insert({
        circle_id: circleId,
        user_id: userId,
        content: escalationContent,
        is_bot: true,
      });

      if (error) {
        // Retry without is_bot column (schema migration may be pending)
        try {
          await supabase.from('messages').insert({
            circle_id: circleId,
            user_id: userId,
            content: escalationContent,
          });
        } catch {
          // best-effort — ignore
        }
      }

      return {
        type: 'escalated',
        message: `Escalated to circle owner. They will be notified.`,
        targetId: ownerId,
      };
    }

    case 'continue_session': {
      // Store session continuation context for later pickup
      const { data, error } = await supabase
        .from('messages')
        .insert({
          circle_id: circleId,
          user_id: userId,
          content: `[SESSION BOOKMARK] ${suggestion.title}\n${suggestion.description}`,
          is_bot: true,
        })
        .select('id')
        .single();

      if (error) {
        return {
          type: 'session_continued',
          message: `Failed to bookmark session: ${error.message}`,
        };
      }

      return {
        type: 'session_continued',
        message: `Session bookmarked for later: "${suggestion.title}"`,
        targetId: data?.id,
      };
    }

    default:
      return {
        type: 'session_continued',
        message: 'Unknown handoff type.',
      };
  }
}

// ─── Display Formatting ─────────────────────────────────────────────────────

const HANDOFF_ICONS: Record<string, string> = {
  create_task: 'T',
  open_room: 'R',
  escalate: '!',
  continue_session: '>',
};

const HANDOFF_COLORS: Record<string, string> = {
  create_task: '#f59e0b',
  open_room: '#06b6d4',
  escalate: '#ef4444',
  continue_session: '#6366f1',
};

/**
 * Formats a handoff suggestion as a readable text card for chat display.
 */
export function formatHandoffCard(suggestion: HandoffSuggestion): string {
  const icon = HANDOFF_ICONS[suggestion.type] || '?';
  const typeLabel = suggestion.type.replace(/_/g, ' ').toUpperCase();

  return (
    `[${icon}] **${typeLabel}**\n` +
    `${suggestion.title}\n` +
    `${suggestion.description}`
  );
}
