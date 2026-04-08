# Hugging Face Tools In Chat Implementation Spec

Date: 2026-04-05
Repo: `the-underground-circle`
Depends on: `hugging-face-tools-in-chat-deep-audit-2026-04-05.md`
Audience: Claude or another implementation agent
Goal: make Hugging Face tools first-class in chat without making chat noisy, opaque, or unsafe

## Product goal

Turn chat HF usage from:

- hidden tool calls behind a generic assistant reply

into:

- explicit chat commands
- typed tool actions
- typed output cards
- run provenance
- promotion actions into tasks, rooms, and feed artifacts

## Core product constraints

### Keep the new chat shell as the main target

The implementation should target:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

Do not center the new work around legacy:

- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)

Legacy chat can inherit improvements later if needed.

### Do not expose raw backend tool names as the product API

Users should see:

- `/openmodel`
- `/summarize`
- `/translate`
- `/ocr`
- `/vision`
- `/imagine`

not:

- `hf_chat`
- `hf_vision`
- `hf_generate_image`

### Do not enable all HF tools as ambient behavior

The model should not freely fire every available HF tool in generic chat.

The initial release should distinguish:

- ambient-safe tools
- explicit-command tools
- task/workbench-first tools

## Recommended chat HF tiers

### Tier 1: chat-safe and enabled in PR1

- open-model second opinion
- summarize
- translate
- OCR / vision Q&A
- QA over user-provided context
- classify
- zero-shot classify

Mapped runtime tools:

- `hf_chat`
- `hf_summarize`
- `hf_translate`
- `hf_vision`
- `hf_qa`
- `hf_classify`
- `hf_zero_shot`

### Tier 2: explicit command + typed artifact support in PR1 or PR2

- image generation
- text to speech
- transcription

Mapped runtime tools:

- `hf_generate_image`
- `hf_text_to_speech`
- `hf_transcribe`

### Tier 3: not default chat tools in PR1

- embeddings
- similarity
- code generation

Mapped runtime tools:

- `hf_embeddings`
- `hf_similarity`
- `hf_code`

These should stay:

- command-only later
- or routed through task/workbench surfaces first

## Target response model

The current chat flow only receives final text.

That is insufficient.

The chat runtime should receive a structured response envelope from `swanbot-ai`.

### Proposed envelope

```json
{
  "response": "final user-facing assistant text",
  "usage": {
    "model": "claude-haiku",
    "input_tokens": 100,
    "output_tokens": 200,
    "total_tokens": 300
  },
  "tool_actions": [
    {
      "kind": "hf_tool",
      "tool_name": "hf_translate",
      "title": "Translated text to French",
      "status": "completed",
      "model": "facebook/mbart-large-50-many-to-many-mmt",
      "input_preview": "Translate this status update...",
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

## Type changes

Update:

- [chatTypes.ts](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/chatTypes.ts)

### New step kinds

Extend `ChatStepKind` to include:

- `hf_tool`
- `hf_compare`

### New artifact kinds

Extend `ChatArtifactKind` to include:

- `image`
- `audio`
- `transcript`
- `translation`
- `classification`
- `comparison`
- `vision`

### New metadata types

Add interfaces:

- `ChatToolAction`
- `ChatHfArtifactMetadata`

### Command additions

Extend `CHAT_COMMANDS` with:

- `/openmodel`
- `/compare-models`
- `/summarize`
- `/translate`
- `/ocr`
- `/vision`
- `/qa`
- `/classify`
- `/zero-shot`
- `/imagine`
- `/speak`
- `/transcribe`

Initial enabled state:

- enable Tier 1 commands
- enable `/imagine`
- disable `/speak` and `/transcribe` only if the artifact UI is not ready yet

## Persistence changes

The existing chat persistence is already close to sufficient.

Primary file:

- [chatSessions.ts](/Users/cswanson/the-underground-circle/src/lib/chatSessions.ts)

### Keep existing tables

Use the existing:

- `chat_runs`
- `chat_run_steps`
- `chat_run_artifacts`

### No mandatory schema rewrite for PR1

PR1 can likely ship without a new migration if existing `metadata`, `content`, and `url` fields are used well.

Preferred artifact mapping:

- image:
  - `artifact_kind = 'image'`
  - `url = data URL or storage URL`
- audio:
  - `artifact_kind = 'audio'`
  - `url = data URL or storage URL`
- translation:
  - `artifact_kind = 'translation'`
  - `content = translated text`
- classification:
  - `artifact_kind = 'classification'`
  - `metadata = labels/scores`
- transcript:
  - `artifact_kind = 'transcript'`
  - `content = transcript text`
- comparison:
  - `artifact_kind = 'comparison'`
  - `metadata = compared models/results`

If the current DB enum constraints do not allow those values, add a small migration to expand chat artifact kinds.

## Runtime policy layer

Add a small frontend registry:

- `src/lib/chatToolPolicies.ts`

It should define:

- user-visible command
- backing HF tool
- tier
- allowed in ambient chat
- requires explicit command
- output artifact kind
- whether save/promote actions are supported

### Example shape

```ts
export interface ChatToolPolicy {
  command: string;
  label: string;
  backendToolName: string;
  tier: 1 | 2 | 3;
  ambientAllowed: boolean;
  explicitOnly: boolean;
  artifactKind?: ChatArtifactKind;
}
```

## `swanbot-ai` changes

Primary file:

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

### Required changes

1. Return structured `tool_actions`.
2. Return structured `artifacts`.
3. Add enough metadata to reconstruct chat run steps.
4. Preserve the existing `response` field for backward compatibility.

### Tool action capture

When a HF tool runs, capture:

- `tool_name`
- `status`
- `model`
- `title`
- `input_preview`
- `output_preview`
- `metadata`

### Artifact capture

Map tool outputs into artifacts:

- `hf_generate_image` -> image artifact
- `hf_text_to_speech` -> audio artifact
- `hf_transcribe` -> transcript artifact
- `hf_translate` -> translation artifact
- `hf_classify` / `hf_zero_shot` -> classification artifact
- `hf_vision` -> vision artifact
- `hf_chat` compare mode -> comparison artifact

## `swanbot.ts` changes

Primary file:

- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)

### Required change

Add a richer chat-call function alongside `getSwanBotResponse(...)`.

Suggested API:

```ts
export interface SwanBotStructuredResponse {
  response: string;
  usage?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  tool_actions?: Array<Record<string, any>>;
  artifacts?: Array<Record<string, any>>;
}

