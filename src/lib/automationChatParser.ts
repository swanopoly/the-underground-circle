/**
 * automationChatParser — RN-free parser for "every X do Y" /
 * "when X do Y" automation requests typed in chat.
 *
 * Extracted from automationChatBuilder.ts so smoketests can import the
 * parsing logic without webpacking the React Native dep graph (which
 * comes in via supabase).
 *
 * Imported by automationChatBuilder.ts (which adds the DB-write
 * helper) and by ChatTab's automation intercept.
 */

import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';

export interface AutomationProposal {
  triggerType: 'schedule' | 'event';
  cronExpression?: string;
  scheduleSummary?: string;
  eventConfig?: { table: string; event: 'INSERT' | 'UPDATE' | 'DELETE' };
  name: string;
  description: string;
  prompt: string;
  outputTarget: 'activity' | 'chat' | 'silent';
  agent: string;
  confidence: number;
}

export function buildAutomationProposalInsertRow(opts: {
  proposal: AutomationProposal;
  circleId: string;
  userId: string;
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
}): Record<string, unknown> {
  const { proposal, circleId, userId, agentSubjectMetadata } = opts;
  const agentDisplayName = String(agentSubjectMetadata?.agentDisplayName || '').trim();
  const eventConfig = agentSubjectMetadata
    ? { ...(proposal.eventConfig || {}), agentSubjectMetadata }
    : proposal.eventConfig;
  const row: Record<string, unknown> = {
    circle_id: circleId,
    created_by: userId,
    name: proposal.name,
    description: proposal.description,
    icon: '⚡',
    trigger_type: proposal.triggerType,
    agent: agentDisplayName || proposal.agent,
    prompt: proposal.prompt,
    output_target: proposal.outputTarget,
    enabled: true,
  };
  if (proposal.triggerType === 'schedule' && proposal.cronExpression) {
    row.cron_expression = proposal.cronExpression;
  }
  if (eventConfig) {
    row.event_config = eventConfig;
  }
  return row;
}

const DAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const TIME_OF_DAY: Record<string, [number, number]> = {
  morning: [9, 0],
  noon: [12, 0],
  afternoon: [15, 0],
  evening: [18, 0],
  night: [21, 0],
  midnight: [0, 0],
};

export function looksLikeAutomationRequest(input: string): boolean {
  const lower = input.toLowerCase().trim();
  if (lower.length < 10) return false;
  const triggerKeywords = /\b(every|each|daily|weekly|hourly|monthly|when|whenever|on every|automate|schedule|set up|create.*automation)\b/i;
  if (!triggerKeywords.test(lower)) return false;
  const actionKeywords = /\b(post|send|run|summarize|remind|alert|notify|do|tell|generate|create|make|share|email|update)\b/i;
  return actionKeywords.test(lower);
}

function parseTimeOfDay(s: string): [number, number] | null {
  const trimmed = s.trim().toLowerCase();
  if (TIME_OF_DAY[trimmed]) return TIME_OF_DAY[trimmed];
  let m = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const isPM = m[3].startsWith('p');
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) return [h, min];
  }
  m = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) return [h, min];
  }
  m = trimmed.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 0 && h <= 23) return [h, 0];
  }
  return null;
}

function buildCron(opts: {
  minute?: number;
  hour?: number;
  dayOfWeek?: number | '*';
  interval?: { unit: 'minute' | 'hour'; value: number };
}): string {
  if (opts.interval) {
    if (opts.interval.unit === 'minute') return `*/${opts.interval.value} * * * *`;
    return `0 */${opts.interval.value} * * *`;
  }
  const m = typeof opts.minute === 'number' ? opts.minute : 0;
  const h = typeof opts.hour === 'number' ? opts.hour : 0;
  const dow = opts.dayOfWeek === undefined || opts.dayOfWeek === '*' ? '*' : String(opts.dayOfWeek);
  return `${m} ${h} * * ${dow}`;
}

function summarizeSchedule(opts: {
  hour: number; minute: number; dayOfWeek?: number; daily?: boolean;
}): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ampm = opts.hour >= 12 ? 'PM' : 'AM';
  const h12 = opts.hour === 0 ? 12 : opts.hour > 12 ? opts.hour - 12 : opts.hour;
  const mm = opts.minute.toString().padStart(2, '0');
  const time = `${h12}:${mm} ${ampm}`;
  if (opts.daily) return `Every day at ${time}`;
  if (typeof opts.dayOfWeek === 'number') return `Every ${dayNames[opts.dayOfWeek]} at ${time}`;
  return `At ${time}`;
}

