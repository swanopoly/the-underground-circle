/**
 * User Chat Profile — Behavior Learning
 * Tracks user patterns and preferences to improve AI responses over time.
 * Persisted via AsyncStorage (cross-platform storage wrapper).
 */

import { storage } from './storage';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROFILE_KEY = '@chat_user_profile';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UserChatProfile {
  // Communication style
  averageMessageLength: 'short' | 'medium' | 'long';
  preferredTone: 'casual' | 'professional' | 'technical';
  topTopics: string[];

  // Preferences
  preferredResponseLength: 'brief' | 'detailed' | 'thorough';
  usesCodeOften: boolean;
  asksFollowUps: boolean;
  prefersStructuredOutput: boolean;

  // Interaction patterns
  totalMessages: number;
  totalSessions: number;
  averageSessionLength: number;
  peakHours: number[];

  // Agent preferences
  preferredModel: string | null;
  preferredMode: string | null;

  // Feedback signals
  messagesThatGotReplies: number;
  deletedBotMessages: number;

  // Recent context
  recentTopics: string[];
  lastInteraction: string;

  updatedAt: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function defaultProfile(): UserChatProfile {
  return {
    averageMessageLength: 'medium',
    preferredTone: 'casual',
    topTopics: [],
    preferredResponseLength: 'detailed',
    usesCodeOften: false,
    asksFollowUps: false,
    prefersStructuredOutput: false,
    totalMessages: 0,
    totalSessions: 0,
    averageSessionLength: 0,
    peakHours: [],
    preferredModel: null,
    preferredMode: null,
    messagesThatGotReplies: 0,
    deletedBotMessages: 0,
    recentTopics: [],
    lastInteraction: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Topic Detection ─────────────────────────────────────────────────────────

const TOPIC_PATTERNS: [RegExp, string][] = [
  [/\b(code|coding|program|function|variable|class|import|export|async|await|const|let|var)\b/i, 'code'],
  [/\b(design|ui|ux|layout|color|font|figma|css|style|component)\b/i, 'design'],
  [/\b(task|todo|ticket|backlog|sprint|kanban|jira)\b/i, 'task'],
  [/\b(bug|error|fix|crash|broken|issue|debug)\b/i, 'bug'],
  [/\b(feature|ship|build|implement|create|add)\b/i, 'feature'],
  [/\b(deploy|release|production|staging|ci|cd|pipeline)\b/i, 'deploy'],
  [/\b(test|spec|coverage|assertion|mock|jest|cypress)\b/i, 'test'],
  [/\b(review|pr|pull request|merge|approve|feedback)\b/i, 'review'],
  [/\b(plan|roadmap|strategy|goal|milestone|timeline)\b/i, 'plan'],
  [/\b(api|endpoint|rest|graphql|webhook|server)\b/i, 'api'],
  [/\b(database|sql|query|table|migration|schema)\b/i, 'database'],
  [/\b(streak|check.?in|accountability|habit)\b/i, 'accountability'],
];

function detectTopics(message: string): string[] {
  const found: string[] = [];
  for (const [pattern, topic] of TOPIC_PATTERNS) {
    if (pattern.test(message)) {
      found.push(topic);
    }
  }
  return found;
}

// ─── Load Profile ────────────────────────────────────────────────────────────

export async function loadUserProfile(): Promise<UserChatProfile> {
  try {
    const raw = await storage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle new fields added over time
      return { ...defaultProfile(), ...parsed };
    }
  } catch (err) {
    console.warn('[userChatProfile] Failed to load profile:', err);
  }
  return defaultProfile();
}

// ─── Save Profile ────────────────────────────────────────────────────────────

export async function saveUserProfile(profile: UserChatProfile): Promise<void> {
  try {
    profile.updatedAt = new Date().toISOString();
    await storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn('[userChatProfile] Failed to save profile:', err);
  }
}

// ─── Update from Message ─────────────────────────────────────────────────────

export function updateProfileFromMessage(
  profile: UserChatProfile,
  message: string,
  isUser: boolean
): UserChatProfile {
  const updated = { ...profile };

  if (isUser) {
    updated.totalMessages += 1;
    updated.lastInteraction = new Date().toISOString();

    // Track peak hours
    const hour = new Date().getHours();
    if (!updated.peakHours.includes(hour)) {
      updated.peakHours.push(hour);
      // Keep only the 5 most frequent hours
      if (updated.peakHours.length > 5) {
        updated.peakHours = updated.peakHours.slice(-5);
      }
    }

    // Analyze message length
    const len = message.length;
    if (len < 50) {
      // Bias toward 'short'
      if (updated.totalMessages > 5 && updated.averageMessageLength === 'long') {
        updated.averageMessageLength = 'medium';
      } else if (updated.totalMessages <= 5 || updated.averageMessageLength !== 'long') {
        updated.averageMessageLength = 'short';
      }
    } else if (len < 200) {
      updated.averageMessageLength = 'medium';
    } else {
      if (updated.averageMessageLength === 'short' && updated.totalMessages > 5) {
        updated.averageMessageLength = 'medium';
      } else {
        updated.averageMessageLength = 'long';
      }
    }

    // Detect code usage (backticks, function keywords)
    const hasCode = /```|`[^`]+`|\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bimport\b|\breturn\b|\basync\b/i.test(message);
    if (hasCode) {
      updated.usesCodeOften = true;
    }

    // Detect question marks -> follow-ups
    if (/\?/.test(message)) {
      updated.asksFollowUps = true;
    }

    // Detect structured requests (bullets, numbered lists)
    if (/^[\s]*[-*•]\s|^[\s]*\d+[.)]\s/m.test(message)) {
      updated.prefersStructuredOutput = true;
    }

    // Detect tone
    const casualIndicators = /\b(lol|haha|tbh|ngl|fam|yo|bruh|nah|yeah|lmao|bro)\b/i;
    const technicalIndicators = /\b(algorithm|architecture|implementation|abstraction|paradigm|interface|dependency|refactor)\b/i;
    const professionalIndicators = /\b(please|kindly|regarding|concerning|appreciate|schedule|deliverable)\b/i;

    if (technicalIndicators.test(message)) {
      updated.preferredTone = 'technical';
    } else if (professionalIndicators.test(message)) {
      updated.preferredTone = 'professional';
    } else if (casualIndicators.test(message)) {
      updated.preferredTone = 'casual';
    }
  }

  // Detect topics from any message
  const topics = detectTopics(message);
  if (topics.length > 0) {
    // Update recent topics (keep last 10)
    updated.recentTopics = [...topics, ...updated.recentTopics].slice(0, 10);

    // Update top topics (most frequently mentioned)
    for (const topic of topics) {
      if (!updated.topTopics.includes(topic)) {
        updated.topTopics.push(topic);
      }
    }
    // Keep top 8 topics
    if (updated.topTopics.length > 8) {
      updated.topTopics = updated.topTopics.slice(-8);
    }
  }

  // Infer preferred response length from user message length patterns
  if (isUser && updated.totalMessages > 3) {
    if (updated.averageMessageLength === 'short') {
      updated.preferredResponseLength = 'brief';
    } else if (updated.averageMessageLength === 'long') {
      updated.preferredResponseLength = 'thorough';
    } else {
      updated.preferredResponseLength = 'detailed';
    }
  }

  return updated;
}

// ─── Update from Deletion ────────────────────────────────────────────────────

export function updateProfileFromDeletion(profile: UserChatProfile): UserChatProfile {
  return {
    ...profile,
    deletedBotMessages: profile.deletedBotMessages + 1,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Update from Reply ───────────────────────────────────────────────────────

export function updateProfileFromReply(profile: UserChatProfile): UserChatProfile {
  return {
    ...profile,
    messagesThatGotReplies: profile.messagesThatGotReplies + 1,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Generate AI Context ─────────────────────────────────────────────────────

export function generateProfileContext(profile: UserChatProfile): string {
  // Only generate context if we have meaningful data
  if (profile.totalMessages < 3) return '';

  const lines: string[] = ['## User Profile'];

  lines.push(`- Communication style: ${profile.averageMessageLength} messages, ${profile.preferredTone} tone`);
  lines.push(`- Prefers ${profile.preferredResponseLength} responses`);
  lines.push(`- Uses code often: ${profile.usesCodeOften ? 'yes' : 'no'}`);

  if (profile.topTopics.length > 0) {
    lines.push(`- Top topics: ${profile.topTopics.join(', ')}`);
  }

  if (profile.recentTopics.length > 0) {
    lines.push(`- Recent topics: ${[...new Set(profile.recentTopics)].join(', ')}`);
  }

  lines.push(`- Active for ${profile.totalMessages} messages across ${profile.totalSessions} sessions`);

  const satisfactionParts: string[] = [];
  if (profile.messagesThatGotReplies > 0) {
    satisfactionParts.push(`${profile.messagesThatGotReplies}/${profile.totalMessages} replies`);
  }
  if (profile.deletedBotMessages > 0) {
    satisfactionParts.push(`${profile.deletedBotMessages} deleted`);
  }
  if (satisfactionParts.length > 0) {
    lines.push(`- Satisfaction: ${satisfactionParts.join(', ')}`);
  }

  if (profile.asksFollowUps) {
    lines.push(`- Frequently asks follow-up questions`);
  }

  if (profile.prefersStructuredOutput) {
    lines.push(`- Prefers structured/bulleted responses`);
  }

  return lines.join('\n');
}
