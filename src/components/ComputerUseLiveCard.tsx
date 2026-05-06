/**
 * ComputerUseLiveCard — inline chat card that shows the Computer Use
 * agent working autonomously. Streams reasoning, actions, and screenshots
 * as they arrive. When the agent finishes, collapses to a summary with
 * the final screenshot + a link to the live Browserbase session.
 *
 * Designed to feel like Perplexity's Personal Computer surface: the user
 * can watch the agent think, see what it sees, and trust what it returns.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MorphingDots from './MorphingDots';
import { planClarifyTimeout, formatCountdown } from '../lib/clarifyTimeout';

export type LiveAction = { tool: string; input: any; at: number };
export type LiveScreenshot = { b64: string; url?: string; at: number };

export interface ComputerUseLiveCardProps {
  task: string;
  status: 'starting' | 'running' | 'done' | 'error';
  sessionId?: string | null;
  liveUrl?: string | null;
  reasoning: string[];
  actions: LiveAction[];
  screenshots: LiveScreenshot[];
  /** Set when status is `done`. */
  result?: {
    summary: string;
    iterations: number;
    tokens: { input: number; output: number };
    findings?: Array<{
      title: string;
      url?: string;
      price?: string;
      rating?: string;
      notes?: string;
      thumbnail?: string;
    }> | null;
    extractedData?: unknown | null;
  } | null;
  /** Set when status is `error`. */
  errorMessage?: string | null;
  accentColor?: string;
  onCancel?: () => void;
  /** When provided, the post-completion view renders one-tap follow-up /
   *  re-run chips. Each hands back the full follow-up prompt so the
   *  caller just passes it to the Computer Use agent again. */
  onFollowUp?: (prompt: string) => void;
  /** Follow-up suggestions to show. Caller picks them (usually from
   *  `FOLLOW_UP_SUGGESTIONS` in computerUseTemplates). */
  followUpSuggestions?: string[];
  /** Mid-run approval request. When present, the card shows the
   *  question + options and pauses everything else until the user picks. */
  pendingConfirmation?: {
    id: string | null;
    question: string;
    options: string[];
    context: string | null;
    timeoutSec: number;
    /** CA-8e: ISO timestamp of when the confirmation row was created.
     *  When present, the card renders a live countdown + urgent state
     *  via planClarifyTimeout. Optional because existing callers may
     *  not thread it yet — without it the card behaves as before. */
    createdAtIso?: string;
  } | null;
  /** Called with the picked option when the user decides. Caller writes
   *  it to the DB (`resolveComputerUseConfirmation`). */
  onConfirmationPick?: (id: string | null, choice: string) => void;
  /** Live token/cost ticker. When present, renders a small chip in the
   *  header showing running tokens + estimated USD cost. The three
   *  optional `*Tokens` fields enable a cache-hit-rate indicator that
   *  only shows when prompt caching is actually saving tokens. */
  usage?: {
    iteration: number;
    inputTokens: number;
    outputTokens: number;
    uncachedInputTokens?: number;
    cacheCreateTokens?: number;
    cacheReadTokens?: number;
    estimatedCost: number;
  } | null;
  /** When set, renders a "COPY MD" button in the result box that invokes
   *  this callback. Caller handles serialization + clipboard write. */
  onCopyMarkdown?: () => void;
  /** When set, renders a "SAVE AS TEMPLATE" button in the result box. */
  onSaveTemplate?: () => void;
  /** When set, and the error message looks like a budget-cap error, the
   *  error box renders an "OPEN SETTINGS" shortcut that invokes this. The
   *  caller wires it to navigation (Circle Settings → Budget section). */
  onOpenSettings?: () => void;
  /** Matches the edge function's `maxIterations` default (20). Used to
   *  render the step-progress bar. Pass explicitly if the caller bumped
   *  it; otherwise this default is correct. */
  maxIterations?: number;
}

