# ChatTab Agent CLI Deep Audit

Source: `src/screens/circles/tabs/ChatTab.tsx`
Date: 2026-04-03
Scope: Deep product + code audit of the main Circle Chat, with external research against OpenCode and OpenAI Codex patterns.

## Goal

Turn Circle Chat from a social/chat-first screen into an agent-CLI surface that looks and behaves more like:

- OpenCode: https://opencode.ai/docs/tui/
- OpenCode CLI: https://opencode.ai/docs/cli/
- OpenCode permissions: https://opencode.ai/docs/permissions/
- OpenCode commands: https://opencode.ai/docs/commands/
- OpenAI Codex overview: https://openai.com/codex/
- OpenAI Codex in ChatGPT FAQ: https://help.openai.com/en/articles/11369540-codex-in-chatgpt-faq

## External Research Summary

### OpenCode patterns worth copying

From the current official docs:

- TUI-first interaction model with a single command surface.
- `@file` references that inject relevant files into context.
- `!command` shell execution as a first-class interaction.
- `/commands` as a real command system, not a couple of hardcoded chat shortcuts.
- `/details` to show tool execution details on demand.
- `/sessions` and CLI session continuation/forking.
- `/share` and export/import for durable session handoff.
- configurable permissions with explicit `allow` / `ask` / `deny`.
- custom commands that can bind prompt templates, model overrides, and agent selection.
- themeability as a first-class surface, not a bolted-on skin.

Key evidence:

- `@` file references and `!` shell commands: OpenCode TUI docs.
- slash commands like `/help`, `/models`, `/sessions`, `/share`, `/details`: OpenCode TUI docs.
- session continuation, run mode, share, attach, serve: OpenCode CLI docs.
- explicit permission model and approval semantics: OpenCode permissions docs.
- custom command system with project-level command files: OpenCode commands docs.

### OpenAI Codex patterns worth copying

From OpenAI’s current official material:

- the product is framed as a coding agent, not a casual chat bot.
- terminal, IDE, app, and cloud delegation are treated as one connected workflow.
- built-in worktrees / isolated task environments support parallel agent work.
- skills and automations are product-level concepts, not hidden implementation details.
- progress updates are visible while the agent reads, edits, runs, and tests.
- code review and task delegation are core use cases.

Key evidence:

- Codex “navigates your repo to edit files, run commands, and execute tests”: OpenAI Help Center FAQ.
- “multiple codex agents in parallel”, “worktree support”, “skills”, “automations”: OpenAI Help Center FAQ and OpenAI Codex page.
- “command center for agentic coding” and “work in parallel across projects”: OpenAI Codex page.

## Current ChatTab Reality

The current page is still a hybrid social chat screen with an AI mention hook.

Evidence:

- empty-state copy is social-first: “Talk with your crew. Play games. Challenge each other.” in `src/screens/circles/tabs/ChatTab.tsx:1130-1132`
- the screen is packed with social/game/governance/crypto shortcuts in the quick bar, including “Check In”, “New Task”, “Trivia”, “WYR”, “Hot Take”, “Step Away”, and “Nuke It” in `src/screens/circles/tabs/ChatTab.tsx:1872-1887`
- AI only activates when the message matches a quick prompt or mentions `@Agent/@BlackSwan/@SwanBot/@Swan` in `src/screens/circles/tabs/ChatTab.tsx:870-906`
- the input placeholder still says `Message your circle... @Agent to talk to AI` in `src/screens/circles/tabs/ChatTab.tsx:2401`
- bot execution is a single `getAIResponse(cleanContent, context)` call in `src/screens/circles/tabs/ChatTab.tsx:900`
- there is only a single `botTyping` boolean and no per-run task model in `src/screens/circles/tabs/ChatTab.tsx:287-289` and `src/screens/circles/tabs/ChatTab.tsx:1333-1339`
- all messages, including bot output, are still persisted into a generic `messages` table in `src/screens/circles/tabs/ChatTab.tsx:370-427`, `src/screens/circles/tabs/ChatTab.tsx:463-525`, and `src/screens/circles/tabs/ChatTab.tsx:593-679`

