# Hugging Face Tools Feed + App Chats Deep Audit

Date: 2026-04-05
Repo: `the-underground-circle`
Scope:

- Hugging Face tooling in the Feed dashboard
- Hugging Face tool execution in BlackSwan / chats
- Office Hugging Face explorer and runner
- how Hugging Face should be leveraged across Feed, Chat, Rooms, and Office
- current code audit
- research-driven expansion recommendations

## Executive summary

The app already has a real Hugging Face integration stack.

It is not a fake button or a dead-end prototype.

Current strengths:

- a dedicated edge proxy for Hugging Face inference
- first-class BlackSwan tool definitions for multiple Hugging Face tasks
- a circle-scoped registry for saved Hugging Face tools
- Office UI for exploring and running Hugging Face models and Spaces
- Feed visibility into Hugging Face activity through `agent_activity`

Current problem:

the integration is fragmented.

Right now, Hugging Face exists in four partially disconnected ways:

1. as low-level inference plumbing in `hf-proxy`
2. as BlackSwan tool calls inside `swanbot-ai`
3. as an Office-side explorer/runner UI
4. as a retrospective activity panel in Feed

That means the app has capability, but not a coherent product model.

The main missing layer is a shared capability system that answers:

- which Hugging Face actions are allowed on which surface
- which artifacts should be saved
- which tasks should prefer Hugging Face versus another model/runtime
- how a run in Feed or chat should expose Hugging Face provenance
- when a Hugging Face tool is just inference versus when it is a reusable circle tool

The strongest direction is:

- keep `hf-proxy` as the execution backbone
- treat Hugging Face as a shared capability layer, not an Office-only feature
- move Feed from “activity viewer” to “artifact + run viewer”
- expose Hugging Face tools in main chat through explicit commands/capabilities
- keep riskier or more complex HF workflows inside Office or task runs, not ambient chat by default

## Current architecture

### 1. Circle-scoped Hugging Face tool registry exists

The app stores circle-linked Hugging Face tools in:

- [20260319_hf_tools.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260319_hf_tools.sql)

Current schema stores:

- `space_id`
- `space_name`
- `api_url`
- `input_schema`
- `output_schema`

This is useful, but narrow.

It models a saved tool as basically “a Hugging Face Space or model reference attached to a circle.”

What it does not model:

- task type compatibility
- allowed surfaces
- approval requirements
- output artifact policy
- rate/cost controls
- model/provider/task metadata

### 2. There is a real Hugging Face proxy layer

Primary runtime file:

- [hf-proxy/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/hf-proxy/index.ts)

The proxy already supports a useful set of tasks:

- chat
- text generation
- text to image
- summarization
- sentiment / classification
- embeddings / feature extraction
- translation
- text to speech
- zero-shot classification
- question answering
- image to text

It also routes through:

- `https://router.huggingface.co/v1/chat/completions`
- `https://router.huggingface.co/hf-inference/models/...`

That is a strong base because it means the app is already using Hugging Face’s routed inference model instead of hardcoding one fragile endpoint.

### 3. BlackSwan exposes Hugging Face as tool calls

Primary file:

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

BlackSwan currently exposes:

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

This is the most important existing integration point.

The app is already capable of letting Claude-backed BlackSwan delegate subproblems to Hugging Face tools.

### 4. Feed currently treats Hugging Face mostly as activity

Primary file:

- [FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)

The `HuggingSwanPanel` reads from `agent_activity` and shows:

- recent tool calls
- generated image previews
- summaries
- classifications
- translated text
- chat replies

This is useful for awareness.

It is not enough for execution.

Feed today is mostly a read-only “what happened” pane, not a control plane for Hugging Face-assisted work.

### 5. Office has the richest current HF UI

Primary files:

- [HuggingFaceExplorer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/HuggingFaceExplorer.tsx)
- [HfToolRunner.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/HfToolRunner.tsx)
- [hfService.ts](/Users/cswanson/the-underground-circle/src/lib/hfService.ts)

Office can:

- search Spaces and models
- add them to the circle
- run direct inference tasks
- run saved tools

This is currently the most developed product surface for Hugging Face.

