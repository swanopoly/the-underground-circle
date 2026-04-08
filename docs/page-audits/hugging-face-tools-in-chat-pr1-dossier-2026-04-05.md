# Hugging Face Tools In Chat PR1 Dossier

Date: 2026-04-05
Repo: `the-underground-circle`
Audience: Claude or another implementation agent
Depends on:

- `hugging-face-tools-in-chat-deep-audit-2026-04-05.md`
- `hugging-face-tools-in-chat-implementation-spec-2026-04-05.md`

## Why this file exists

The audit and implementation spec explain:

- why HF tools should be added to chat carefully
- what the target product model should become

This file answers the narrower question:

- what should the first pull request actually contain

## PR1 goal

Make the new chat shell capable of:

1. explicitly invoking the chat-safe Hugging Face subset
2. recording those invocations as run steps
3. rendering HF outputs as typed artifacts
4. exposing enough provenance that a user can understand what happened

## PR1 non-goals

Do not attempt these in the first pass:

- full ambient access to every HF tool
- a complete promotion flow into tasks/rooms/feed
- embeddings and similarity as default chat features
- code generation as a generic-chat default
- a full comparison workbench
- legacy `ChatTab` parity

## Exact PR1 tool scope

### Include in PR1

- `/openmodel`
- `/summarize`
- `/translate`
- `/vision`
- `/qa`
- `/classify`
- `/zero-shot`
- `/imagine`

Mapped backend tools:

- `hf_chat`
- `hf_summarize`
- `hf_translate`
- `hf_vision`
- `hf_qa`
- `hf_classify`
- `hf_zero_shot`
- `hf_generate_image`

### Exclude from PR1

- `/speak`
- `/transcribe`
- `/compare-models`
- embeddings
- similarity
- code generation

Those can follow once the first artifact flow is stable.

## Exact deliverables

### 1. Structured SwanBot response

Update:

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

Return a response envelope with:

- `response`
- `usage`
- `tool_actions`
- `artifacts`

Preserve existing `response` for compatibility.

### 2. New structured SwanBot client wrapper

Update:

- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)

Add:

- `getSwanBotStructuredResponse(...)`

Keep:

- `getSwanBotResponse(...)`

as a compatibility wrapper.

### 3. Chat type expansion

Update:

- [chatTypes.ts](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/chatTypes.ts)

Add:

- HF-capable artifact kinds
- HF-capable step kinds
- new chat command entries

### 4. Chat persistence helper expansion

Update:

- [chatSessions.ts](/Users/cswanson/the-underground-circle/src/lib/chatSessions.ts)

Add or confirm helpers for:

- appending run artifacts
- loading run artifacts
- mapping new artifact kinds

If helper names already exist, reuse them.

### 5. Chat shell runtime update

Update:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

Replace the plain-text response path with:

- structured response handling
- tool step persistence
- artifact persistence
- assistant text entry persistence

### 6. Chat composer HF commands

Update:

- [ChatComposer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx)

Add:

- new command suggestions
- a small quick-action row for HF chat tools

### 7. Artifact rendering

Add:

- `src/screens/circles/tabs/chat/HfArtifactCard.tsx`

Update:

- `src/screens/circles/tabs/chat/ChatTranscript.tsx`
- `src/screens/circles/tabs/chat/RunInspector.tsx`

## Exact response-envelope draft

PR1 should keep the payload minimal and deterministic.

Suggested shape:

```json
{
  "response": "Here’s the translated version...",
  "usage": {
    "model": "claude-haiku",
    "input_tokens": 420,
    "output_tokens": 260,
    "total_tokens": 680
  },
  "tool_actions": [
    {
      "kind": "hf_tool",
      "tool_name": "hf_translate",
      "title": "Translated text",
      "status": "completed",
      "model": "facebook/mbart-large-50-many-to-many-mmt",
      "input_preview": "Translate this project update...",
      "output_preview": "Texte traduit...",
      "metadata": {
        "target_language": "fr_XX"
      }
    }
  ],
  "artifacts": [
    {
      "kind": "translation",
      "title": "French translation",
      "content": "Texte traduit...",
      "url": null,
      "metadata": {
        "tool_name": "hf_translate",
        "model": "facebook/mbart-large-50-many-to-many-mmt"
      }
    }
  ]
}
```

## Exact file-by-file patch plan

### `supabase/functions/swanbot-ai/index.ts`

Ownership:

- response envelope generation
- tool action collection
- artifact collection

Required change list:

1. Create arrays for `tool_actions` and `artifacts`.
2. On each HF tool execution, push a normalized action object.
3. For supported tools, push a normalized artifact object.
4. Return the arrays in the final JSON response.

PR1 artifact mapping:

- `hf_generate_image` -> `image`
- `hf_translate` -> `translation`
- `hf_classify` -> `classification`
- `hf_zero_shot` -> `classification`
- `hf_vision` -> `vision`
- `hf_qa` -> `summary`
- `hf_summarize` -> `summary`
- `hf_chat` -> no artifact by default unless explicitly compare-oriented