/** Format a USD cost for the header pill. Below $0.01 shows 4 decimals
 *  (task is still small), $0.01–$1 shows 3, above $1 shows 2. Keeps the
 *  pill from feeling dense while preserving precision where it matters. */
function formatPillCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1)    return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** Compact token count — 1,234 → "1.2K", 1,234,567 → "1.23M". Keeps the
 *  pill one line at small card widths. */
function formatTokenShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// "Budget cap reached" or "Daily cap reached" from the edge function.
function isBudgetError(msg: string): boolean {
  return /\b(budget|daily)\s+cap\b/i.test(msg) || /raise the cap/i.test(msg);
}

function formatExtractedDataPreview(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 2500 ? `${json.slice(0, 2500)}\n...truncated` : json;
  } catch {
    return String(value ?? '');
  }
}

/** 2-letter action-verb badge for the timeline strip. Keeps the
 *  thumbnail clean while giving each frame a glance-able "what just
 *  happened here". Pairs with `formatAction` which produces a
 *  full sentence. */
function formatActionVerb(a: LiveAction | undefined): { code: string; tone: string } {
  if (!a) return { code: '··', tone: '#475569' };
  const inp = a.input || {};
  const action = typeof inp.action === 'string' ? inp.action : '';
  if (a.tool === 'ask_user')      return { code: 'AS', tone: '#fbbf24' };
  if (a.tool === 'bash')          return { code: 'SH', tone: '#a855f7' };
  switch (action) {
    case 'screenshot':            return { code: 'SS', tone: '#64748b' };
    case 'left_click':            return { code: 'CL', tone: '#22d3ee' };
    case 'right_click':           return { code: 'RC', tone: '#22d3ee' };
    case 'double_click':          return { code: 'DC', tone: '#22d3ee' };
    case 'triple_click':          return { code: 'TC', tone: '#22d3ee' };
    case 'mouse_move':            return { code: 'MV', tone: '#94a3b8' };
    case 'type':                  return { code: 'TY', tone: '#22c55e' };
    case 'key':                   return { code: 'KE', tone: '#22c55e' };
    case 'scroll':                return { code: 'SC', tone: '#94a3b8' };
    case 'wait':                  return { code: 'WT', tone: '#475569' };
    case 'navigate':              return { code: 'NV', tone: '#8b5cf6' };
    default:                      return { code: action ? action.slice(0, 2).toUpperCase() : '??', tone: '#475569' };
  }
}

// Pretty-print a raw tool action for the "NOW:" preview strip. Maps the
// Anthropic computer-use action names to human-readable verbs and surfaces
// the most relevant input field (url for navigate, text for type, etc.).
function formatAction(a: LiveAction): string {
  const inp = a.input || {};
  const action = typeof inp.action === 'string' ? inp.action : '';
  if (a.tool === 'ask_user') return `Waiting for approval: ${String(inp.question || '').slice(0, 80)}`;
  if (a.tool === 'bash') return `Running bash: ${String(inp.command || '').slice(0, 60)}`;
  switch (action) {
    case 'screenshot': return 'Taking a screenshot';
    case 'left_click': return `Clicking at (${inp.coordinate?.[0]}, ${inp.coordinate?.[1]})`;
    case 'right_click': return `Right-clicking at (${inp.coordinate?.[0]}, ${inp.coordinate?.[1]})`;
    case 'double_click': return `Double-clicking at (${inp.coordinate?.[0]}, ${inp.coordinate?.[1]})`;
    case 'mouse_move': return `Moving mouse to (${inp.coordinate?.[0]}, ${inp.coordinate?.[1]})`;
    case 'type': return `Typing: "${String(inp.text || '').slice(0, 60)}"`;
    case 'key': return `Pressing key: ${String(inp.text || '')}`;
    case 'scroll': return `Scrolling ${String(inp.scroll_direction || 'down')}`;
    case 'wait': return `Waiting ${inp.duration ?? 1}s`;
    default: return action ? `Running ${action}` : `Using ${a.tool}`;
  }
}

