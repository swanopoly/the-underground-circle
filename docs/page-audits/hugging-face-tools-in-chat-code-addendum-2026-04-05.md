# Hugging Face Tools In Chat Code Addendum

Date: 2026-04-05
Repo: `the-underground-circle`
Audience: Claude or another implementation agent
Purpose: provide copy-ready code shapes, enum additions, command entries, and artifact mappings for the HF-in-chat PR1

## Why this file exists

The prior docs define the product and PR scope.

This addendum exists to reduce ambiguity in implementation by giving:

- exact enum additions
- exact type shapes
- exact command entries
- exact artifact mapping rules
- exact structured response examples

Use this as the most tactical reference in the set.

## Files this addendum targets

- [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)
- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)
- [chatTypes.ts](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/chatTypes.ts)
- [chatSessions.ts](/Users/cswanson/the-underground-circle/src/lib/chatSessions.ts)
- [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [ChatComposer.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx)

## Exact enum additions

### `chatTypes.ts`

Current:

```ts
export type ChatStepKind = 'thought' | 'tool' | 'output' | 'status' | 'approval' | 'error';
export type ChatArtifactKind = 'text' | 'link' | 'file' | 'diff' | 'summary';
```

Recommended PR1 update:

```ts
export type ChatStepKind =
  | 'thought'
  | 'tool'
  | 'hf_tool'
  | 'output'
  | 'status'
  | 'approval'
  | 'error';

export type ChatArtifactKind =
  | 'text'
  | 'link'
  | 'file'
  | 'diff'
  | 'summary'
  | 'image'
  | 'translation'
  | 'classification'
  | 'vision';
```

PR1 does not need to add `audio`, `transcript`, or `comparison` unless Claude decides to pull those in early.

## Exact type additions

### Add these interfaces in `chatTypes.ts`

```ts
export interface ChatToolAction {
  kind: 'hf_tool';
  toolName: string;
  title: string;
  status: 'completed' | 'failed';
  model?: string | null;
  inputPreview?: string | null;
  outputPreview?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChatHfArtifactMetadata {
  toolName: string;
  model?: string | null;
  command?: string | null;
  source?: 'chat_command' | 'assistant_choice';
  [key: string]: unknown;
}
```

## Exact command registry additions

### Extend `CHAT_COMMANDS`

Recommended PR1 entries:

```ts
  { name: '/openmodel', description: 'Ask an open model for a second opinion', usage: '/openmodel [prompt]', enabled: true },
  { name: '/summarize', description: 'Summarize pasted text or recent context', usage: '/summarize [text]', enabled: true },
  { name: '/translate', description: 'Translate text to another language', usage: '/translate to:fr [text]', enabled: true },
  { name: '/vision', description: 'Ask a question about an image or screenshot', usage: '/vision [url] [question]', enabled: true },
  { name: '/qa', description: 'Answer a question from provided context', usage: '/qa q:[question] context:[text]', enabled: true },
  { name: '/classify', description: 'Classify or analyze sentiment', usage: '/classify [text]', enabled: true },
  { name: '/zero-shot', description: 'Classify text into custom labels', usage: '/zero-shot labels:a,b,c text:[text]', enabled: true },
  { name: '/imagine', description: 'Generate an image from a prompt', usage: '/imagine [prompt]', enabled: true },
```

Do not add backend names like `hf_generate_image` into the product command registry.

## Exact structured response types

### Add to `swanbot.ts`

```ts
export interface SwanBotStructuredToolAction {
  kind: 'hf_tool';
  tool_name: string;
  title: string;
  status: 'completed' | 'failed';
  model?: string | null;
  input_preview?: string | null;
  output_preview?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SwanBotStructuredArtifact {
  kind: 'summary' | 'image' | 'translation' | 'classification' | 'vision';
  title: string;
  content?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SwanBotStructuredResponse {
  response: string;
  usage?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  tool_actions?: SwanBotStructuredToolAction[];
  artifacts?: SwanBotStructuredArtifact[];
}
```

## Exact client wrapper shape

### `swanbot.ts`

Suggested wrapper:

```ts
async function callSwanBotAIStructured(
  message: string,
  circleId: string,
  userId: string,
  discordContext?: string,
  model?: string | null,
): Promise<SwanBotStructuredResponse | null> {
  try {
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      body: { message, circleId, userId, discordContext, model: model || 'claude-haiku', maxTokens: 2048 },
    });
    if (error || data?.error) return null;
    return {
      response: data?.response || '',
      usage: data?.usage,
      tool_actions: data?.tool_actions || [],
      artifacts: data?.artifacts || [],
    };
  } catch {
    return null;
  }
}
```

Then:

```ts
export async function getSwanBotStructuredResponse(
  message: string,
  context: SwanBotContext
): Promise<SwanBotStructuredResponse> {
  // Keep the existing local-command and fallback flow, but return a structured shape.
}
```

And preserve compatibility:

```ts
export async function getSwanBotResponse(
  message: string,
  context: SwanBotContext
): Promise<string> {
  const result = await getSwanBotStructuredResponse(message, context);
  return result.response;
}
```

## Exact `swanbot-ai` payload shape

### Final return object

Recommended minimal return:

```ts
return {
  response: finalText || "Done.",
  usage: {
    model: modelId,
    input_tokens: totalInput,
    output_tokens: totalOutput,
    total_tokens: totalInput + totalOutput,
    cache_creation_tokens: totalCacheCreation,
    cache_read_tokens: totalCacheRead,
  },
  tool_actions,
  artifacts,
};
```

## Exact tool-action push shape

### Use this normalized shape in `swanbot-ai/index.ts`

```ts
toolActions.push({
  kind: "hf_tool",
  tool_name: "hf_translate",
  title: "Translated text",
  status: "completed",
  model: result.model || null,
  input_preview: toolInput.text?.slice(0, 120) || null,
  output_preview: translated?.slice(0, 160) || null,
  metadata: {
    target_language: toolInput.tgt_lang,
  },
});
```

For a failure:

```ts
toolActions.push({
  kind: "hf_tool",
  tool_name: "hf_translate",
  title: "Translated text",
  status: "failed",
  model: result.model || null,
  input_preview: toolInput.text?.slice(0, 120) || null,
  output_preview: result.error || null,
  metadata: {
    target_language: toolInput.tgt_lang,
    error: result.error,
  },
});
```

## Exact artifact mapping table

Use this mapping in PR1.

| Backend tool | Artifact kind | `content` | `url` | Required metadata |
|---|---|---|---|---|
| `hf_summarize` | `summary` | summary text | `null` | `tool_name`, `model` |
| `hf_translate` | `translation` | translated text | `null` | `tool_name`, `model`, `target_language` |
| `hf_classify` | `classification` | `null` | `null` | `tool_name`, `model`, `labels`, `scores` |
| `hf_zero_shot` | `classification` | `null` | `null` | `tool_name`, `model`, `labels`, `scores` |
| `hf_vision` | `vision` | answer text | `null` | `tool_name`, `model`, `question`, `image_url` |
| `hf_qa` | `summary` | answer text | `null` | `tool_name`, `model`, `confidence` |
| `hf_generate_image` | `image` | `null` | image data URL or storage URL | `tool_name`, `model`, `prompt` |
| `hf_chat` | none in PR1 | n/a | n/a | provenance only |

## Exact artifact push examples

### Translation

```ts
artifacts.push({
  kind: "translation",
  title: "Translated text",
  content: translated,
  url: null,
  metadata: {
    tool_name: "hf_translate",
    model: result.model || null,
    target_language: toolInput.tgt_lang,
  },
});
```

### Classification

```ts
artifacts.push({
  kind: "classification",
  title: "Classification result",
  content: null,
  url: null,
  metadata: {
    tool_name: "hf_classify",
    model: result.model || null,
    classification: result.result,
  },
});
```

### Image

```ts
artifacts.push({
  kind: "image",
  title: "Generated image",
  content: null,
  url: result.result?.image || null,
  metadata: {
    tool_name: "hf_generate_image",
    model: result.model || null,
    prompt: toolInput.prompt,
  },
});
```

## Exact `ChatTabShell` mapping

### Replace this pattern

Current behavior:

- call `getSwanBotResponse(...)`
- append one output step

Recommended PR1 behavior:

```ts
const structured = await getSwanBotStructuredResponse(trimmed, {
  userId,
  circleId,
  userName,
  model: modelForRun ?? null,
});

for (const [index, action] of (structured.tool_actions || []).entries()) {
  await chatDB.appendRunStep(
    workingRun.id,
    sessionId,
    circleId,
    'hf_tool',
    action.title,
    action.output_preview || action.input_preview || null,
    index + 1,
    {
      toolName: action.tool_name,
      model: action.model || null,
      status: action.status,
      ...(action.metadata || {}),
    },
  );
}

for (const artifact of structured.artifacts || []) {
  await chatDB.appendArtifact(
    workingRun.id,
    sessionId,
    circleId,
    artifact.kind as ChatArtifactKind,
    artifact.title,
    artifact.content || null,
    artifact.url || null,
    artifact.metadata || {},
  );
}
```

Then append the assistant entry from:

```ts
structured.response
```

## Exact `chatSessions.ts` helper shape

If `appendArtifact(...)` needs confirmation, the intended call shape is:

```ts
appendArtifact(
  runId: string,
  sessionId: string,
  circleId: string,
  artifactKind: ChatArtifactKind,
  title: string,
  content?: string | null,
  url?: string | null,
  metadata?: Record<string, unknown>,
)
```

The repo already has:

- `appendArtifact(...)`
- `loadArtifacts(...)`

So Claude should reuse them rather than invent a parallel helper.

## Exact quick-action set for `ChatComposer.tsx`

Recommended quick-action buttons:

```ts
const HF_QUICK_ACTIONS = [
  { label: 'Open model', command: '/openmodel ' },
  { label: 'Summarize', command: '/summarize ' },
  { label: 'Translate', command: '/translate to:fr ' },
  { label: 'Vision', command: '/vision ' },
  { label: 'Imagine', command: '/imagine ' },
];
```

Behavior:

- insert text into composer
- do not auto-send

## Exact classification rendering shape

For `classification` artifacts, metadata should look like:

```ts
{
  tool_name: 'hf_classify',
  model: 'facebook/bart-large-mnli',
  classification: [
    { label: 'bug', score: 0.84 },
    { label: 'feature', score: 0.12 },
    { label: 'question', score: 0.04 }
  ]
}
```

`HfArtifactCard.tsx` should:

- read `metadata.classification`
- normalize nested arrays
- render the top 3 labels as chips with percentages

## Exact PR1-safe command parsing guidance

Do not build a heavy parser in the frontend.

Frontend responsibility:

- detect commands for suggestion and prefill only

Backend responsibility:

- interpret the command text
- choose the mapped HF tool

This keeps PR1 small.

## Exact acceptance targets

Claude should verify these concrete examples:

### `/summarize`

Input:

```text
/summarize Here is a long sprint recap...
```

Expected:

- assistant text reply
- one `hf_tool` step
- one `summary` artifact

### `/translate`

Input:

```text
/translate to:fr We shipped the dashboard redesign today.
```

Expected:

- assistant text reply
- one `hf_tool` step
- one `translation` artifact

### `/classify`

Input:

```text
/classify This bug is blocking checkout and users are angry.
```

Expected:

- assistant text reply
- one `hf_tool` step
- one `classification` artifact with labels/scores

### `/imagine`

Input:

```text
/imagine neon green bubbly productivity dashboard
```

Expected:

- assistant text reply
- one `hf_tool` step
- one `image` artifact with previewable `url`

## Bottom line

Claude does not need to guess much for PR1.

The clean implementation path is:

- add the enum and command expansions above
- return the structured envelope above
- map tool actions and artifacts exactly as described above
- keep chat text output working exactly as it does today

That is enough to ship useful Hugging Face chat support without overbuilding the first pass.