### 6. Main chat is split

Legacy main chat:

- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)

Newer chat shell:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

Key product gap:

- legacy BlackSwan is designed around the full `swanbot-ai` tool loop
- the newer chat shell calls `getSwanBotResponse(...)`, but does not expose Hugging Face capabilities as a visible, governed part of the chat runtime

Inference:

the new chat shell likely benefits from Hugging Face only indirectly through whatever `swanbot-ai` does behind the scenes, but the user cannot see, steer, or reuse those HF capabilities as first-class chat tools.

## Primary findings

### Finding 1. Feed is visibility-only, not Hugging Face execution-native

Severity: high

The Feed dashboard shows Hugging Face activity after the fact through `agent_activity`.

Evidence:

- [FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)

Impact:

- users can see that HF was used
- users cannot configure, rerun, compare, or promote outputs into tasks/artifacts cleanly
- HF usage in Feed feels like telemetry, not leverage

Recommendation:

- make Feed task runs and Feed activity share a typed artifact model
- let Feed users convert HF outputs into task artifacts, drafts, assets, or follow-up tasks

### Finding 2. `circle_hf_tools` is under-modeled

Severity: high

The saved tool table stores basic identity metadata, but not enough operational metadata.

Evidence:

- [20260319_hf_tools.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260319_hf_tools.sql)

Missing fields:

- tool kind
- supported tasks
- allowed surfaces
- risk class
- default output artifact kind
- prompt templates
- tags
- cost / usage policy
- active / archived state

Impact:

- the app cannot cleanly decide where a tool should appear
- the same saved HF tool cannot be safely reused across Feed, Office, and chats

Recommendation:

- expand the HF tool model into a reusable capability registry

### Finding 3. BlackSwan’s HF tools are broad, but governance is weak

Severity: high

BlackSwan can already call many HF tools, but the outputs are primarily logged to `agent_activity` rather than persisted as first-class run artifacts.

Evidence:

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

Impact:

- difficult to reuse outputs across surfaces
- difficult to review provenance in task execution
- difficult to distinguish exploratory tool use from deliverable outputs

Recommendation:

- HF tool calls should optionally emit:
  - activity log
  - task/chat run artifact
  - reusable saved asset

### Finding 4. Office is the only real HF workbench

Severity: medium-high

Office has search, add, and run flows, but the rest of the app does not inherit that capability model.

Evidence:

- [HuggingFaceExplorer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/HuggingFaceExplorer.tsx)
- [HfToolRunner.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/HfToolRunner.tsx)

Impact:

- product inconsistency
- users discover HF in Office, but not where they actually do tasks or chat
- task workflows cannot take advantage of saved HF tools in a structured way

Recommendation:

- Office should remain the admin/explorer surface
- Feed and chat should consume the same underlying HF capability registry

### Finding 5. The new main chat does not yet make HF a first-class, steerable capability

Severity: medium-high

The new chat shell tracks runs and steps, but HF tool execution is not surfaced as part of that run UI.

Evidence:

- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)

Impact:

- users cannot intentionally ask for “open model second opinion”
- users cannot choose image generation / translation / OCR / embeddings as a visible action
- run provenance is missing

Recommendation:

- add explicit HF-aware commands and typed artifacts to the new chat shell

### Finding 6. The proxy is useful, but task coverage is now behind what HF supports

Severity: medium

`hf-proxy` covers useful tasks, but current Hugging Face docs now expose richer provider-routed and task-specific capabilities.

Research-based examples:

- chat completion with OpenAI-compatible format and tool support
- model/provider filtering through Hub APIs
- richer image generation and image-to-image tasks
- stronger JS client support through `huggingface.js`

Sources:

- https://huggingface.co/docs/inference-providers/tasks/chat-completion
- https://huggingface.co/docs/inference-providers/tasks/text-to-image
- https://huggingface.co/docs/inference-providers/hub-api
- https://huggingface.co/docs/huggingface.js/en/index

Impact:

- the app is using HF competently, but not fully

Recommendation:

- expand the proxy and client metadata around task routing, supported parameters, and artifact handling

### Finding 7. Saved “tools” are not clearly separated between models, Spaces, and workflows

