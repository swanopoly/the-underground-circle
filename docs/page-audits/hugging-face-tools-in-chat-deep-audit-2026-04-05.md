# Hugging Face Tools In Chat Deep Audit

Date: 2026-04-05
Repo: `the-underground-circle`
Scope:

- adding Hugging Face tools to the chat surfaces
- legacy `ChatTab`
- newer `ChatTabShell`
- BlackSwan HF tool execution path
- product, code, and UX implications of exposing all HF tools in chat

## Executive summary

The backend already has almost all of the Hugging Face tooling needed for chat.

The real problem is not missing backend tools.

The real problem is that the chat surfaces do not yet have:

- a first-class chat tool model
- explicit HF commands
- artifact handling for HF outputs
- per-surface policy on which HF tools belong in chat
- run provenance for HF tool use

Current state:

- `swanbot-ai` already exposes a broad HF tool set
- legacy `ChatTab` can benefit from that indirectly through BlackSwan
- newer `ChatTabShell` creates runs and steps, but does not expose HF tool use as a visible part of the chat runtime

Main conclusion:

you should not blindly add every Hugging Face tool to chat as ambient background power.

You should split them into:

1. chat-safe tools that belong in everyday chat
2. heavy or artifact-producing tools that need explicit commands and output cards
3. task/workbench tools that should stay in Feed/Office/Rooms unless intentionally invoked

## Current architecture

### BlackSwan already exposes a broad HF tool set

Primary file:

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

Current HF tools exposed there:

- `hf_generate_image`
- `hf_summarize`
- `hf_classify`
- `hf_translate`
- `hf_text_to_speech`
- `hf_chat`
- `hf_embeddings`
- `hf_zero_shot`
- `hf_transcribe`
- `hf_similarity`
- `hf_code`
- `hf_vision`
- `hf_qa`

This means the backend side is already far ahead of the frontend chat product.

### The edge tool loop is only visible indirectly in chat

Relevant code:

- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)
- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

`getSwanBotResponse(...)` calls `swanbot-ai`, but the chat shell only stores:

- a generic “thinking” step
- a final text output step

It does not currently store:

- which HF tool was used
- which model was used for the HF sub-call
- what artifact was produced
- whether the output should render as image/audio/transcript/classification instead of plain text

### Legacy chat is broad but messy

Primary file:

- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)

Legacy chat has many surface-level affordances and the older BlackSwan integration path, but it is still not a clean tool-oriented chat surface.

### New chat is structurally better, but tool-poor

Primary files:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [ChatComposer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx)

The new chat shell already has:

- sessions
- runs
- run steps
- run inspector
- command suggestions
- model selection

That is the correct foundation for HF tools in chat.

The missing piece is a typed tool/runtime layer.

## Primary findings

### Finding 1. The backend already supports “all HF tools in chat” in principle

Severity: high

Because `swanbot-ai` already exposes the HF tool list and can run them in its tool loop, the backend is not the main blocker.

Evidence:

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

Impact:

- adding HF tools to chat is mostly a product/runtime/UI problem now

### Finding 2. The new chat shell cannot represent HF results properly yet

Severity: high

`ChatTabShell` treats the assistant response as plain text and records only very generic run steps.

Evidence:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

Impact:

- image generation has no proper image artifact card
- TTS has no audio artifact card
- embeddings and similarity have no structured result UI
- classification and zero-shot outputs become flattened prose instead of chips/tables
- no traceable tool provenance in the run inspector

Recommendation:

- add typed HF chat artifacts and tool-step records before exposing the full tool set

### Finding 3. `getSwanBotResponse(...)` is too opaque for a tool-rich chat

Severity: high

The frontend gets only the final text back from `getSwanBotResponse(...)`.

Evidence:

- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)

Impact:

- chat cannot know whether HF was used
- chat cannot present tool results as structured UI
- chat cannot differentiate “model answered directly” from “model invoked HF”

Recommendation:

- introduce a richer response contract for chat runs:
  - final text
  - tool actions
  - artifacts
  - model provenance

### Finding 4. Adding every HF tool to ambient chat would create bad UX

Severity: high

Some HF tools are chat-native. Some are not.

Chat-native:

- `hf_chat`
- `hf_summarize`
- `hf_translate`
- `hf_vision`
- `hf_qa`
- `hf_zero_shot`
- `hf_classify`

Sometimes chat-native:

- `hf_generate_image`
- `hf_text_to_speech`
- `hf_transcribe`

Usually not ambient-chat-native:

- `hf_embeddings`
- `hf_similarity`
- `hf_code`

Impact:

- if everything is ambient, the model can overfire tools and clutter chat
- users will get mixed output types without clear framing
- tool choice becomes unpredictable

Recommendation:

- chat should expose tools through explicit commands, suggestions, and typed output cards

### Finding 5. The composer does not have HF-specific affordances

Severity: medium-high

`ChatComposer` supports generic slash commands, but there are no HF-specific visible actions.

Evidence:

- [ChatComposer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx)

Impact:

- users do not know HF tools exist
- chat does not teach the user what the surface can do

Recommendation:

- add command suggestions and quick actions for the HF-safe chat tools

### Finding 6. HF outputs are not integrated with chat run artifacts or approvals

Severity: medium-high

The newer chat system already has runs, steps, artifacts, and approvals, but HF execution does not feed that system cleanly yet.

Impact:

- the app cannot support:
  - save image to task
  - save transcript to room
  - compare two open-model answers
  - reuse translation output

Recommendation:

- HF tool use in chat should write:
  - run steps
  - typed artifacts
  - optional promotion actions

### Finding 7. There is no chat policy separation between lightweight HF use and workbench HF use

