/**
 * chatAutomationSuggestions
 *
 * Turns repeated chat automation decisions into concrete automation
 * proposals. `repeatedFlowDetection` finds the pattern; this file decides
 * whether that pattern is schedule-worthy and shapes it for the existing
 * AutomationProposalCard/createAutomationFromProposal path.
 */

import type { AutomationProposal } from './automationChatParser';
import type { ChatAutomationDecisionRow } from './chatAutomationDecisions';
import {
  detectRepeatedFlows,
  type RepeatedFlowOptions,
  type RepeatedFlowSuggestion,
} from './repeatedFlowDetection';

export type ChatRepeatedAutomationProposal = {
  id: string;
  fingerprint: string;
  message: string;
  proposal: AutomationProposal;
  sourceSuggestion: RepeatedFlowSuggestion;
};

type BuildOptions = RepeatedFlowOptions & {
  now?: Date;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function cleanTaskText(value: string | null | undefined, fallback: string): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function titleCaseRoute(value: string | null): string {
  const raw = String(value || '').replace(/[_-]+/g, ' ').trim();
  if (!raw) return 'chat';
  return raw.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatUtcTime(date: Date): string {
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm} UTC`;
}

function scheduleFromSuggestion(suggestion: RepeatedFlowSuggestion): {
  cronExpression: string;
  scheduleSummary: string;
} | null {
  const last = new Date(suggestion.lastAt);
  if (!Number.isFinite(last.getTime())) return null;
  const minute = last.getUTCMinutes();
  const hour = last.getUTCHours();

  if (suggestion.cadence === 'daily') {
    return {
      cronExpression: `${minute} ${hour} * * *`,
      scheduleSummary: `Every day at ${formatUtcTime(last)}`,
    };
  }

  if (suggestion.cadence === 'multi_day') {
    const day = last.getUTCDay();
    return {
      cronExpression: `${minute} ${hour} * * ${day}`,
      scheduleSummary: `Every ${WEEKDAYS[day]} at ${formatUtcTime(last)}`,
    };
  }

  if (suggestion.cadence === 'hourly' || suggestion.cadence === 'under_hour') {
    return {
      cronExpression: `${minute} * * * *`,
      scheduleSummary: `Every hour at minute ${String(minute).padStart(2, '0')}`,
    };
  }

  return null;
}

export function buildAutomationProposalFromRepeatedFlow(
  suggestion: RepeatedFlowSuggestion,
): AutomationProposal | null {
  const schedule = scheduleFromSuggestion(suggestion);
  if (!schedule) return null;

  const route = titleCaseRoute(suggestion.routeId);
  const task = cleanTaskText(
    suggestion.commandFingerprint,
    `${suggestion.executionKind}${suggestion.routeId ? ` on ${suggestion.routeId}` : ''}`,
  );
  const occurrenceLabel = `${suggestion.occurrences} time${suggestion.occurrences === 1 ? '' : 's'}`;
  const successPct = Math.round(suggestion.successRatio * 100);

  return {
    triggerType: 'schedule',
    cronExpression: schedule.cronExpression,
    scheduleSummary: schedule.scheduleSummary,
    name: `Repeat ${route} workflow`.slice(0, 60),
    description: `Suggested after ${occurrenceLabel} with ${successPct}% completion.`,
    prompt: `Run this saved chat workflow exactly as written: ${task}`,
    outputTarget: 'chat',
    agent: 'OpenSwan',
    confidence: Math.max(0.7, Math.min(0.98, suggestion.successRatio)),
  };
}

export function buildRepeatedFlowAutomationProposals(
  rows: ChatAutomationDecisionRow[],
  opts: BuildOptions = {},
): ChatRepeatedAutomationProposal[] {
  const suggestions = detectRepeatedFlows(rows, {
    minOccurrences: opts.minOccurrences,
    regularityCvThreshold: opts.regularityCvThreshold,
    minSuccessRatio: opts.minSuccessRatio,
    maxSuggestions: opts.maxSuggestions ?? 3,
  });

  return suggestions.flatMap((suggestion) => {
    const proposal = buildAutomationProposalFromRepeatedFlow(suggestion);
    if (!proposal) return [];
    return [{
      id: `repeated-flow:${suggestion.fingerprint}`,
      fingerprint: suggestion.fingerprint,
      message: `You have run this ${suggestion.occurrences} times. Save it as an automation?`,
      proposal,
      sourceSuggestion: suggestion,
    }];
  });
}