## Main Findings

### 1. High: the page is architecturally the wrong product shape for an agent CLI

This is the main issue.

Current behavior:

- one flat chat transcript
- social quick actions
- casual prompt categories
- one shared bot typing state
- one monolithic AI response path

Agent-CLI target behavior:

- task-oriented runs
- explicit execution state
- command grammar
- inspectable tool activity
- session/task history
- model/agent selection
- permission checkpoints

Why this matters:

- you cannot get “Codex/OpenCode feel” by reskinning the current screen
- the current mental model is “social circle chat with an AI bot”
- the target mental model is “operator console for agents”

### 2. High: ChatTab currently mixes too many product domains into one screen

Examples in the current code:

- governance commands in `src/screens/circles/tabs/ChatTab.tsx:785-868`
- wallet send flow in `src/screens/circles/tabs/ChatTab.tsx:688-758`
- Discord context injection in `src/screens/circles/tabs/ChatTab.tsx:887-898`
- check-in and task creation panels inside the quick bar in `src/screens/circles/tabs/ChatTab.tsx:1773-1829` and `src/screens/circles/tabs/ChatTab.tsx:1910-1976`
- destructive “nuke all messages” UI inside the same bar in `src/screens/circles/tabs/ChatTab.tsx:1978-2008`

Impact:

- the screen has no single interaction contract
- it teaches users to poke buttons instead of drive agents
- it makes the input box secondary instead of primary
- implementation complexity stays high while agent depth stays low

Recommendation:

- move check-ins, social games, crypto send, and governance creation out of the main CLI surface
- keep them reachable, but not as the primary interaction mode

### 3. High: the current AI execution path is too thin for agent CLI behavior

Current path:

- detect mention or prompt
- build shallow context
- optionally inject Discord summary
- call `getAIResponse`
- write one bot message

Evidence:

- `src/screens/circles/tabs/ChatTab.tsx:870-906`

What’s missing versus an agent CLI:

- no tool planning state
- no step log
- no run status transitions
- no streaming partial output
- no artifact panel
- no command approval or permission asks
- no structured command results
- no distinction between “answer”, “plan”, “execute”, “review”, and “delegate”

### 4. High: the data model is chat-message-centric, not run-centric

Current persistence revolves around `messages`.

Evidence:

- history load from `messages`: `src/screens/circles/tabs/ChatTab.tsx:370-427`
- realtime subscription to `messages`: `src/screens/circles/tabs/ChatTab.tsx:463-525`
- user message writes to `messages`: `src/screens/circles/tabs/ChatTab.tsx:593-641`
- bot message writes to `messages`: `src/screens/circles/tabs/ChatTab.tsx:652-679`

Why this blocks the redesign:

- a CLI/tasking surface needs runs, steps, approvals, artifacts, and outcomes
- a single message row is not enough to represent:
  - step-by-step task progress
  - tool call logs
  - file edits
  - command execution
  - approvals
  - retries
  - partial output
  - final summary

Recommendation:

- create a dedicated run/task schema instead of extending `messages` forever

Suggested tables:

- `chat_sessions`
- `chat_entries`
  - user/system/assistant messages only
- `chat_runs`
  - one row per agent task execution
- `chat_run_steps`
  - read file, search, plan, run command, edit file, test, summarize
- `chat_run_artifacts`
  - diffs, file refs, logs, test results, links
- `chat_run_approvals`
  - requested action, scope, state, approver
- `chat_session_context`
  - attached tasks, rooms, files, repos, docs

### 5. High: there is no command language beyond a few hardcoded shortcuts

Current command handling is limited to:

- `/poll`
- `/propose`
- `/vote`
- `/pin`
- `/pins`
- `/search`

Evidence:

- `src/screens/circles/tabs/ChatTab.tsx:785-868`

Compared to the target:

- OpenCode supports first-class slash commands, command files, command templates, per-command model/agent overrides, and session utilities.
- Current ChatTab has no command registry, no discoverability layer, no command metadata, and no structured parser.

Recommendation:

- build a command registry for ChatTab

Minimum v1 command set:

- `/help`
- `/models`
- `/agents`
- `/mode`
- `/sessions`
- `/new`
- `/resume`
- `/share`
- `/details`
- `/compact`
- `/review`
- `/plan`
- `/run`
- `/attach`

### 6. High: there is no approvals / permissions system

This is one of the most important gaps if the goal is “agent CLI”.

External benchmark:

- OpenCode explicitly supports `allow`, `ask`, and `deny` permission policies per tool/action.
- Codex distinguishes local permissions and cloud delegation controls.

Current ChatTab:

- no approval checkpoints at all
- no explicit “this action needs confirmation”
- no visibility into what the agent is trying to do

Impact:

- the page cannot safely graduate from “chat bot” to “agent operator console”
- any future tool execution will either be opaque or dangerously permissive

Recommendation:

- add explicit approval events into the run model
- approvals should render inline in the transcript and in a right-side details panel

### 7. Medium: the input and layout are still chat-centric, not console-centric

Current input:

- a simple multiline text box with a send arrow and swan shortcut
- placeholder copy still positions the surface as “message your circle”

Evidence:

- `src/screens/circles/tabs/ChatTab.tsx:2393-2415`

Target layout:

- left sidebar: sessions / workspaces / active agents
- center pane: transcript + task timeline
- right pane: details / artifacts / approvals / diff / tool logs
- sticky command composer with mode, model, target, context attachments

Recommendation:

- stop designing around a single mobile-chat input row
- redesign around a desktop-first operator console that degrades to stacked mobile panels

### 8. Medium: there is no notion of sessions, forks, or parallel runs

External benchmark:

- OpenCode supports sessions, continue, fork, share, export/import.
- Codex emphasizes parallel agents, worktrees, cloud tasks.

Current ChatTab:

- one transcript per circle
- no session boundaries
- no task lanes
- no fork or branch concept

Impact:

- different tasks pollute one conversation
- there is no clean way to preserve context for one coding thread while starting another
- reviewability is poor

Recommendation:

- split “circle chat” from “agent sessions”
- each session should have:
  - title
  - mode
  - attached context
  - selected model
  - selected agent(s)
  - list of runs
  - share/export metadata

### 9. Medium: the current visual language fights the product goal

Current surface emphasizes:

- floating emoji
- particle effects
- game prompts
- soft social framing
- reaction affordances

Evidence:

- animation-heavy helper components throughout `src/screens/circles/tabs/ChatTab.tsx`
- quick prompt catalog at the top of the file
- social empty-state and tips in `src/screens/circles/tabs/ChatTab.tsx:1130-1200`

That is not compatible with an operator-console feel.

Recommendation:

- use a terminal/workbench visual language
- fewer novelty effects
- stronger hierarchy
- tighter spacing
- monospace-first UI for execution surfaces
- visible task state chips and structured status rows

## What To Copy From OpenCode / Codex

### Interaction model

- one primary command surface
- explicit command grammar
- visible modes
- visible agent/model selection
- inspectable tool details
- session history
- share/export

### Information architecture

- tasks and sessions in the left rail
- transcript in the center
- details/artifacts in a side panel
- progress updates inline, not hidden in logs

### Power-user behavior

- `@` references for files, tasks, rooms, docs, or members
- `!` execution for approved tool actions
- `/` command palette
- keyboard-first navigation
- mode switching without leaving the composer

### Safety

- approval states
- permission profiles
- per-agent capabilities
- explicit boundaries between “plan” and “execute”

## What Not To Copy Blindly

- do not turn Circle Chat into a literal terminal emulator
- do not drop collaborative/social features entirely
- do not overload the same pane with games, governance, crypto, CLI, and team chat
- do not hide approvals in modals
- do not fake tool execution details if the backend cannot produce them

The right product split is likely:

- `Chat`: social/member conversation
- `Agent CLI` or `Ops`: tasking and execution

If the product insists on one surface, the UI still needs a hard mode switch:

- `Talk`
- `Plan`
- `Execute`
- `Review`

## Recommended Target Redesign

### Phase 1: Reposition the page