Severity: medium

The app currently lacks an explicit rule about which HF tools belong in main chat versus Office or Feed.

Recommendation:

- define a chat-safe HF subset first

## Research synthesis

### Hugging Face chat-completion support maps well to tool-rich chat

Official docs show Hugging Face’s inference clients now support:

- OpenAI-compatible chat completions
- tool choice
- tools
- streamed and structured outputs

Source:

- https://huggingface.co/docs/huggingface_hub/en/package_reference/inference_client

Implication:

- the app’s chat runtime can treat HF-backed open-model chat as a first-class chat pathway, not just as a hidden side tool

### Hugging Face task endpoints support a broad chat utility layer

Official task docs confirm HF is strong for:

- chat completion
- speech recognition
- text to speech
- text to image
- classification
- embeddings
- question answering

Sources:

- https://huggingface.co/docs/inference-providers/en/tasks/index
- https://huggingface.co/docs/inference-providers/tasks/chat-completion
- https://huggingface.co/docs/inference-providers/tasks/automatic-speech-recognition
- https://huggingface.co/docs/inference-providers/tasks/text-to-speech

Implication:

- a chat product can reasonably expose a broad open-model utility toolkit
- but only if the outputs are typed and the policies are clear

## Which HF tools should be added to chat

### Tier 1: add immediately to chat

These belong in everyday chat and should be directly supported.

- `hf_chat`
  - use for open-model second opinions and model comparison
- `hf_summarize`
  - use for summarizing pasted text, tasks, docs, long replies
- `hf_translate`
  - use for direct multilingual chat support
- `hf_vision`
  - use for screenshot explanation, OCR, and image Q&A
- `hf_qa`
  - use when the user provides context and a specific question
- `hf_classify`
  - use for quick sentiment or category labeling
- `hf_zero_shot`
  - use for user-defined categorization in chat

### Tier 2: add with explicit artifact cards

These should be available, but only with proper output UI.

- `hf_generate_image`
  - requires image result cards and save actions
- `hf_text_to_speech`
  - requires audio result cards and playback/download
- `hf_transcribe`
  - requires transcript cards and save-to-task/save-to-room actions

### Tier 3: keep command-only or task-only at first

These are useful, but not great as invisible ambient chat behaviors.

- `hf_embeddings`
  - better for search/indexing/task pipelines
- `hf_similarity`
  - better for task matching, room dedupe, feed/task workflows
- `hf_code`
  - useful, but should be routed through task/workbench or a code-aware chat mode, not generic chat by default

## Recommended chat command set

The chat surface should expose visible commands for the HF-safe tools.

Recommended commands:

- `/openmodel <prompt>`
- `/compare-models <prompt>`
- `/summarize <text>`
- `/translate <text>`
- `/ocr <image-url or attachment>`
- `/vision <image-url or attachment> <question>`
- `/qa <question>`
- `/classify <text>`
- `/zero-shot <text> labels:a,b,c`
- `/imagine <prompt>`
- `/speak <text>`
- `/transcribe <audio-url>`

Do not expose these as raw backend tool names in the UI.

Users should never have to type:

- `hf_generate_image`
- `hf_vision`

Those are runtime names, not product commands.

## Recommended chat UX

### 1. Typed result cards

Chat needs output cards for:

- image
- audio
- transcript
- summary
- classification chips
- comparison table

### 2. Tool provenance in run inspector

For each HF-backed action, show:

- tool name
- model used
- short input summary
- output artifact link
- whether it was user-commanded or model-decided

### 3. Promotion actions

Every major HF result should support:

- save to task
- save to room
- post to Feed
- reuse as follow-up prompt

### 4. Surface-safe defaults

In normal chat mode:

- allow Tier 1 tools freely

For Tier 2:

- require explicit user request or explicit command

For Tier 3:

- hide from default chat suggestions

## Code audit conclusions

### Backend changes needed

Not much is needed to expose more HF tools conceptually.

What is needed:

- richer response payload from `swanbot-ai`
- optional typed tool action list in the response
- artifact metadata for generated outputs

### Frontend changes needed

These are the real blockers.

Files most likely to change:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [ChatComposer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx)
- [ChatTranscript.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTranscript.tsx)
- [RunInspector.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/RunInspector.tsx)
- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)

New likely files:

- `src/screens/circles/tabs/chat/HfArtifactCard.tsx`
- `src/screens/circles/tabs/chat/HfComparisonCard.tsx`
- `src/lib/chatToolPolicies.ts`

## Recommended implementation direction

### PR1 for chat HF support

Deliver:

- explicit chat commands for Tier 1 HF tools
- richer `swanbot-ai` response envelope for tool actions
- run-step logging for HF tool invocations
- typed artifact rendering in transcript/inspector
- image/audio/transcript cards

Do not deliver yet:

- full ambient access to every HF tool
- embeddings/similarity as default chat behavior
- code generation as a default generic-chat path

### PR2

Deliver:

- model comparison UI
- save/promote actions
- attachment-aware OCR/vision path
- transcribe and TTS cards

### PR3

Deliver:

- feed/task integration for chat-generated HF artifacts
- room export actions
- advanced model/preset picker for HF open models

## Bottom line

The app can already run almost all Hugging Face chat tools on the backend.

What chat lacks is:

- explicit commands
- typed artifacts
- provenance
- policy

So the right move is not “turn on all HF tools in chat.”

The right move is:

- add the chat-native HF subset first
- make the outputs render correctly
- wire tool actions into chat runs
- keep heavier HF workflows explicit and artifact-driven

That is how you add all the useful Hugging Face power to chat without making chat noisy, opaque, or unreliable.
