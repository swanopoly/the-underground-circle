/**
 * Conversational Router
 *
 * Detects user intent from natural language and routes to the appropriate
 * action handler — no slash commands needed. The agent figures out what
 * to do from what you say.
 *
 * "Post this to WordPress with the header image attached"
 * "Create a task to review the landing page"
 * "Remember that we use Tailwind for styling"
 * "Forget that old preference about dark mode"
 * "What do you remember about our project?"
 * "Schedule a blog post about AI agents for next Monday"
 */

import { supabase } from './supabase';

// ── Intent types ────────────────────────────────────────────────────────────

export type ConversationalIntent =
  | { type: 'wordpress_publish'; title?: string; imageUrl?: string; status: 'draft' | 'publish' }
  | { type: 'wordpress_list' }
  | { type: 'wordpress_schedule'; date?: string; title?: string }
  | { type: 'create_task'; title: string; description?: string }
  | { type: 'remember'; content: string }
  | { type: 'forget'; query: string }
  | { type: 'show_memories' }
  | { type: 'generate_image'; prompt: string }
  | { type: 'build_webpage'; description: string }
  | { type: 'none' };

// ── Intent detection patterns ───────────────────────────────────────────────

const WP_PUBLISH_PATTERNS = [
  /\b(post|publish|upload|put|send)\b.*\b(to|on)\s+(wordpress|wp|my site|my blog|the blog|the site|website)\b/i,
  /\b(wordpress|wp|blog)\b.*\b(post|publish|article|draft)\b/i,
  /\b(create|write|make)\b.*\b(blog post|article|post)\b.*\b(on|for|to)\b.*\b(wordpress|wp|site|blog)\b/i,
];