export function parseAutomationRequest(input: string): AutomationProposal | null {
  if (!looksLikeAutomationRequest(input)) return null;
  const lower = input.toLowerCase().trim();

  const dayWordsAlt = Object.keys(DAYS).join('|');
  const m1 = lower.match(new RegExp(`every\\s+(${dayWordsAlt}|day|night|morning|afternoon|evening)(?:\\s+at\\s+([\\w\\d:.\\s]+?))?\\s+(?:to\\s+)?(post|send|run|summarize|remind|alert|notify|do|tell|generate|create|make|share|update)\\s+(.+)$`));
  if (m1) {
    const [, dayWord, timeStr, verb, body] = m1;
    let dayOfWeek: number | '*' | undefined;
    let daily = false;
    if (dayWord === 'day' || dayWord === 'morning' || dayWord === 'night' || dayWord === 'afternoon' || dayWord === 'evening') {
      daily = true;
      if (!timeStr && TIME_OF_DAY[dayWord]) {
        const [h, m] = TIME_OF_DAY[dayWord];
        return finalize(verb, body, { hour: h, minute: m, daily: true });
      }
    } else {
      dayOfWeek = DAYS[dayWord];
    }
    const time = timeStr ? parseTimeOfDay(timeStr) : [9, 0] as [number, number];
    if (!time) return null;
    return finalize(verb, body, daily
      ? { hour: time[0], minute: time[1], daily: true }
      : { hour: time[0], minute: time[1], dayOfWeek: dayOfWeek as number });
  }

  const m2 = lower.match(/^(daily|weekly|hourly|monthly)\s+(?:to\s+)?(post|send|run|summarize|remind|alert|notify|do|tell|generate|create|make|share|update)\s+(.+)$/);
  if (m2) {
    const [, cadence, verb, body] = m2;
    const cronByCadence: Record<string, string> = {
      daily:   '0 9 * * *',
      weekly:  '0 9 * * 1',
      hourly:  '0 * * * *',
      monthly: '0 9 1 * *',
    };
    const summaryByCadence: Record<string, string> = {
      daily: 'Every day at 9:00 AM',
      weekly: 'Every Monday at 9:00 AM',
      hourly: 'Every hour',
      monthly: 'On the 1st of every month at 9:00 AM',
    };
    return finalize(verb, body, {
      explicitCron: cronByCadence[cadence],
      explicitSummary: summaryByCadence[cadence],
    });
  }

  const m3 = lower.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours)\s+(?:to\s+)?(post|send|run|summarize|remind|alert|notify|do|tell|generate|create|make|share|update)\s+(.+)$/);
  if (m3) {
    const [, n, unit, verb, body] = m3;
    const value = parseInt(n, 10);
    if (value > 0 && value <= 60) {
      const u = unit.startsWith('minute') ? 'minute' : 'hour' as const;
      return finalize(verb, body, { interval: { unit: u, value } });
    }
  }

  const m4 = lower.match(/^when(?:ever)?\s+(.+?)\s+(post|send|run|summarize|remind|alert|notify|do|tell|generate|create|make|share|update)\s+(.+)$/);
  if (m4) {
    const [, eventDesc, verb, body] = m4;
    const eventConfig = inferEventConfig(eventDesc);
    if (eventConfig) {
      return {
        triggerType: 'event',
        eventConfig,
        name: deriveName(verb, body),
        description: `When ${eventDesc.trim()} → ${verb} ${body.trim()}`,
        prompt: buildPrompt(verb, body),
        outputTarget: 'activity',
        agent: 'BlackSwan',
        confidence: 0.6,
      };
    }
  }

  return null;
}

/**
 * Schedule a known computer task on a recurring cadence (D7b — "that
 * worked, run it every Friday"). The user supplies just the cadence
 * phrase ("friday at 9am", "day at 8am", "weekly"); the task text is
 * already known from the completed run. Reuses the existing cadence
 * grammar by composing a synthetic request, then overrides name/prompt so
 * the ORIGINAL task text survives verbatim — the derived prompt heuristics
 * are for loose chat phrasing, not for an exact task we already trust.
 */