Severity: medium

The Office explorer lets users add either Spaces or models into the same saved tool table.

Evidence:

- [HuggingFaceExplorer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/HuggingFaceExplorer.tsx)

Impact:

- ambiguous semantics
- a model is not the same thing as a Space
- a Space is not the same thing as a workflow template

Recommendation:

- split saved HF items into:
  - model presets
  - Spaces/apps
  - workflow tools

### Finding 8. Artifact persistence is weak for image/audio outputs

Severity: medium

The HF path often returns base64 or inline results, but the app does not consistently elevate them into durable storage-backed assets.

Evidence:

- [hf-proxy/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/hf-proxy/index.ts)
- [HfToolRunner.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/HfToolRunner.tsx)

Impact:

- poor reuse
- fragile large payload handling
- inconsistent app-wide sharing of generated outputs

Recommendation:

- persist image/audio/doc artifacts into storage and reference them from runs, feed items, and task artifacts

## Research synthesis

### Hugging Face Inference Providers now fit the app’s architecture well

Official docs indicate Hugging Face supports:

- OpenAI-compatible chat completion routing
- multiple task-specific endpoints
- provider/model routing
- structured tool-call compatible chat completion

This matches the app’s architecture direction because the app already uses:

- provider routing
- task-based execution
- agent runs

Relevant sources:

- Chat completion:
  - https://huggingface.co/docs/inference-providers/tasks/chat-completion
- Task index:
  - https://huggingface.co/docs/inference-providers/en/tasks/index
- Inference client:
  - https://huggingface.co/docs/huggingface_hub/en/package_reference/inference_client

Implication:

- Hugging Face should not be treated as just “a few fun tools”
- it should be treated as a routed capability backend for open-model tasks

### Hub APIs are strong enough to power better model/tool discovery

Official docs show Hub APIs can:

- list provider-backed models
- filter by task
- query model inference availability

Source:

- https://huggingface.co/docs/inference-providers/hub-api

Implication:

- the app should stop treating model discovery as static presets alone
- it can build live filtered pickers for:
  - open chat models
  - image models
  - embedding models
  - vision models
  - audio models

### Spaces are better suited to app-like tools than raw models

Official docs describe Spaces as hosted apps built with:

- Gradio
- Docker
- static HTML/JS

Source:

- https://huggingface.co/docs/hub/spaces

Implication:

- Spaces belong in the app as interactive workbenches or specialized tools
- raw models belong in the app as inference backends
- these should not be stored as the same product primitive

### The official JS stack is now mature enough for richer frontend tooling

Source:

- https://huggingface.co/docs/huggingface.js/en/index

Implication:

- the app can move beyond ad hoc fetches in some surfaces
- it can standardize HF metadata access, client behaviors, and task wrappers more cleanly

## What Hugging Face should do in each surface

### Feed

Feed should become:

- the review and artifact surface for HF-assisted work

Feed should support:

- viewing HF-generated artifacts inside task runs
- rerunning a task with a different open model
- comparing two open-model outputs
- promoting HF output into:
  - a task comment
  - a task artifact
  - a follow-up task
  - a room document

Feed should not become:

- the primary admin panel for browsing all HF Spaces and models

### Main chat

Main chat should use HF for:

- second-opinion open model replies
- lightweight summarization
- translation
- OCR / screenshot explanation
- quick image generation

Main chat should expose these as explicit actions:

- `/openmodel`
- `/summarize`
- `/translate`
- `/vision`
- `/imagine`

Main chat should not expose:

- broad arbitrary Space execution
- all low-level HF parameters by default

### Rooms

Rooms should use HF for:

- room document summarization
- clustering / similarity across room notes
- OCR/captioning on room images
- translation for shared docs
- room-specific asset generation

Rooms should not default to:

- ambient image generation spam
- expensive open-model experimentation without task context

### Office

Office should remain:

- the discovery surface
- the admin surface
- the experimental workbench

Office should own:

- browsing and saving HF models/Spaces
- advanced runner controls
- tool configuration
- policy management
- usage analytics

## Recommended target model

The app needs a unified Hugging Face capability system with three layers.

