# ChatTab + OpenSwanConsole Decomposition Plan

> CONSOLIDATE #3 — God-component decomposition. Plan only; no component edits.
> Authored 2026-07-15. Targets:
> `src/screens/circles/tabs/ChatTab.tsx` (19,262 lines) and
> `src/components/openswan/OpenSwanConsole.tsx` (6,456 lines).

## Why this doc exists

`ChatTab.tsx` and `OpenSwanConsole.tsx` are the two largest files in the app.
Both have the classic god-component shape: a band of module-level pure helpers
and types, one enormous default-export component, then a tail of leaf
sub-components and a multi-thousand-line `StyleSheet`. This plan lists the
lowest-risk extractable units so the files can shrink without touching the live
send path.

Method: rank by `value (lines removed) × (1 / risk)`. A "good first extraction"
is pure logic or a self-contained leaf, never the send/command loop.

## House pattern (already in use — do not re-invent)

Extraction here means **move logic to a dependency-light `*Core.ts` module +
leave a thin `import` in the component**, exactly the pattern already shipped
this session. ChatTab already consumes these session cores as thin wrappers:

| Core (already built + wired) | ChatTab usage |
|---|---|
| `chatSendGuardCore.ts` | `import { guardChatSend }` (line 196) |
| `chatStopMessageCore.ts` | `import { matchStopResolution }` (line 195) |
| `markdownSegmentCore.ts` | `import { hasRenderableMarkdown }` (line 206) |
| `thinkingVerbs.ts` | `import { pickThinkingVerb }` (line 144) |
| `slashCommandCorrectionCore.ts` | dynamic import (line 9294) |
| `chatClarifyGateCore.ts` | dynamic import (line 9314) |
| `chatOutcomeSignals.ts` | import (line 236) |

Other cores exist from this session (`chatCommandDispatchCore.ts`,
`chatEntityLinkifyCore.ts`, `messageMetadataCore.ts`, `commandFrecencyCore.ts`)
— those are the send/command path and are **out of scope** here. The units
below are all *new* cold-path extractions that follow the same wrapper pattern.
None of the proposed `*Core.ts` target files exist yet (verified).

Smoke-test rule (from repo memory): a `*Core.ts` that should be smoke-tested may
only use `import type` for anything that pulls in `react-native`. Two candidate
functions touch `Platform` — they are split out below so the core stays pure.

## Hard constraints for the implementer

- **Do NOT edit** `src/lib/swanbot.ts`,
  `src/screens/circles/tabs/ChatTab.tsx`, or
  `supabase/functions/chat-stream/index.ts` while the main session is live.
  This plan is safe to write now; land the moves only once ChatTab is unlocked.
- Extractions must be **pure moves** — copy the function verbatim, re-export,
  swap the in-file definition for an import. No behavior rewrite in the same PR.
- Preserve odd-but-intentional code exactly (e.g. `ParticleEffect` calls
  `useRef` inside an `Array.from` map — that is existing behavior, not a bug to
  fix during a move).

## Enabling prerequisite (do this first)

**U0 — Shared chat message types.** Several high-value units depend on the
`ChatMessage` / `ChatMessageSource` types defined locally in ChatTab
(`ChatMessageSource` 820–827, `ChatMessage` 866–933, `ChatBotMessageExtra`
935–970). Extract these type declarations to `src/lib/chatMessageTypes.ts`
(type-only, ~180 lines) and re-import. Risk 1 (types are erased; `tsc` catches
any mismatch). This unblocks U2's message-coupled helpers, U5, and U12.

## Ranked extraction table

Priority = `lines × (1/risk)`. Risk 1 = trivially pure; 3 = style/type coupling.

