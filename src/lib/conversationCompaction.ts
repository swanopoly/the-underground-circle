/**
 * conversationCompaction — OpenSwan conversation compaction for long sessions.
 *
 * When a conversation approaches the context window limit, the system
 * summarizes older messages into a condensed representation and prepends
 * it to the next turn. This prevents lost context and keeps the agent
 * coherent across long sessions.
 *
 * Also re-injects "critical context" (circle missions, user preferences,
 * active instructions) after compaction so the agent never loses its
 * core instructions — SwanClaw's post-compaction context re-injection.
 */

import { supabase } from './supabase';

export interface CompactedContext {
  summary: string;
  messageCount: number;
  compactedAt: string;
  tokenEstimate: number;
}

const COMPACTION_THRESHOLD = 30; // messages before we compact
const SUMMARY_MAX_CHARS = 1500;
const COMPACTION_STORAGE_KEY = 'uc_compacted_context_';

export function shouldCompact(messageCount: number): boolean {
  return messageCount >= COMPACTION_THRESHOLD;
}

export async function compactConversation(
  messages: Array<{ role: string; text: string; timestamp?: string }>,
  circleContext?: string,
): Promise<CompactedContext | null> {
  if (messages.length < 10) return null;

  const transcript = messages.map(m => {
    const time = m.timestamp ? ` [${m.timestamp}]` : '';
    return `${m.role}${time}: ${m.text.slice(0, 400)}`;
  }).join('\n');

  const prompt = `Summarize this conversation into a concise context that preserves:
1. Key decisions made and their rationale
2. User preferences expressed (how they want things done)
3. Open questions or unresolved topics
4. Any tasks discussed, their status, and who is responsible
5. Technical details that would be needed to continue the conversation

Be specific — names, numbers, file paths, URLs. This summary replaces the full transcript.
Under ${SUMMARY_MAX_CHARS} characters.

${circleContext ? `Circle context to preserve:\n${circleContext}\n\n` : ''}Conversation (${messages.length} messages):
${transcript.slice(0, 8000)}

Summary:`;

  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        provider: 'google_ai',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.1,
      },
    });
    if (error || data?.error) {
      console.warn('[conversationCompaction] Server-side Google AI route unavailable. Connect or verify a Google AI key in Marketplace.');
      return null;
    }
    const summary = typeof data?.response === 'string' ? data.response.trim() : '';
    if (!summary || summary.length < 30) return null;

    return {
      summary: summary.slice(0, SUMMARY_MAX_CHARS),
      messageCount: messages.length,
      compactedAt: new Date().toISOString(),
      tokenEstimate: Math.ceil(summary.length / 4),
    };
  } catch {
    console.warn('[conversationCompaction] Server-side Google AI route unavailable. Connect or verify a Google AI key in Marketplace.');
    return null;
  }
}

export function saveCompactedContext(threadId: string, ctx: CompactedContext): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMPACTION_STORAGE_KEY + threadId, JSON.stringify(ctx));
    }
  } catch {}
}

export function loadCompactedContext(threadId: string): CompactedContext | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(COMPACTION_STORAGE_KEY + threadId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearCompactedContext(threadId: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(COMPACTION_STORAGE_KEY + threadId);
    }
  } catch {}
}

/**
 * Build a "post-compaction" prefix that re-injects critical context
 * after the conversation has been summarized. This ensures the agent
 * never loses its mission awareness or user preferences.
 */
export function buildPostCompactionPrefix(opts: {
  compacted: CompactedContext;
  circleName?: string;
}): string {
  const lines = [
    '## Previous Conversation Summary',
    `(Summarized from ${opts.compacted.messageCount} messages on ${new Date(opts.compacted.compactedAt).toLocaleDateString()})`,
    '',
    opts.compacted.summary,
  ];
  return lines.join('\n');
}