### `src/lib/swanbot.ts`

Ownership:

- structured client response wrapper

Required change list:

1. Add `SwanBotStructuredResponse` type.
2. Add `callSwanBotAIStructured(...)`.
3. Add `getSwanBotStructuredResponse(...)`.
4. Keep `getSwanBotResponse(...)` by reading `.response`.

### `src/screens/circles/tabs/chat/chatTypes.ts`

Ownership:

- new command entries
- step/artifact enum expansion

Required change list:

1. Add `hf_tool` to `ChatStepKind`.
2. Add `image`, `translation`, `classification`, `vision` to `ChatArtifactKind`.
3. Add PR1 command entries to `CHAT_COMMANDS`.

### `src/lib/chatSessions.ts`

Ownership:

- artifact persistence

Required change list:

1. Confirm artifact insert helper exists; if not, add `appendArtifact(...)`.
2. Ensure artifact mappers do not choke on new kinds.
3. Keep metadata pass-through.

### `src/screens/circles/tabs/chat/ChatTabShell.tsx`

Ownership:

- structured response handling
- step creation
- artifact persistence

Required change list:

1. Replace `getSwanBotResponse(...)` call with `getSwanBotStructuredResponse(...)`.
2. Append one `hf_tool` step for each tool action.
3. Append one chat artifact per returned artifact.
4. Append the assistant message entry with `response`.
5. Update run summary from `response`.

Suggested step mapping:

- step 0:
  - `status`
  - title `Thinking`
- step 1..n:
  - `hf_tool`
  - title from action title
- final step:
  - `output`
  - title `Response ready`

### `src/screens/circles/tabs/chat/ChatComposer.tsx`

Ownership:

- command discoverability

Required change list:

1. Add the PR1 HF commands into command suggestions.
2. Add a quick-action strip for:
   - `Open model`
   - `Summarize`
   - `Translate`
   - `Vision`
   - `Imagine`
3. Make quick actions prefill command templates rather than auto-send.

### `src/screens/circles/tabs/chat/HfArtifactCard.tsx`

Ownership:

- all PR1 HF artifact rendering

Required views:

- image preview card
- translation card
- classification card
- summary/vision card

### `src/screens/circles/tabs/chat/ChatTranscript.tsx`

Ownership:

- render artifact cards near associated run output

PR1 can render artifacts grouped by run rather than perfectly interleaved.

### `src/screens/circles/tabs/chat/RunInspector.tsx`

Ownership:

- render HF tool provenance and artifact cards

Show:

- tool name
- tool model
- input preview
- output preview

## Exact command behaviors

### `/openmodel`

Intent:

- explicit open-model second opinion

Backend expectation:

- bias toward `hf_chat`

### `/summarize`

Intent:

- summarize pasted text or conversation

Backend expectation:

- bias toward `hf_summarize`

### `/translate`

Intent:

- translate text

Suggested syntax:

- `/translate to:fr your text`

### `/vision`

Intent:

- answer a question about an image or screenshot

Suggested syntax:

- `/vision <url> what does this screen say?`

### `/qa`

Intent:

- answer a question over user-provided context

Suggested syntax:

- `/qa q:What failed? context:...`

### `/classify`

Intent:

- sentiment or classification

Suggested syntax:

- `/classify this launch post`

### `/zero-shot`

Intent:

- classify with custom labels

Suggested syntax:

- `/zero-shot labels:bug,feature,question text:...`

### `/imagine`

Intent:

- generate an image from text

Suggested syntax:

- `/imagine neon green dashboard with soft bubbles`

## Acceptance criteria

PR1 is mergeable when:

1. The new chat shell can issue at least one explicit HF command and receive a structured response.
2. A HF-backed run records one or more `hf_tool` steps.
3. A translation result renders as a translation artifact card.
4. An image result renders as an image artifact card.
5. A classification result renders as structured chips or equivalent typed output.
6. The run inspector shows tool provenance for HF-backed runs.
7. Existing plain-text chat still works when no HF tool is involved.
8. Legacy callers of `getSwanBotResponse(...)` still get a string.

## Recommended implementation order

1. `swanbot-ai` structured envelope
2. `swanbot.ts` wrapper
3. `chatTypes.ts` enum/command expansion
4. `chatSessions.ts` artifact helper cleanup
5. `ChatTabShell.tsx` structured persistence
6. `HfArtifactCard.tsx`
7. `ChatTranscript.tsx` and `RunInspector.tsx`
8. `ChatComposer.tsx`

## Verification checklist for Claude

Before calling PR1 done, verify:

- `/summarize` produces a summary artifact
- `/translate` produces a translation artifact
- `/classify` produces a classification artifact
- `/imagine` produces an image artifact
- a normal non-command prompt still returns a normal assistant reply
- chat layout still works on mobile and desktop

## Bottom line

The smallest successful PR1 is not “all HF tools everywhere.”

It is:

- structured backend envelope
- explicit chat-safe commands
- typed artifact rendering
- HF provenance in chat runs

That gives Claude a clean, bounded first implementation that the app can safely expand later.