export async function getSwanBotStructuredResponse(
  message: string,
  context: SwanBotContext
): Promise<SwanBotStructuredResponse>
```

Keep `getSwanBotResponse(...)` as a wrapper for legacy callers.

## `ChatTabShell` changes

Primary file:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

### Required changes

1. Use `getSwanBotStructuredResponse(...)` instead of only text.
2. Convert `tool_actions` into `chat_run_steps`.
3. Convert `artifacts` into `chat_run_artifacts`.
4. Append assistant text entry as before.
5. Use the final assistant text for run summary, but do not lose tool provenance.

### Run step mapping

Examples:

- initial step:
  - `status` / `Thinking`
- HF tool step:
  - `hf_tool` / `Translated text`
- final step:
  - `output` / `Response ready`

### Artifact mapping

Use `chatDB.appendArtifact(...)` for all returned artifacts.

If the helper does not exist yet, add it in `chatSessions.ts`.

## `ChatComposer` changes

Primary file:

- [ChatComposer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx)

### Required changes

1. Add command suggestions for Tier 1 HF commands.
2. Add a lightweight quick-action row for the most useful ones:
   - `Open model`
   - `Summarize`
   - `Translate`
   - `Vision`
   - `Imagine`
3. When a command is selected, prefill a friendly command template.

### Example quick templates

- `/openmodel `
- `/summarize `
- `/translate to:fr `
- `/vision `
- `/imagine `

## Transcript and artifact UI

### Add new renderer component

Create:

- `src/screens/circles/tabs/chat/HfArtifactCard.tsx`

Support:

- image preview
- audio card
- transcript card
- translation card
- classification chip card
- comparison card

### Update transcript

Primary file:

- `src/screens/circles/tabs/chat/ChatTranscript.tsx`

The transcript should render artifact cards under the relevant assistant output or run reference.

### Update run inspector

Primary file:

- `src/screens/circles/tabs/chat/RunInspector.tsx`

The inspector should show:

- tool steps with tool name and model
- artifact previews
- promotion actions placeholders if not implemented yet

## Suggested command parsing behavior

The chat shell does not need a huge parser in PR1.

Simple command detection is enough:

- `/openmodel prompt...`
- `/summarize text...`
- `/translate to:fr text...`
- `/vision <url or attachment> question...`
- `/imagine prompt...`

The frontend can pass the raw command text through unchanged.

The backend prompt/tool layer can interpret it first.

## Promotion actions

Do not fully implement cross-surface promotion in PR1 unless it is cheap.

But the artifact cards should reserve actions for:

- `Save to task`
- `Save to room`
- `Post to feed`
- `Reuse prompt`

Buttons can be disabled placeholders if necessary.

## PR1 scope

Deliver:

- structured SwanBot response envelope
- Tier 1 HF chat commands
- optional `/imagine`
- tool-step capture in chat runs
- typed artifact rendering
- run inspector HF provenance

Do not deliver:

- embeddings and similarity as default chat features
- code generation as generic chat behavior
- full cross-surface promotion implementation
- complex multi-model comparison UI unless easy

## Acceptance criteria

PR1 is successful when:

1. A chat user can intentionally invoke Tier 1 HF tools through visible commands.
2. A HF-backed chat reply creates one or more run steps beyond generic thinking/output.
3. Image, translation, transcript, and classification outputs can render as typed artifacts instead of plain text blobs.
4. The run inspector shows which HF tool ran and which model it used.
5. Legacy callers of `getSwanBotResponse(...)` still work.
6. The chat surface remains readable and not overloaded even when HF commands are enabled.

## Recommended implementation order

1. Add structured response support in `swanbot-ai`.
2. Add structured client wrapper in `swanbot.ts`.
3. Expand chat types and persistence helpers.
4. Refactor `ChatTabShell` to persist tool steps and artifacts.
5. Add HF commands and quick actions in `ChatComposer`.
6. Add `HfArtifactCard` and renderers in transcript/inspector.
7. Verify Tier 1 commands end-to-end.

## Bottom line

The core implementation challenge is not adding more Hugging Face backend code.

It is teaching chat how to understand, display, and govern HF tool use.

The shortest path is:

- structured response envelope
- typed run steps
- typed artifact cards
- command-first access to the chat-native HF subset

That will give Claude a clean first pass without forcing a full chat-runtime rewrite.