const WP_LIST_PATTERNS = [
  /\b(show|list|what|see)\b.*\b(my|the)?\s*(wordpress|wp|blog)\s*(posts?|articles?|drafts?)\b/i,
  /\bwhat('s| is)\b.*\bon\b.*\b(wordpress|wp|my blog|the blog)\b/i,
];

const WP_SCHEDULE_PATTERNS = [
  /\b(schedule|queue|plan)\b.*\b(post|article|blog)\b.*\b(for|on|next|this)\b/i,
];

const TASK_CREATE_PATTERNS = [
  /\b(create|add|make|open)\b.*\b(a\s+)?(task|todo|ticket|issue|work item)\b/i,
  /\b(task|todo)\b.*\b(for|to|about)\b/i,
];

const REMEMBER_PATTERNS = [
  /\b(remember|save|store|note|keep in mind)\b.*\b(that|this|:)\b/i,
  /\bremember\b/i,
];

const FORGET_PATTERNS = [
  /\b(forget|remove|delete|clear)\b.*\b(memory|that|the fact|what you know about)\b/i,
];

const SHOW_MEMORY_PATTERNS = [
  /\bwhat do you (remember|know)\b/i,
  /\b(show|list|see)\b.*\b(memories|memory|what you remember)\b/i,
];

const IMAGE_GEN_PATTERNS = [
  /\b(generate|create|make|draw|design)\b.*\b(image|picture|photo|illustration|artwork|logo|banner|icon)\b/i,
  /\b(image|picture|photo)\b.*\bof\b/i,
];

const WEBPAGE_PATTERNS = [
  /\b(build|create|make|generate)\b.*\b(web ?page|website|landing page|html page|site)\b/i,
];

// ── Detect intent ───────────────────────────────────────────────────────────

export function detectConversationalIntent(
  message: string,
  attachments?: Array<{ uri: string; type: string }>,
): ConversationalIntent {
  const lower = message.toLowerCase();

  // WordPress publish (with optional attached images)
  if (WP_PUBLISH_PATTERNS.some(p => p.test(message))) {
    // Try to extract a title from the message
    const titleMatch = message.match(/(?:titled?|called?|named?)\s*"([^"]+)"/i)
      || message.match(/(?:titled?|called?|named?)\s+([^,.]+)/i);
    const imageUrl = attachments?.find(a => a.type.startsWith('image/'))?.uri;
    const isPublish = /\b(publish|go live|make live|post it|put it live)\b/i.test(lower);
    return {
      type: 'wordpress_publish',
      title: titleMatch?.[1]?.trim(),
      imageUrl,
      status: isPublish ? 'publish' : 'draft',
    };
  }

  // WordPress list
  if (WP_LIST_PATTERNS.some(p => p.test(message))) {
    return { type: 'wordpress_list' };
  }

  // WordPress schedule
  if (WP_SCHEDULE_PATTERNS.some(p => p.test(message))) {
    const dateMatch = message.match(/(\d{4}-\d{2}-\d{2})/);
    const dayMatch = message.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    let date = dateMatch?.[1];
    if (!date && dayMatch) {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const target = days.indexOf(dayMatch[2].toLowerCase());
      const now = new Date();
      const diff = ((target - now.getDay()) + 7) % 7 || 7;
      const d = new Date(now.getTime() + diff * 86400000);
      date = d.toISOString().split('T')[0];
    }
    const titleMatch = message.match(/(?:titled?|called?|about)\s*"([^"]+)"/i)
      || message.match(/(?:about|on|titled?)\s+(.+?)(?:\s+for\s+|\s+on\s+|$)/i);
    return { type: 'wordpress_schedule', date, title: titleMatch?.[1]?.trim() };
  }

  // Task creation
  if (TASK_CREATE_PATTERNS.some(p => p.test(message))) {
    const titleMatch = message.match(/(?:task|todo|ticket)\s+(?:to|for|about|called|titled)\s+(.+)/i)
      || message.match(/(?:create|add|make|open)\s+(?:a\s+)?(?:task|todo)\s*[:\-]?\s*(.+)/i);
    return { type: 'create_task', title: titleMatch?.[1]?.trim() || message.slice(0, 80) };
  }

  // Remember
  if (REMEMBER_PATTERNS.some(p => p.test(message))) {
    const content = message
      .replace(/^(please\s+)?remember\s+(that\s+)?/i, '')
      .replace(/^(save|store|note|keep in mind)\s+(that\s+)?/i, '')
      .trim();
    if (content.length > 3) return { type: 'remember', content };
  }

  // Forget
  if (FORGET_PATTERNS.some(p => p.test(message))) {
    const query = message
      .replace(/^(please\s+)?(forget|remove|delete|clear)\s+(the\s+)?(memory|fact|that|what you know about)\s*/i, '')
      .trim();
    if (query.length > 2) return { type: 'forget', query };
  }

  // Show memories
  if (SHOW_MEMORY_PATTERNS.some(p => p.test(message))) {
    return { type: 'show_memories' };
  }

  // Image generation
  if (IMAGE_GEN_PATTERNS.some(p => p.test(message))) {
    return { type: 'generate_image', prompt: message };
  }

  // Webpage generation
  if (WEBPAGE_PATTERNS.some(p => p.test(message))) {
    return { type: 'build_webpage', description: message };
  }

  return { type: 'none' };
}

// ── Execute conversational intents ──────────────────────────────────────────

