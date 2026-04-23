# Chat Command Architecture Audit

Date: 2026-04-17
Scope: Circle Chat, slash commands, local SwanBot commands, conversational intent routing, and the OpenSwan mode/control surface.

## Executive Summary

The fastest high-impact fix is not a full rewrite. It is to introduce a single command contract that becomes the source of truth for:

- slash autocomplete
- help output
- command execution
- natural-language intent routing
- availability gating by surface, mode, and integrations

Right now chat commands are split across multiple systems that drift independently:

- command metadata in `src/lib/chatSlashCommands.ts`
- hardcoded dispatcher branches in `src/screens/circles/tabs/ChatTab.tsx`
- regex-based local commands in `src/lib/swanbot.ts`
- natural-language intent routing in `src/lib/conversationalRouter.ts`
- feature-specific executors like `roomChatCommands.ts`, `githubChatCommands.ts`, `wordpressChatCommands.ts`, `missionChatCommands.ts`

That split is why users can get mismatch between what autocomplete promises, what help says, what natural language triggers, and what actually runs.

The best path for speed and user satisfaction is:

1. Keep existing executors.
2. Add a unified command registry and parser layer above them.
3. Move help, slash suggestions, and natural-language routing onto that registry.
4. Keep direct model chat as the fallback when no command is confidently matched.
5. Keep OpenSwan explicitly opt-in via mode selection.

This gives the biggest result with the least risk because it centralizes discovery and routing without forcing every command implementation to be rewritten immediately.

## Current Architecture

### 1. Slash Metadata

`src/lib/chatSlashCommands.ts`

This file defines display metadata for slash commands:

- command
- insert text
- title
- description
- category
- aliases
- keywords

It powers:

- slash autocomplete in `ChatTab.tsx`
- slash autocomplete in `FloatingChat.tsx`
- `/help` output via `missionChatCommands.ts`

Problem:
This registry is descriptive, not executable. It is not the actual source of truth for execution.

### 2. Imperative Dispatcher

`src/screens/circles/tabs/ChatTab.tsx`

This is the real command router. It hardcodes a long sequence of branches for:

- governance commands
- memory commands
- scheduling commands
- mission commands
- summary/status
- room commands
- build page
- Hugging Face tools
- GitHub commands
- WordPress commands
- local SwanBot commands
- casual greeting fast path
- capability routing
- OpenSwan mode execution
- direct model fallback

Problem:
This file owns too much policy. It decides:

- what counts as a command
- precedence between systems
- what is local vs remote
- what runs before direct model chat

That makes correctness fragile and hard to audit.

### 3. Local Regex Commands

`src/lib/swanbot.ts`

This is a second command system, separate from the slash registry. It handles things like:

- `help`
- `/wiki`
- `/research`
- `my tasks`
- `status`
- `streak`
- `leaderboard`
- `create task`

Problem:
Some user-visible commands live here instead of the main slash dispatcher. That means:

- help and autocomplete can drift
- slash and natural-language behavior can diverge
- command analytics are split

### 4. Natural Language Intent Router

`src/lib/conversationalRouter.ts`

This is a third routing system. It converts free-form requests into actions like:

- WordPress publish/list/schedule
- create task
- create office agent and attach to task
- remember/forget/show memories
- generate image
- build webpage

Problem:
The natural-language router does not map into the same command contract as slash commands. It is effectively a separate intent tree.

### 5. Feature Executors

Feature modules are in better shape. These files are mostly command executors already:

- `src/lib/roomChatCommands.ts`
- `src/lib/githubChatCommands.ts`
- `src/lib/wordpressChatCommands.ts`
- `src/lib/missionChatCommands.ts`
- `src/lib/huggingFaceChatCommands.ts`

This is good. These modules should stay. The missing piece is a shared command definition and parser layer above them.

## Main Problems

### 1. No Single Source of Truth

The same user action may be defined in different places:

- help text in one file
- autocomplete metadata in another
- execution in `ChatTab`
- natural-language intent in another

This is the root architecture problem.

### 2. Routing Precedence Is Implicit

Today precedence is mostly determined by branch order inside `ChatTab.tsx`.

That makes it hard to reason about:

- why a message triggered a command instead of normal chat
- why a command did not trigger
- when OpenSwan should or should not activate

### 3. Discoverability and Execution Are Not Coupled

Autocomplete currently suggests commands based on metadata, not on whether:

- the command is actually executable in the current surface
- required integrations are connected
- current mode permits it
- command arguments are valid

### 4. OpenSwan Concerns Are Mixed Into General Chat Controls

The user expectation is:

- normal chat uses the selected model and stored context
- OpenSwan is a deliberate upgrade path when selected