### Layer 1. HF capability definitions

Examples:

- `hf_open_chat`
- `hf_summary`
- `hf_translation`
- `hf_image_generate`
- `hf_image_edit`
- `hf_ocr_vision`
- `hf_embeddings`
- `hf_similarity`
- `hf_audio_transcribe`
- `hf_tts`

Each capability should define:

- supported tasks
- default model
- allowed surfaces
- artifact kind
- whether it is safe for ambient chat
- whether approval is needed

### Layer 2. Saved HF resources

Types:

- `model`
- `space`
- `workflow`

Each resource should store:

- label
- hf id
- task family
- capabilities
- input schema
- output schema
- allowed surfaces
- visibility
- active state

### Layer 3. Run artifacts and provenance

Every HF invocation should be able to produce:

- activity log row
- artifact row
- run step row
- optional saved asset

That is the missing connection between Feed, chat, and Office.

## Concrete features to add

### 1. Feed-side “rerun with open model”

For summaries, classifications, and image prompts:

- pick another HF model
- rerun on the same input
- compare outputs side by side

### 2. HF artifact promotion flow

From any HF result:

- save to task artifact
- save to room
- post to chat
- attach to feed entry

### 3. Main chat command pack for Hugging Face

Add visible commands:

- `/openmodel`
- `/second-opinion`
- `/summarize`
- `/translate`
- `/ocr`
- `/imagine`

These should map to the same shared capability registry, not bespoke chat logic.

### 4. Feed task capability bundles should include Hugging Face

Examples:

- `research_basic` gets summary, translation, open chat
- `ui_design` gets image generate, image edit, vision
- `browser_qa` gets OCR and screenshot explanation
- `content_editorial` gets summarize, classify, translate, rewrite

### 5. Hugging Face comparison mode

Useful for:

- “compare Qwen vs DeepSeek vs Llama”
- “compare two image models on the same prompt”
- “compare two summary models on the same PR”

This is a high-value product differentiator because it makes open-model experimentation actionable.

### 6. Better model discovery and filtering

Use live Hub API filters for:

- task type
- provider availability
- trending
- likes/downloads
- vision/audio/image/code support

### 7. Stronger artifact persistence

Persist:

- images
- audio
- transcripts
- extracted text
- summaries
- comparison reports

into storage-backed records, not only inline JSON bodies.

### 8. Surface-specific policies

Examples:

- main chat: safe lightweight HF actions only
- Feed task runs: richer capability bundles, tracked as artifacts
- Office: full explorer/admin runner
- Rooms: document and asset workflows only

## Recommended schema direction

The app should eventually move beyond `circle_hf_tools`.

Suggested future tables:

- `circle_hf_resources`
- `hf_capability_policies`
- `hf_run_artifacts`
- `hf_saved_outputs`
- `hf_model_preferences`

Minimum useful additions to the existing table:

- `resource_type`
- `task_family`
- `capabilities`
- `allowed_surfaces`
- `default_model`
- `artifact_kind`
- `active`
- `metadata`

## Claude-ready implementation direction

Highest-leverage implementation order:

1. Expand the saved HF resource model so models and Spaces are not treated as the same thing.
2. Add a shared HF capability registry in the frontend and edge layer.
3. Make Feed consume HF outputs as task/run artifacts instead of just `agent_activity`.
4. Add explicit HF commands to the new main chat shell.
5. Keep Office as the admin/explorer surface, but have it write into the shared registry.
6. Add storage-backed persistence for image/audio/doc outputs.
7. Add comparison mode for open-model chat and summaries.

## Bottom line

The app does not need a brand-new Hugging Face integration.

It already has one.

What it needs is consolidation.

Right now Hugging Face is:

- powerful in the backend
- semi-hidden in BlackSwan
- most usable in Office
- mostly passive in Feed

The right move is to turn Hugging Face into a shared capability layer across the app:

- Office discovers and configures it
- chats invoke lightweight versions of it
- Feed reviews and operationalizes its outputs
- tasks and Rooms consume its artifacts in a structured way

That is the path from “HF is in the app” to “HF materially improves how work gets done across the app.”