export async function executeConversationalIntent(
  intent: ConversationalIntent,
  context: {
    circleId: string;
    userId: string;
    userName?: string;
    fullMessage: string;
    attachments?: Array<{ uri: string; type: string; id: string }>;
  },
): Promise<{ handled: boolean; message: string; artifacts?: any[] } | null> {
  switch (intent.type) {
    case 'wordpress_publish':
    case 'wordpress_schedule': {
      try {
        const { getActiveWordPressCredentials, publishToWordPress } = await import('./siteAutomation');
        const { getSwanBotResponse } = await import('./swanbot');
        const creds = await getActiveWordPressCredentials();
        if (!creds) return { handled: true, message: 'No WordPress site connected. Go to **Integrations > WordPress** to add your site.' };

        // Use AI to write the content based on the message
        const title = intent.type === 'wordpress_publish' ? (intent.title || context.fullMessage.slice(0, 80)) : ((intent as any).title || context.fullMessage.slice(0, 80));
        const aiContent = await getSwanBotResponse(
          `Write a complete blog post based on this request: "${context.fullMessage}"\n\nWrite it in HTML suitable for WordPress. Include proper h2/h3 headings, paragraphs, formatting. At least 500 words. Return ONLY the HTML content.`,
          { userId: context.userId, circleId: context.circleId, userName: context.userName },
        );

        const status = intent.type === 'wordpress_schedule' ? 'draft' : (intent.type === 'wordpress_publish' ? intent.status : 'draft');
        const imageUrl = intent.type === 'wordpress_publish' ? intent.imageUrl : undefined;

        const result = await publishToWordPress({
          siteUrl: creds.siteUrl, username: creds.username, appPassword: creds.appPassword,
          title, content: aiContent, status: status as any,
          featuredImageUrl: imageUrl,
        });

        if (!result.success) return { handled: true, message: `WordPress publish failed: ${result.error}` };

        // Create a tracked task for this
        try {
          const { createRun, addStep, updateRunStatus, addArtifact } = await import('./agentRunSystem');
          const run = await createRun({
            circleId: context.circleId, userId: context.userId, surface: 'main_chat',
            title: `WordPress: ${title}`, mode: 'execute', provider: 'wordpress',
          });
          if (run) {
            await addStep({ runId: run.id, circleId: context.circleId, stepIndex: 0, stepKind: 'tool_call', title: 'Generated blog content', toolName: 'ai_write', body: `${aiContent.length} chars` });
            await addStep({ runId: run.id, circleId: context.circleId, stepIndex: 1, stepKind: 'tool_call', title: `Published to WordPress as ${status}`, toolName: 'wp_publish', body: `Post #${result.postId}` });
            await addArtifact({ runId: run.id, circleId: context.circleId, artifactKind: 'webpage', title, url: result.postUrl, content: aiContent.slice(0, 500) });
            await updateRunStatus(run.id, 'completed');
          }
        } catch {}

        return {
          handled: true,
          message: `**Published to WordPress** ${status === 'publish' ? '(LIVE)' : '(Draft)'}

| | |
|---|---|
| **Title** | ${title} |
| **ID** | ${result.postId} |
| **Status** | ${status.toUpperCase()} |
| **URL** | ${result.postUrl} |
${imageUrl ? `| **Image** | Attached |` : ''}

${status === 'draft' ? `Say "publish it" or use \`/wp publish ${result.postId}\` to go live.` : ''}`,
        };
      } catch (e: any) {
        return { handled: true, message: `WordPress error: ${e.message}` };
      }
    }

    case 'wordpress_list': {
      try {
        const { executeWpCommand } = await import('./wordpressChatCommands');
        const result = await executeWpCommand('/wp list', { circleId: context.circleId, userId: context.userId, userName: context.userName });
        return { handled: true, message: result.message };
      } catch (e: any) {
        return { handled: true, message: `WordPress error: ${e.message}` };
      }
    }

    case 'create_task': {
      try {
        const { createRun, addStep, updateRunStatus } = await import('./agentRunSystem');
        const run = await createRun({
          circleId: context.circleId, userId: context.userId, surface: 'main_chat',
          title: intent.title, goal: context.fullMessage, mode: 'execute',
        });
        if (run) {
          await addStep({ runId: run.id, circleId: context.circleId, stepIndex: 0, stepKind: 'plan', title: 'Task created', body: intent.title });
          await updateRunStatus(run.id, 'completed');
        }

        // Also create in the tasks table if it exists
        try {
          await supabase.from('tasks').insert({
            circle_id: context.circleId,
            title: intent.title,
            description: intent.description || context.fullMessage,
            status: 'todo',
            created_by: context.userId,
          });
        } catch {}

        return { handled: true, message: `**Task created:** ${intent.title}\n\nYou can find it in the Feed tab.` };
      } catch (e: any) {
        return { handled: true, message: `Failed to create task: ${e.message}` };
      }
    }

    case 'remember': {
      try {
        const { rememberFromChat } = await import('./memoryService');
        await rememberFromChat(context.circleId, context.userId, intent.content);
        return { handled: true, message: `Remembered: "${intent.content.slice(0, 100)}"` };
      } catch (e: any) {
        return { handled: true, message: `Memory error: ${e.message}` };
      }
    }

    case 'forget': {
      try {
        const { forgetFromChat } = await import('./memoryService');
        const { forgotten } = await forgetFromChat(context.circleId, context.userId, intent.query);
        return { handled: true, message: forgotten > 0 ? `Forgot ${forgotten} memor${forgotten === 1 ? 'y' : 'ies'} matching "${intent.query}".` : `No memories found matching "${intent.query}".` };
      } catch (e: any) {
        return { handled: true, message: `Memory error: ${e.message}` };
      }
    }

    case 'show_memories':
      return { handled: true, message: '__SHOW_MEMORIES__' }; // Special signal for UI

    default:
      return null;
  }
}