That separation is correct. The architecture needs to preserve it consistently.

### 5. Duplicate Slash UI Logic

Both `ChatTab.tsx` and `FloatingChat.tsx` implement their own slash autocomplete wiring against the same metadata source.

That is manageable now, but it will keep drifting as command behavior gets richer.

## What “Satisfy The User Every Time” Actually Means

No command system can satisfy users literally every time. The practical goal is:

- high confidence routing for obvious commands
- low surprise in normal chat
- clear fallback when confidence is low
- discoverable commands
- command availability that matches reality
- command results with concrete next actions

The system should optimize for:

1. Predictability
2. Speed
3. Recoverability
4. Discoverability
5. Low false positives

False positives are the most damaging problem in a chat UI. Users tolerate “I did not detect a command” much more than “I triggered the wrong system.”

## Recommended Target Architecture

## 1. Create One Unified Command Registry

Add a new module, for example:

`src/lib/chatCommandRegistry.ts`

Each command should be defined as data plus handler reference:

```ts
type ChatCommandDefinition = {
  id: string;
  title: string;
  category: 'general' | 'memory' | 'missions' | 'rooms' | 'github' | 'wordpress' | 'ai_tools' | 'governance' | 'knowledge';
  triggers: {
    slash?: string[];
    aliases?: string[];
    examples?: string[];
    naturalLanguage?: Array<{
      patterns: RegExp[];
      confidence: 'high' | 'medium';
    }>;
  };
  args?: ChatCommandArgDefinition[];
  surfaces: Array<'main_chat' | 'floating_chat' | 'room_chat'>;
  availability: (ctx: ChatCommandContext) => ChatCommandAvailability;
  execute: (input: ChatCommandInvocation, ctx: ChatCommandContext) => Promise<ChatCommandResult>;
};
```

Important rule:
The registry owns metadata and the executor reference. Help, autocomplete, and routing all read from the same object graph.

## 2. Separate Parsing From Execution

Add a dedicated parser layer:

`src/lib/chatCommandRouter.ts`

It should return one of:

- exact slash command match
- high-confidence natural-language command match
- no match

Do not execute directly during parsing.

This makes routing debuggable and testable.

## 3. Add Explicit Routing Stages

Recommended order:

1. Empty/greeting fast path
2. Exact slash parse
3. High-confidence local command parse
4. High-confidence natural-language command parse
5. normal direct model chat when `chatMode === 'none'`
6. OpenSwan runtime only when a non-`none` mode is selected

Important rule:
OpenSwan should never be a hidden fallback for ordinary chat.

## 4. Standardize Command Results

All commands should return a shared result envelope:

```ts
type ChatCommandResult = {
  handled: boolean;
  message: string;
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  localOnly?: boolean;
  followups?: Array<{ label: string; insertText: string }>;
  telemetry?: {
    commandId: string;
    source: 'slash' | 'alias' | 'natural_language';
    confidence?: number;
  };
};
```

That removes custom per-command glue from `ChatTab.tsx`.

## 5. Add Availability Gates To The Registry

Every command should report whether it is:

- enabled
- hidden
- visible but disabled with reason

Examples:

- `/wp` commands disabled when no WordPress connection exists
- `/gh` commands disabled when no repo/token is available
- OpenSwan actions disabled when mode is `Chat`

Autocomplete should use this same state so users do not see commands that are impossible to run.

## 6. Keep Feature Executors As They Are

Do not rewrite:

- GitHub executor
- Room executor
- WordPress executor
- Mission executor
- HF executor

Wrap them.

That is the fastest path.

## 7. Treat Natural Language As Aliases Into The Same Registry

Natural-language intents should not be a separate action system.

Instead:

- command registry owns NL patterns/examples
- router maps NL to a registry command plus parsed args
- execution still goes through the same command handler

This eliminates command drift.

## 8. Build One Shared Slash Palette Component

Both `ChatTab` and `FloatingChat` should use the same palette logic and component.

That shared component should support:

- filtering
- disabled states
- required-argument hints
- grouped categories
- keyboard navigation
- insertion text

Do not keep separate implementations once the registry is in place.

## 9. Add Lightweight Confidence and Safety Rules

Natural-language commands should use a strict threshold:

- high confidence for write or side-effecting actions
- medium confidence only for safe read actions

Examples:

- “show my tasks” can auto-run
- “publish this to WordPress” should require high confidence or a confirm step
- “remember this” may run directly

This is the main protection against user frustration.

## Why This Is The Best And Quickest Path

It maximizes leverage because:

- command implementations mostly already exist
- the main problem is routing and discoverability drift
- a registry + parser layer fixes that without replacing core business logic

It is faster than:

- rewriting all command modules
- moving everything into OpenSwan
- building a full agent planner for all chat actions

It is safer than:

- adding more regexes to the current stack
- expanding `ChatTab.tsx` further

## Rollout Plan

## Phase 1: Source Of Truth

Goal: stop drift fast

Build:

- `chatCommandRegistry.ts`
- `chatCommandRouter.ts`
- adapter entries for existing executors

Move first:

- `/help`
- `/summary`
- `/mission`
- `/room`
- `/gh`
- `/wp`
- `/wiki`
- `/research`
- `/remember`
- `/forget`
- `/memories`
- `/schedule`
- `/cron`

Keep implementation modules unchanged.

Expected result:

- help and autocomplete always match reality
- command discovery gets reliable immediately

## Phase 2: Shared Palette + Availability

Goal: make commands feel consistent and trustworthy

Build:

- shared slash palette component/hook
- per-command availability checks
- disabled reasons in UI

Expected result:

- fewer dead-end commands
- better user trust
- easier onboarding

## Phase 3: Natural Language Convergence

Goal: make chat feel smart without being unpredictable

Build:

- map `conversationalRouter.ts` intents into registry commands
- remove duplicate intent-specific logic where possible
- add confidence levels and optional confirmation for destructive actions

Expected result:

- same action works whether user types slash or plain English
- less divergence between power users and casual users

## Phase 4: Telemetry And Satisfaction

Goal: optimize based on real usage

Track:

- which command was suggested
- which command was invoked
- source: slash vs NL
- fallback rate to direct chat
- command success/failure
- “undo” or correction behavior
- user follow-up like “that’s not what I meant”

This is the only real way to approach “satisfy the user every time.”

## Concrete Implementation Recommendation

If only one sprint is available, do this:

1. Add `chatCommandRegistry.ts`
2. Add `chatCommandRouter.ts`
3. Move `chatSlashCommands.ts` to be a view over the registry
4. Route `/help` output from the registry
5. Register existing executors as command handlers
6. Move `/wiki` and `/research` out of hidden local-regex-only territory into first-class registry commands
7. Move `FloatingChat` and `ChatTab` onto the same palette hook

That gets the best ratio of speed to visible improvement.

## Suggested File Ownership

Create:

- `src/lib/chatCommandRegistry.ts`
- `src/lib/chatCommandRouter.ts`
- `src/lib/chatCommandTypes.ts`
- `src/components/chat/SlashCommandPalette.tsx`
- `src/hooks/useChatCommandPalette.ts`

Refactor:

- `src/lib/chatSlashCommands.ts`
- `src/lib/conversationalRouter.ts`
- `src/lib/swanbot.ts`
- `src/screens/circles/tabs/ChatTab.tsx`
- `src/components/FloatingChat.tsx`

Leave mostly intact:

- `src/lib/githubChatCommands.ts`
- `src/lib/roomChatCommands.ts`
- `src/lib/wordpressChatCommands.ts`
- `src/lib/missionChatCommands.ts`
- `src/lib/huggingFaceChatCommands.ts`

## User Experience Rules

These rules should be enforced by architecture, not just convention.

### Rule 1

If no explicit command is confidently detected, stay in normal chat.

### Rule 2

If the user did not choose an OpenSwan mode, do not route into OpenSwan.

### Rule 3

If a command is shown in autocomplete/help, it must be executable or clearly disabled with a reason.

### Rule 4

Side-effecting commands should prefer confirmation when intent confidence is not high.

### Rule 5

Every command result should either finish the task or suggest the next obvious action.

## External References

The target architecture above follows patterns used in mature command systems:

- VS Code separates command registration from discoverability metadata, and uses menu visibility/enablement to avoid clutter:
  - https://code.visualstudio.com/api/extension-guides/command
- Discord’s application commands require unique command definitions and support dynamic autocomplete from structured command metadata:
  - https://docs.discord.com/developers/interactions/application-commands
- React Aria’s ComboBox supports controlled input/value, create-item actions, validation, manual triggering, and empty collections, which maps well to a command palette UI:
  - https://react-aria.adobe.com/ComboBox
- Jira treats command palette use as distinct from free-text editing, which reinforces keeping command invocation separate from ordinary typing behavior:
  - https://support.atlassian.com/jira-software-cloud/docs/what-is-the-command-palette/

## Final Recommendation

Build a unified command registry first.

Not because it is the most elegant architecture, but because it is the smallest change that fixes the biggest class of user-facing problems:

- inconsistent help
- inconsistent slash suggestions
- hidden command behavior
- accidental routing
- OpenSwan confusion

If this registry exists, the rest becomes tractable.
If it does not, every new command will keep making the chat stack less predictable.