/**
 * Countdown text for the pending-confirmation header. Ticks once a
 * second via a 1Hz setInterval, renders via `planClarifyTimeout`
 * + `formatCountdown` from `lib/clarifyTimeout.ts` so the math stays
 * in one place. No-op when `createdAtIso` isn't threaded — older
 * callers still render without a countdown.
 */
function ConfirmCountdown(props: { createdAtIso?: string; timeoutSec: number }): React.ReactElement | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.createdAtIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.createdAtIso]);

  if (!props.createdAtIso) return null;
  const plan = planClarifyTimeout({
    createdAt: props.createdAtIso,
    timeoutMs: Math.max(15_000, (props.timeoutSec || 120) * 1000),
    now,
  });
  return (
    <Text style={[s.confirmCountdown, plan.urgent && s.confirmCountdownUrgent]}>
      {formatCountdown(plan.msUntilExpiry)}
    </Text>
  );
}

export default function ComputerUseLiveCard(props: ComputerUseLiveCardProps) {
  const accent = props.accentColor || '#22d3ee';
  const maxIterations = props.maxIterations ?? 20;

  // Pinned frame — when a user taps a timeline thumbnail we freeze the
  // main preview to that frame. `null` means "follow the latest" which
  // is the streaming default. Clears automatically on status transitions
  // so the user doesn't get stuck on a stale frame when a new task runs.
  const [pinnedFrameIdx, setPinnedFrameIdx] = useState<number | null>(null);
  useEffect(() => {
    if (props.status === 'starting' || props.status === 'done') setPinnedFrameIdx(null);
  }, [props.status]);

  const visibleFrameIdx = pinnedFrameIdx !== null && pinnedFrameIdx < props.screenshots.length
    ? pinnedFrameIdx
    : props.screenshots.length - 1;
  const visibleScreenshot = visibleFrameIdx >= 0 ? props.screenshots[visibleFrameIdx] : null;

  const latestReasoning = props.reasoning.length
    ? props.reasoning[props.reasoning.length - 1]
    : '';

  // Keep the reasoning scroll view pinned to the bottom so new thoughts
  // stream into view without the user having to scroll.
  const reasoningRef = useRef<ScrollView>(null);
  useEffect(() => {
    reasoningRef.current?.scrollToEnd?.({ animated: true });
  }, [props.reasoning.length]);

  // Keep the thumbnail strip auto-scrolling to the latest frame while the
  // user hasn't pinned one. When they pin, stop auto-scrolling.
  const timelineRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (pinnedFrameIdx === null) {
      timelineRef.current?.scrollToEnd?.({ animated: true });
    }
  }, [props.screenshots.length, pinnedFrameIdx]);

  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    // Auto-collapse when the task finishes so the chat doesn't feel busy.
    if (props.status === 'done') setExpanded(false);
  }, [props.status]);

  // Step progress: actions.length / maxIterations, capped at 1. Visible
  // whenever there's activity. Green when done, accent while running.
  const stepPct = Math.min(1, props.actions.length / maxIterations);
  const stepBarColor = props.status === 'done'
    ? '#22c55e'
    : props.status === 'error'
      ? '#ef4444'
      : accent;

  const statusLabel = (() => {
    switch (props.status) {
      case 'starting': return 'STARTING';
      case 'running': return 'WORKING';
      case 'done': return 'DONE';
      case 'error': return 'ERROR';
    }
  })();
  const statusColor = props.status === 'error'
    ? '#ef4444'
    : props.status === 'done'
      ? '#22c55e'
      : accent;

  return (
    <View style={[s.card, { borderColor: `${statusColor}55` }]}>
      {/* Header — entire row is tappable to expand/collapse. Bigger hit
          area than the tiny ▾ chevron. The cost pill has its own hit
          area (it's a plain View, not a nested Pressable). */}
      <Pressable
        nativeID="cu-card-header"
        onPress={() => setExpanded((v) => !v)}
        style={s.header}
        accessibilityRole="button"
        accessibilityLabel={`${statusLabel} task. ${expanded ? 'Collapse' : 'Expand'} details.`}
        accessibilityState={{ expanded }}
      >
        <View style={[s.dot, { backgroundColor: statusColor }]} />
        <Text style={[s.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        <Text style={s.taskText} numberOfLines={2}>{props.task}</Text>
        {props.usage ? (() => {
          const read = props.usage.cacheReadTokens ?? 0;
          // Hit rate = cache-read tokens as a fraction of total input-side
          // tokens. Only surface it once it's materially non-zero so the
          // first turn (no cache yet) doesn't show "0% cached".
          const totalIn = props.usage.inputTokens || 1;
          const hitPct = Math.round((read / totalIn) * 100);
          const showHit = read > 500 && hitPct > 0;
          const totalTokens = props.usage.inputTokens + props.usage.outputTokens;
          return (
            <View style={s.usagePill}>
              <Text style={s.usagePillText}>
                {formatPillCost(props.usage.estimatedCost)} · {formatTokenShort(totalTokens)}t
                {showHit ? ` · ${hitPct}%↻` : ''}
              </Text>
            </View>
          );
        })() : null}
        {/* Chevron now purely decorative — the whole header is the hit
            target. Keep the glyph so users still see the "this is
            expandable" affordance. */}
        <Text style={s.toggleText}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {/* Step progress: a tiny "STEP n/N" label + the fill bar. Only
          renders once the agent has actually started acting so the card
          doesn't show a stale 0% bar in the starting phase. */}
      {(props.status === 'running' || props.status === 'done' || props.status === 'error')
       && props.actions.length > 0 ? (
        <View style={{ gap: 3, marginTop: -2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Text style={[s.stepCountText, { color: stepBarColor }]}>
              STEP {props.actions.length}/{maxIterations}
            </Text>
          </View>
          <View style={s.stepBarTrack}>
            <View style={[s.stepBarFill, {
              width: `${stepPct * 100}%`,
              backgroundColor: stepBarColor,
            }]} />
          </View>
        </View>
      ) : null}

      {/* Latest action preview — compact strip under the header so the
          user always knows what the agent's current intent is, even if
          they've collapsed the body. */}
      {(props.status === 'running' || props.status === 'starting') && props.actions.length > 0 ? (
        <View style={s.actionPreview}>
          <Text style={s.actionPreviewLabel}>NOW:</Text>
          <Text style={s.actionPreviewText} numberOfLines={1}>
            {formatAction(props.actions[props.actions.length - 1])}
          </Text>
        </View>
      ) : null}

      {/* Mid-run approval request — always on top, always visible, even
          when the body is collapsed. The agent is paused until the user
          picks an option (or the server times out at 2 minutes). */}
      {props.pendingConfirmation ? (
        <View style={s.confirmBox}>
          <View style={s.confirmHeaderRow}>
            <Text style={s.confirmLabel}>APPROVAL REQUIRED</Text>
            <ConfirmCountdown
              createdAtIso={props.pendingConfirmation.createdAtIso}
              timeoutSec={props.pendingConfirmation.timeoutSec}
            />
          </View>
          <Text style={s.confirmQuestion}>{props.pendingConfirmation.question}</Text>
          {props.pendingConfirmation.context ? (
            <Text style={s.confirmContext}>{props.pendingConfirmation.context}</Text>
          ) : null}
          <View style={s.confirmOptions}>
            {props.pendingConfirmation.options.map((opt) => {
              const isReject = /^no/i.test(opt) || /cancel/i.test(opt) || /stop/i.test(opt);
              const isApprove = /^yes/i.test(opt) || /continue/i.test(opt) || /confirm/i.test(opt);
              const tone = isApprove ? '#22c55e' : isReject ? '#ef4444' : '#38bdf8';
              return (
                <Pressable
                  key={opt}
                  onPress={() => props.onConfirmationPick?.(props.pendingConfirmation!.id, opt)}
                  style={[s.confirmBtn, { borderColor: `${tone}88`, backgroundColor: `${tone}15` }]}
                  accessibilityRole="button"
                >
                  <Text style={[s.confirmBtnText, { color: tone }]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Body */}
      {expanded ? (
        <View style={s.body}>
          {/* Main screenshot — either the latest (streaming) or a frame
              the user pinned via the timeline strip below. */}
          {visibleScreenshot ? (
            <View style={s.screenshotWrap}>
              <Image
                source={{ uri: `data:image/png;base64,${visibleScreenshot.b64}` }}
                style={s.screenshot}
                resizeMode="contain"
              />
              {visibleScreenshot.url ? (
                <Text style={s.screenshotUrl} numberOfLines={1}>{visibleScreenshot.url}</Text>
              ) : null}
              {/* Pinned frame indicator — subtle "VIEWING FRAME n/N" badge
                  with a one-tap "JUMP TO LIVE" button to un-pin. */}
              {pinnedFrameIdx !== null && pinnedFrameIdx < props.screenshots.length - 1 ? (
                <View style={s.pinBadge}>
                  <Text style={s.pinBadgeText}>
                    FRAME {pinnedFrameIdx + 1}/{props.screenshots.length}
                  </Text>
                  <Pressable
                    onPress={() => setPinnedFrameIdx(null)}
                    style={s.pinBadgeBtn}
                    accessibilityRole="button"
                  >
                    <Text style={[s.pinBadgeBtnText, { color: accent }]}>JUMP TO LIVE ↓</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[s.screenshotWrap, { alignItems: 'center', justifyContent: 'center', minHeight: 120 }]}>
              <MorphingDots size={22} dotSize={2.5} />
              <Text style={{ color: '#64748b', fontSize: 10, marginTop: 6, letterSpacing: 0.6 }}>
                OPENING BROWSER…
              </Text>
            </View>
          )}

          {/* Screenshot timeline — horizontal strip of frame thumbnails
              the user can tap to scrub through history. Auto-scrolls to
              the latest while unpinned so live frames slide in. Only
              renders when there are 2+ frames (no point scrubbing one). */}
          {props.screenshots.length >= 2 ? (
            <ScrollView
              ref={timelineRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.timelineContent}
              style={s.timelineStrip}
            >
              {props.screenshots.map((frame, idx) => {
                const isPinned = pinnedFrameIdx === idx;
                const isLiveFollow = pinnedFrameIdx === null && idx === props.screenshots.length - 1;
                const isActive = isPinned || isLiveFollow;
                // Actions and screenshots are typically emitted in pairs
                // (action → screenshot from the edge function's tool loop),
                // so actions[idx] is usually the action that produced
                // screenshots[idx]. Falls back cleanly to '··' when they
                // drift or the action list is shorter.
                const verb = formatActionVerb(props.actions[idx]);
                return (
                  <Pressable
                    key={idx}
                    nativeID={`cu-card-thumb-${idx}`}
                    onPress={() => {
                      // Tapping the latest while following un-pins (no-op visually).
                      // Tapping any other frame pins it.
                      setPinnedFrameIdx(idx === props.screenshots.length - 1 ? null : idx);
                    }}
                    style={[
                      s.timelineThumb,
                      isActive && { borderColor: accent, borderWidth: 1.5 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`View frame ${idx + 1}, action ${verb.code}`}
                  >
                    <Image
                      source={{ uri: `data:image/png;base64,${frame.b64}` }}
                      style={s.timelineThumbImg}
                      resizeMode="cover"
                    />
                    {/* Verb badge (top-left) — tells the user at a glance
                        whether this frame was a click, type, scroll, etc. */}
                    <View style={[s.timelineThumbVerbPill, { borderColor: `${verb.tone}88` }]}>
                      <Text style={[s.timelineThumbVerbText, { color: verb.tone }]}>{verb.code}</Text>
                    </View>
                    {/* Index badge (bottom-left) — chronological order. */}
                    <View style={s.timelineThumbIdxPill}>
                      <Text style={s.timelineThumbIdxText}>{idx + 1}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {/* Thinking / reasoning strip */}
          {latestReasoning ? (
            <ScrollView
              ref={reasoningRef}
              style={s.reasoningStrip}
              contentContainerStyle={s.reasoningContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={s.reasoningText}>{latestReasoning}</Text>
            </ScrollView>
          ) : null}

          {/* Action / step counter */}
          <View style={s.meta}>
            <Text style={s.metaText}>
              {props.actions.length} step{props.actions.length === 1 ? '' : 's'} · {props.screenshots.length} frame{props.screenshots.length === 1 ? '' : 's'}
            </Text>
            {props.liveUrl ? (
              <Pressable nativeID="cu-card-btn-live" onPress={() => Linking.openURL(props.liveUrl!)} style={s.liveBtn} accessibilityRole="button">
                <Text style={[s.liveBtnText, { color: accent }]}>↗ OPEN LIVE</Text>
              </Pressable>
            ) : null}
            {props.status === 'running' && props.onCancel ? (
              <Pressable nativeID="cu-card-btn-stop" onPress={props.onCancel} style={s.cancelBtn} accessibilityRole="button">
                <Text style={s.cancelBtnText}>■ STOP</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Final result — always visible when done, below the collapsed body */}
      {props.status === 'done' && props.result ? (
        <View style={s.resultBox}>
          <Text style={s.resultHeader}>RESULT</Text>
          <Text style={s.resultText}>{props.result.summary}</Text>

          {/* Findings cards — only render when the agent emitted a
              structured list (research / comparison / "top X" tasks). */}
          {props.result.findings && props.result.findings.length > 0 ? (
            <View style={s.findingsList}>
              {props.result.findings.map((f, i) => {
                const hasLink = !!f.url;
                const contents = (
                  <>
                    {f.thumbnail ? (
                      <Image source={{ uri: f.thumbnail }} style={s.findingThumb} resizeMode="cover" />
                    ) : (
                      <View style={[s.findingThumb, { backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ color: '#475569', fontSize: 10, fontWeight: '800' }}>{String(i + 1).padStart(2, '0')}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.findingTitle} numberOfLines={2}>{f.title}</Text>
                      {f.notes ? <Text style={s.findingNotes} numberOfLines={2}>{f.notes}</Text> : null}
                      <View style={s.findingMetaRow}>
                        {f.price ? <Text style={[s.findingBadge, { color: '#22c55e', borderColor: '#22c55e55' }]}>{f.price}</Text> : null}
                        {f.rating ? <Text style={[s.findingBadge, { color: '#f59e0b', borderColor: '#f59e0b55' }]}>★ {f.rating}</Text> : null}
                        {hasLink ? <Text style={[s.findingBadge, { color: '#38bdf8', borderColor: '#38bdf855' }]}>OPEN ↗</Text> : null}
                      </View>
                    </View>
                  </>
                );
                return hasLink ? (
                  <Pressable
                    key={i}
                    nativeID={`cu-card-finding-${i}`}
                    onPress={() => Linking.openURL(f.url!)}
                    style={s.findingRow}
                    accessibilityRole="button"
                  >
                    {contents}
                  </Pressable>
                ) : (
                  <View key={i} style={s.findingRow}>{contents}</View>
                );
              })}
            </View>
          ) : null}

          {props.result.extractedData ? (
            <View style={s.extractedDataBox}>
              <Text style={s.extractedDataHeader}>EXTRACTED DATA</Text>
              <ScrollView style={s.extractedDataScroll}>
                <Text style={s.extractedDataText}>{formatExtractedDataPreview(props.result.extractedData)}</Text>
              </ScrollView>
            </View>
          ) : null}

          <Text style={s.resultMeta}>
            {props.result.iterations} iteration{props.result.iterations === 1 ? '' : 's'} · {props.result.tokens.input + props.result.tokens.output} tokens
          </Text>

          {/* Export / re-use actions. Copy-as-markdown hands the full
              run (task + summary + findings + live link) to the clipboard
              in clean markdown. Save-as-template stashes the task shape
              so it becomes a one-tap chip in the Browser Task modal. */}
          {(props.onCopyMarkdown || props.onSaveTemplate) ? (
            <View style={s.exportRow}>
              {props.onCopyMarkdown ? (
                <Pressable nativeID="cu-card-btn-copy" onPress={props.onCopyMarkdown} style={s.exportBtn} accessibilityRole="button">
                  <Text style={s.exportBtnText}>⧉ COPY MD</Text>
                </Pressable>
              ) : null}
              {props.onSaveTemplate ? (
                <Pressable nativeID="cu-card-btn-save" onPress={props.onSaveTemplate} style={s.exportBtn} accessibilityRole="button">
                  <Text style={s.exportBtnText}>⌾ SAVE TEMPLATE</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Follow-up suggestions — one-tap chips that kick off a new
              task with the prior run's context (the edge function pulls
              the last completed run's summary + findings into the
              prompt when the same circle fires a new task within 30 min). */}
          {props.onFollowUp && props.followUpSuggestions && props.followUpSuggestions.length > 0 ? (
            <View style={s.followupRow}>
              {props.followUpSuggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => props.onFollowUp!(suggestion)}
                  style={s.followupChip}
                  accessibilityRole="button"
                >
                  <Text style={s.followupChipText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Error — three flavors styled distinctly:
          (1) cancellation → muted slate (user-initiated, not scary)
          (2) budget cap → red with "OPEN SETTINGS" shortcut
          (3) generic failure → red */}
      {props.status === 'error' && props.errorMessage ? (() => {
        const isCancel = /^cancel/i.test(props.errorMessage);
        const isBudget = isBudgetError(props.errorMessage);
        const tone = isCancel ? '#94a3b8' : '#ef4444';
        const label = isCancel ? 'STOPPED' : isBudget ? 'BUDGET CAP' : 'ERROR';
        return (
          <View style={[s.resultBox, { borderColor: `${tone}55`, backgroundColor: `${tone}12` }]}>
            <Text style={[s.resultHeader, { color: tone }]}>{label}</Text>
            <Text style={s.resultText}>{props.errorMessage}</Text>
            {isBudget && props.onOpenSettings ? (
              <View style={s.exportRow}>
                <Pressable
                  nativeID="cu-card-btn-settings"
                  onPress={props.onOpenSettings}
                  style={[s.exportBtn, { borderColor: '#ef444488' }]}
                  accessibilityRole="button"
                >
                  <Text style={[s.exportBtnText, { color: '#ef4444' }]}>⚙ OPEN SETTINGS</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })() : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#0f172a',
    gap: 10,
    ...(Platform.OS === 'web' ? { transition: 'border-color 0.2s ease' } as any : {}),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // Animation note: RN-Web 0.19+ rejects both `animation` shorthand
    // AND `animationName` style properties (it only accepts
    // `animationKeyframes`, which takes an object literal — not a
    // global @keyframes name). To animate this dot on web, apply the
    // `uc-tab-dot` class via `dataSet={{ className: 'uc-tab-dot' }}`
    // on the View — the class is defined in the global CSS injected
    // by CircleDetailScreen.tsx:50. Keeping the style block free of
    // the invalid property so the console stays clean.
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  taskText: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  toggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  toggleText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    gap: 10,
  },
  screenshotWrap: {
    backgroundColor: '#020617',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },
  screenshot: {
    width: '100%',
    aspectRatio: 16 / 10,
  },
  screenshotUrl: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reasoningStrip: {
    maxHeight: 72,
    backgroundColor: '#020617',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  reasoningContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  reasoningText: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 16,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaText: {
    flex: 1,
    color: '#64748b',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  liveBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  liveBtnText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  cancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#ef444415',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelBtnText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  resultBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#22c55e55',
    backgroundColor: '#22c55e12',
    gap: 6,
  },
  resultHeader: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  resultText: {
    color: '#e2e8f0',
    fontSize: 12,
    lineHeight: 17,
  },
  resultMeta: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.5,
  },
  findingsList: {
    gap: 8,
    marginTop: 6,
  },
  findingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'border-color 0.15s ease' } as any : {}),
  },
  findingThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  findingTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  findingNotes: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  findingMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  findingBadge: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  extractedDataBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#38bdf855',
    backgroundColor: '#020617',
  },
  extractedDataHeader: {
    color: '#7dd3fc',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginBottom: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  extractedDataScroll: {
    maxHeight: 180,
  },
  extractedDataText: {
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  followupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  followupChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#38bdf855',
    backgroundColor: '#38bdf812',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  followupChipText: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '700',
  },
  confirmBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#f59e0b88',
    backgroundColor: '#f59e0b15',
    gap: 6,
  },
  confirmLabel: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  confirmHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confirmCountdown: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    opacity: 0.85,
  },
  confirmCountdownUrgent: {
    color: '#ef4444',
    opacity: 1,
  },
  confirmQuestion: {
    color: '#fef3c7',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  confirmContext: {
    color: '#fde68a',
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
  },
  confirmOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  confirmBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'transform 0.1s ease' } as any : {}),
  },
  confirmBtnText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  usagePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617',
  },
  usagePillText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // ── Step progress bar — 3px under the header ─────────────────────
  stepBarTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
  },
  stepBarFill: {
    height: 3,
    borderRadius: 2,
    ...(Platform.OS === 'web' ? {
      transition: 'width 0.4s ease, background-color 0.3s ease',
    } as any : {}),
  },
  stepCountText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    opacity: 0.7,
  },
  // ── Screenshot timeline strip ─────────────────────────────────────
  timelineStrip: {
    maxHeight: 56,
  },
  timelineContent: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  timelineThumb: {
    width: 64,
    height: 48,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
    backgroundColor: '#020617',
    position: 'relative',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  timelineThumbImg: {
    width: '100%',
    height: '100%',
  },
  timelineThumbIdxPill: {
    position: 'absolute',
    bottom: 2,
    left: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#020617cc',
  },
  timelineThumbIdxText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  timelineThumbVerbPill: {
    position: 'absolute',
    top: 2,
    right: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    backgroundColor: '#020617e6',
  },
  timelineThumbVerbText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // ── Pinned-frame badge on main screenshot ─────────────────────────
  pinBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617ee',
  },
  pinBadgeText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  pinBadgeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#0f172a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  pinBadgeBtnText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  actionPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617',
  },
  actionPreviewLabel: {
    color: '#22d3ee',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionPreviewText: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  exportRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  exportBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    } as any : {}),
  },
  exportBtnText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

// Web-only hover CSS — keyed off `nativeID` attributes we put on the
// Pressable elements. React Native Web forwards `nativeID` as the DOM
// `id` attribute, which CSS selectors can target reliably (unlike the
// auto-generated `r-*` class names). Soft hover per the UC style guide:
// background shift + border brightening, no lift.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'uc-cu-live-card-hover-css';
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
      [id^="cu-card-btn-"]:hover {
        background-color: #0f172a !important;
        border-color: #334155 !important;
      }
      [id^="cu-card-thumb-"]:hover {
        border-color: #475569 !important;
      }
      [id^="cu-card-finding-"]:hover {
        border-color: #475569 !important;
        background-color: #0f172a !important;
      }
      /* Header tap target — subtle opacity shift so users sense the
         whole row is clickable, not just the chevron. */
      #cu-card-header:hover {
        opacity: 0.85;
      }
    `;
    document.head.appendChild(el);
  }
}