- Rename the page internally from “chat” behavior to “agent console” behavior.
- Replace social empty-state copy with operator-focused copy.
- Remove games/challenges/crypto/governance creation from the primary quick bar.
- Keep only agent-ops-first actions at the top.

Recommended top bar:

- session selector
- agent selector
- model selector
- mode selector
- details toggle
- share/export

### Phase 2: Replace the quick bar with a command palette

Primary composer behavior:

- `/` opens command list
- `@` references entities
- `#` or segmented control switches modes
- `!` requests tool/command execution

Suggested entity references:

- `@agent`
- `@task`
- `@room`
- `@doc`
- `@file`
- `@member`
- `@github`

### Phase 3: Add run objects and step logs

Each execute action should create a run card with:

- status: queued / running / waiting-approval / failed / done
- target agent(s)
- model
- mode
- start time
- step list
- outputs/artifacts

Step types:

- thinking
- search
- read
- write
- command
- test
- review
- summarize

### Phase 4: Add details panel

Right panel tabs:

- `Details`
- `Artifacts`
- `Diff`
- `Logs`
- `Approvals`

This is critical. It is the main thing the current chat lacks.

### Phase 5: Add permissions and approvals

Every tool-capable action should declare:

- requested action
- scope
- risk level
- default behavior

Examples:

- read repository files
- run shell command
- edit files
- push to repo
- use external web
- access Discord context
- send wallet transaction

### Phase 6: Split persistence

Keep:

- social chat in `messages`

Move agent execution to:

- `chat_sessions`
- `chat_runs`
- `chat_run_steps`
- `chat_run_artifacts`
- `chat_run_approvals`

## Concrete Code Refactor Recommendations

### Break up `ChatTab.tsx`

At 3180 lines, this file should not remain the main implementation surface.

Suggested split:

- `ChatTab.tsx`
  - route shell only
- `chat/useChatSessions.ts`
- `chat/useChatRuns.ts`
- `chat/useChatComposer.ts`
- `chat/useChatApprovals.ts`
- `chat/ChatSidebar.tsx`
- `chat/ChatTranscript.tsx`
- `chat/ChatComposer.tsx`
- `chat/RunCard.tsx`
- `chat/RunDetailsPanel.tsx`
- `chat/CommandPalette.tsx`
- `chat/ContextReferencePicker.tsx`

### Replace hardcoded bot trigger logic

Current logic:

- `src/screens/circles/tabs/ChatTab.tsx:870-906`

Target:

- a dispatcher that routes by mode and command type

Suggested shape:

- `parseComposerInput()`
- `resolveContextReferences()`
- `createRun()`
- `dispatchRun()`
- `subscribeRunSteps()`

### Remove non-core features from the core transcript flow

Candidates to move out of the main screen:

- trivia / hot takes / WYR
- quick poll creation
- check-in creation
- crypto send
- “nuke all messages”

### Add keyboard-first UX

Needed interactions:

- `Cmd/Ctrl+K`: command palette
- `Cmd/Ctrl+L`: focus composer
- `Esc`: close details/pickers
- up/down: session navigation
- tab: autocomplete references

## Visual Direction

Target feel:

- terminal/workbench hybrid
- dense, sharp, controlled
- low-chroma dark surface
- strong monospace usage
- one accent color, not many
- visible statuses and separators

Do not keep:

- game-show prompt grid as the hero interaction
- floating emoji as a primary delight mechanism
- glossy social chat framing as the dominant personality

## Suggested Implementation Order

1. Separate social chat and agent-run data models.
2. Build command composer, model picker, and mode selector.
3. Add session sidebar and run timeline.
4. Add details panel and approvals.
5. Move legacy social/game/crypto/governance shortcuts out of the primary path.
6. Add streaming/task-step UX.
7. Add share/export/session continuation.

## Bottom Line

If the goal is “make Circle Chat feel like OpenCode/Codex”, the current `ChatTab` should not be iterated cosmetically. It needs a product-level repositioning from:

- social circle chat with a smart bot

to:

- agent operations console with collaborative context

That means new information architecture, a new run/session model, a new command system, and a new execution UX. The current code can provide some pieces, but it is not the right foundation as-is for a serious agent-CLI surface.