| # | Unit | Source file:lines | New module | Risk | Lines saved | Priority | Depends on |
|---|---|---|---|---|---|---|---|
| U3 | OpenSwan intent + guardrail task builders | OpenSwanConsole 162–272, 337–517 | `src/lib/openswanConsoleIntentCore.ts` | 2 | ~300 | 150 | types only + `classifyBrowserbaseWorkflow`, `OPENSWAN_AUTOMATION_INTENT_SEED` |
| U2 | Recovery display formatters + card builders | ChatTab 569–586, 1115–1324, 1362–1383 | `src/lib/chatRecoveryDisplayCore.ts` | 2 | ~250 | 115 | recovery/handoff types + `chatFailureRecovery` (pure lib) |
| U4 | Model display / label core | ChatTab 14646–14662, 14766–14953 | `src/lib/chatModelDisplayCore.ts` | 2 | ~190 | 95 | none (pure) — excludes 2 `Platform` fns |
| U11 | Chat prompt/category leaf cards | ChatTab 13562–13761 | `src/components/chat/ChatPromptCards.tsx` | 3 | ~200 | 67 | shared `styles` subset |
| U9 | OpenSwan console leaf primitives | OpenSwanConsole 3790–3949, 4095–4113 | `src/components/openswan/OpenSwanConsolePrimitives.tsx` | 3 | ~200 | 67 | shared `styles` + color consts |
| U1 | Memory-reference label formatters | ChatTab 626–689 | `src/lib/chatMemoryLabelCore.ts` | 1 | ~64 | 64 | `type PromptMemoryReference` |
| U6 | Session-title derivation | ChatTab 445, 530–567, 588–591 | `src/lib/chatSessionTitleCore.ts` | 1 | ~55 | 55 | none (pure) |
| U5 | Route-chip + model-name display | ChatTab 979–1113 | `src/lib/chatRouteChipCore.ts` | 3 | ~135 | 45 | U0 `ChatMessage`, U2 `formatHandoffSurfaceRouteLabel` |
| U10 | Chat animation leaf components | ChatTab 1433–1553 | `src/components/chat/ChatAnimations.tsx` | 3 | ~120 | 40 | shared `styles` subset, `LoadingWave` |
| U8 | Assignable-agent mappers | ChatTab 457–528 | `src/lib/assignableAgentCore.ts` | 2 | ~72 | 36 | 3 type-only imports |
| U12 | Persisted-message → ChatMessage mappers | ChatTab 691–816 | `src/lib/chatMessageMapCore.ts` | 3 | ~126 | 36 | U0 + `chatMessageShape`, `pendingBotMessages` |

Top 10 alone remove ~1,600 lines from ChatTab and ~500 from OpenSwanConsole
without touching the send/command loop or any network path.

## Per-unit specs

### U3 — `openswanConsoleIntentCore.ts` (top priority)
Largest single pure-logic win. Move the whole helper-intent + guardrail
task-string machinery out of OpenSwanConsole.
- **Move:** `HelperIntentKey` (164), `HelperIntent` (172), `HELPER_INTENTS`
  (187–272), `INTENT_CONTROL_STEPS` (375–408), `inferIntentFromTask` (410),
  `stripIntentFraming` (436), `buildIntentTaskDraft` (457),
  `GuardrailWatchMode` (275), `GuardrailPrefs` (291), `DEFAULT_GUARDRAIL_PREFS`
  (337), `GUARDRAIL_WATCH_OPTIONS` (345), `normalizeGuardrailPrefs` (462),
  `buildGuardrailedTask` (477–517), `AUTO_MODEL_COST_BASELINE` (162).
- **Exports:** all of the above (functions + `HELPER_INTENTS`/option tables +
  types).
- **Depends on:** `type OpenSwanChatMode`, `type ComputerCapabilityId`,
  `classifyBrowserbaseWorkflow`, `OPENSWAN_AUTOMATION_INTENT_SEED` (all already
  imported by the component from pure libs).
- **Leave behind:** the interleaved component-only types
  (`LaunchReadinessSnapshot` 278–289, `ControlPanelSectionKey`/`…OpenState`
  299–310 and their tables 312–331) — they belong to the component's render
  state, not to intent logic.
- **New smoke:** `smoke:openswan-console-intent` — assert `inferIntentFromTask`
  routing, `stripIntentFraming` idempotence, and that `buildGuardrailedTask`
  emits the oversight/scope/credentials/prompt-injection lines.

### U2 — `chatRecoveryDisplayCore.ts`
Pure display/formatting for the failure-recovery + computer-handoff cards.
- **Move (ChatMessage-free, clean):** `getRecoveryOptionActorLabel` (1115),
  `getRecoveryOptionAccent` (1130), `formatRecoverySurfaceKind` (1138),
  `formatRecoveryFailureArea` (1155), `formatRecoveryEvidenceLabel` (1161),
  `formatHandoffSurfaceRouteLabel` (1176), `buildComputerTaskSummaryLine`
  (1197), `getRecoveryReliabilityStatus` (1215), `buildRecoveryReliabilityCard`
  (1236), `buildChatAppChoiceCard` (1271), `stripChatAppChoiceLine` (1315),
  `getRecoveryOptionPolicyBadges` (1362), `getRecoveryReliabilityFromArchive`
  (1376). Also fold the customer-safe message sanitizers here:
  `appendCustomerSafeRecoveryMessage` (569), `isSupportOnlyComputerTaskWarning`
  (575), `sanitizeVisibleComputerTaskMessage` (579).