export function parseComputerTaskSchedule(args: {
  task: string;
  schedulePhrase: string;
  taskLabel?: string | null;
}): AutomationProposal | null {
  const task = String(args.task || '').replace(/\s+/g, ' ').trim();
  const phrase = String(args.schedulePhrase || '').replace(/\s+/g, ' ').trim()
    .replace(/^every\s+/i, '');
  if (!task || !phrase) return null;

  // Two compositions cover the grammar: "every <phrase> run <task>" (day /
  // time / interval forms) and "<phrase> run <task>" (daily/weekly/etc.).
  const parsed = parseAutomationRequest(`every ${phrase} run ${task}`)
    || parseAutomationRequest(`${phrase} run ${task}`);
  if (!parsed || parsed.triggerType !== 'schedule') return null;

  const label = String(args.taskLabel || '').trim() || task.slice(0, 50);
  return {
    ...parsed,
    name: `Run: ${label}`.slice(0, 60),
    description: `${parsed.scheduleSummary || 'On schedule'} — re-run the computer task.`,
    prompt: `Run this computer task exactly as written: ${task}`,
    outputTarget: 'chat',
    confidence: Math.max(parsed.confidence, 0.85),
  };
}

function inferEventConfig(eventDesc: string): { table: string; event: 'INSERT' | 'UPDATE' | 'DELETE' } | null {
  const d = eventDesc.toLowerCase();
  if (/\bcheck(?:s|ed|ing)?[ -]?in\b|\bstandup\b/.test(d))               return { table: 'check_ins', event: 'INSERT' };
  if (/\b(message|chat)s?\b/.test(d))                                     return { table: 'messages', event: 'INSERT' };
  if (/\btask.*(done|completed?|finish(?:ed|es)?)\b/.test(d))             return { table: 'tasks', event: 'UPDATE' };
  if (/\btask.*(create[ds]?|new|added)\b/.test(d))                        return { table: 'tasks', event: 'INSERT' };
  if (/\bmission.*(completed?|done)\b/.test(d))                            return { table: 'circle_missions', event: 'UPDATE' };
  if (/\b(github|push(?:es|ed)?|commit(?:s|ted)?|pr)\b/.test(d))           return { table: 'circle_github_events', event: 'INSERT' };
  if (/\bproof\b/.test(d))                                                 return { table: 'proof_of_work', event: 'INSERT' };
  return null;
}

function deriveName(verb: string, body: string): string {
  const trimmed = body.trim().replace(/[.!?]+$/, '');
  const words = trimmed.split(/\s+/).slice(0, 6).join(' ');
  const v = verb.charAt(0).toUpperCase() + verb.slice(1);
  return `${v} ${words}`.slice(0, 60);
}

function buildPrompt(verb: string, body: string): string {
  const trimmed = body.trim().replace(/[.!?]+$/, '');
  return `Please ${verb} ${trimmed}. Use the circle's recent context (members, check-ins, tasks, GitHub events when available) to make the response specific and useful.`;
}

interface ScheduleArgs {
  hour?: number; minute?: number; dayOfWeek?: number; daily?: boolean;
  interval?: { unit: 'minute' | 'hour'; value: number };
  explicitCron?: string; explicitSummary?: string;
}

function finalize(verb: string, body: string, args: ScheduleArgs): AutomationProposal {
  const cron = args.explicitCron ?? buildCron({
    minute: args.minute,
    hour: args.hour,
    dayOfWeek: args.dayOfWeek ?? (args.daily ? '*' : '*'),
    interval: args.interval,
  });
  let summary = args.explicitSummary;
  if (!summary) {
    if (args.interval) {
      summary = `Every ${args.interval.value} ${args.interval.unit}${args.interval.value === 1 ? '' : 's'}`;
    } else {
      summary = summarizeSchedule({
        hour: args.hour ?? 9,
        minute: args.minute ?? 0,
        dayOfWeek: args.dayOfWeek,
        daily: args.daily,
      });
    }
  }
  return {
    triggerType: 'schedule',
    cronExpression: cron,
    scheduleSummary: summary,
    name: deriveName(verb, body),
    description: `${summary} → ${verb} ${body.trim()}`,
    prompt: buildPrompt(verb, body),
    outputTarget: 'activity',
    agent: 'BlackSwan',
    confidence: 0.85,
  };
}