- **Defer to after U0:** `buildRecoveryOptionComposerPrompt` (1326),
  `findLatestRecoveryOptionsMessage` (1335), `findPriorUserPromptForMessage`
  (1349) — these take `ChatMessage[]`; move once U0 lands (or accept a generic
  param).
- **Exports:** the 16 formatter/builder functions above.
- **Depends on:** `type ChatFailureRecoveryOption`,
  `type PersistedChatRecoveryReliabilitySummary`,
  `type ChatComputerHandoffMetadata`, plus runtime
  `buildChatFailureRecoveryExecutionPlan` + `formatChatFailureRecoveryOptionSelection`
  from `chatFailureRecovery` (already a pure lib).
- **New smoke:** `smoke:chat-recovery-display`.

### U4 — `chatModelDisplayCore.ts`
Pure model-name normalization + section accents used by the model picker.
- **Move:** `colorForOpenRouterAuthor` (14646), `MODEL_SECTION_ACCENTS`
  (14766), `MODEL_SECTION_FALLBACK_COLORS` (14797), `modelSectionAccent`
  (14814), `MODEL_ROUTE_PREFIXES` (14824), `MODEL_AUTHOR_SEGMENTS` (14850),
  `modelDisplayToken` (14870), `compactVersionTokens` (14907),
  `autoModelDisplayName` (14921).
- **Leave behind (Platform-coupled, keep out of the pure core):**
  `modelSectionHoverStyle` (14955) and `modelSectionTransitionStyle` (14969)
  import `Platform`; keep them in the component or a sibling
  `chatModelDisplayStyles.ts` that is *not* smoke-tested.
- **Optional follow-on (not this PR):** the catalog data `ChatPickerModel`
  (14613), `POPULAR_OPENROUTER_MODELS` (14624), `CHAT_MODELS` (14705),
  `MODEL_GROUPS` (14757) — pure data but referenced widely by the picker UI;
  move separately once the display core is proven.
- **Exports:** the 9 functions/tables above.
- **New smoke:** `smoke:chat-model-display` — lock `autoModelDisplayName` on
  `openrouter/anthropic/claude-sonnet-4.6`, date-suffixed ids, and `:free`
  variants; lock `modelSectionAccent` fallback hashing.

### U1 — `chatMemoryLabelCore.ts` (best "first PR")
Eight trivially pure formatters over one type. Zero cross-refs beyond
`getMemoryFamilyLabel → getMemoryFamily`.
- **Move:** `formatMemoryRecencyLabel` (626), `formatMemoryStrengthLabel`
  (638), `formatMemoryStateLabel` (646), `formatMemoryTrustLabel` (655),
  `formatArchiveBiasLabel` (664), `formatMemorySourceLabel` (671),
  `getMemoryFamily` (681), `getMemoryFamilyLabel` (687).
- **Depends on:** `import type { PromptMemoryReference } from './memoryService'`
  (type-only — safe for smoke).
- **New smoke:** `smoke:chat-memory-label`.

### U6 — `chatSessionTitleCore.ts` (best "first PR")
- **Move:** `SESSION_FALLBACK_TITLE` (445), `TITLE_STOP_WORDS` (530),
  `formatSessionTitleWord` (536), `deriveSessionTitleFromMessage` (542),
  `isAutoNamedSession` (588). Optionally `normalizeThreadModelPreference` (593).
- **Depends on:** nothing (fully self-contained string logic).
- **New smoke:** `smoke:chat-session-title`.

### U5 — `chatRouteChipCore.ts` (after U0)
- **Move:** `formatModelDisplayName` (979), `ChatMessageRouteChip` (998),
  `formatRouteSurfaceLabel` (1004), `isLocalExecutionSource` (1022),
  `buildMessageRouteChips` (1032), `describeLastTaskModel` (1079).
- **Depends on:** U0 `ChatMessage`/`ChatMessageSource` types; U2's
  `formatHandoffSurfaceRouteLabel` (import from `chatRecoveryDisplayCore`).
- **Note:** `formatModelDisplayName`, `formatRouteSurfaceLabel`,
  `isLocalExecutionSource` are `ChatMessage`-free and could ship first as a pure
  subset if U0 slips.
- **New smoke:** `smoke:chat-route-chip`.

### U8 — `assignableAgentCore.ts`
- **Move:** `AssignableAgent` (457), `applyTerminalProfileToTask` (474),
  `parseAgentExtendedConfig` (485), `toAssignableDbAgent` (495),
  `toAssignableSessionAgent` (514).
- **Depends on:** `type CircleOfficeAgent` (circleOffice), `type OfficeAgent`
  (officeAgents), `type TerminalAgentOfficeConfig` (agentIdentity) — all
  type-only.
- **New smoke:** `smoke:assignable-agent`.

### U12 — `chatMessageMapCore.ts` (after U0)
Higher risk: this is the persistence-recovery mapping path.
- **Move:** `mapPersistedRowsToChatMessages` (691),
  `mapPendingBotRecordsToChatMessages` (742), `mergeRecoveredChatMessages`
  (785), `mapLoadedThreadMessages` (797).
- **Depends on:** U0 types + `shapePersistedChatMessage`,
  `readPersistedChatBotMetadata`, `deriveChatActivityFlags` (chatMessageShape),
  `reconcilePendingBotMessages`, `loadPendingBotMessages`,
  `type PendingBotMessageRecord` (pendingBotMessages), and ~20 metadata types.
- **Ship last** of the ChatTab logic moves; gate on
  `smoke:chat-message-map` covering persisted+pending merge/dedupe/sort.

### U11 — `ChatPromptCards.tsx` (leaf components)
Self-contained presentational leaves used by the empty-state.
- **Move:** `EnhancedPromptCard` (13562), `GlassmorphismCard` (13628),
  `EnhancedPromptItem` (13679), `TipCard` (13726).
- **Coupling:** all reference the shared module `styles`. Carry the relevant
  style keys (`enhancedPromptCard`, `enhancedPromptText`, `glassmorphismCard`,
  `categoryHeader`, `categoryTitle`, `categoryChevron`, `categoryPrompts`,
  `enhancedPromptItem`, `promptInfo`, `promptLabel`, `promptDesc`, `promptArrow`,
  `enhancedTipCard`, `tipAccent`, `tipText`) into the new file's local
  `StyleSheet`. No smoke (pure presentational); verify via `/run`.

### U9 — `OpenSwanConsolePrimitives.tsx` (leaf components)
- **Move:** `GroupHeader` (3790), `AccordionSection` (3801), `BudgetStrip`
  (3854), `DiagCard` (3894), `QuickActionButton` (3917), `AutomationMetric`
  (4095). (`ReadinessPill`, `LaunchReadinessPanel`, `AutomationReadinessPanel`,
  `ControlBridgeRow`, `BridgeCommandBox` are larger/more-coupled — a second
  pass.)
- **Coupling:** shared `styles` + color consts (`SWAN_PURPLE`, `DANGER`,
  `SUCCESS`, `MUTED`, `TEXT`, `TEXT_DIM`). Extract those consts into a tiny
  `openswanConsoleTheme.ts` first, or copy the needed keys. No smoke; verify via
  `/run`.

### U10 — `ChatAnimations.tsx` (leaf components)
- **Move:** `FloatingEmoji` (1433), `ParticleEffect` (1470), `ChatLoadingWave`
  (1525), `TypingDots` (1529).
- **Coupling:** shared `styles` (`floatingEmoji`, `floatingEmojiText`,
  `particleContainer`, `particle`, `typingDotsText`) + `Animated` + the
  `LoadingWave` import currently at line 1524. Carry those style keys into the
  new file. **Preserve `ParticleEffect`'s `useRef`-in-map verbatim.** No smoke.

## Risks and guardrails

- **Live-edit collision.** ChatTab.tsx is being edited in the main session.
  Landing any ChatTab move now would conflict. Sequence: U3 (OpenSwanConsole,
  independent) can go first; ChatTab units wait for the unlock.
- **Shared `ChatMessage` type is a linchpin.** U5 and U12 (and 3 helpers in U2)
  need U0. Do U0 as a standalone type-only PR before them.
- **Style coupling on leaf components (U9/U10/U11).** These are low-*logic* risk
  but medium-*churn*: you must relocate the right `StyleSheet` keys. Prefer a
  shared theme/style module over prop-drilling `styles`.
- **Smoke purity.** Keep `Platform`/`react-native` out of any `*Core.ts` meant
  to be smoke-tested (U4 explicitly splits off the two `Platform` style fns).
  Use `import type` for RN-backed types (U1, U8).
- **Verbatim moves only.** No refactors mixed into an extraction PR — it makes
  review and `git blame` unreadable and invites regressions on a hot surface.
- **Validation per unit:** `npm run typecheck` + the unit's new focused smoke;
  for leaf-component units, drive the surface with `/run` since they have no
  pure-testable logic.

## Suggested landing order

1. U0 (shared types) — unblocks the rest.
2. U3 (OpenSwanConsole, fully independent of ChatTab lock).
3. U1 + U6 (trivial pure cores, safest ChatTab starters).
4. U2 + U4 (large pure cores).
5. U5 + U8 + U12 (type-coupled logic).
6. U9 + U10 + U11 (leaf-component/style moves, one file each).
