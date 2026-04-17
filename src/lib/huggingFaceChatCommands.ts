/**
 * Hugging Face AI Tool Commands
 *
 * Provides HF-style AI tool commands triggered via slash commands in chat.
 * Routes through the existing SwanBot AI path (Gemini/Edge Function) with
 * tool-specific prompts, then structures the response as if it came from
 * an HF tool.
 */

import { getSwanBotResponse, getSwanBotStructuredResponse, SwanBotContext } from './swanbot';
import { callHfProxy, hfErrorGuidance } from './hfProxy';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HfCommandResult {
  success: boolean;
  message: string;
  artifacts?: {
    kind: string;
    title: string;
    content?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }[];
  toolActions?: {
    kind: string;
    toolName: string;
    title: string;
    status: string;
    model?: string;
    inputPreview?: string;
    outputPreview?: string;
  }[];
}

// ─── Main Dispatcher ────────────────────────────────────────────────────────

export async function executeHfCommand(
  input: string,
  context: { circleId: string; userId: string; userName?: string; model?: string },
): Promise<HfCommandResult> {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // Parse command
  if (lower.startsWith('/summarize ')) return handleSummarize(trimmed.slice(11).trim(), context);
  if (lower.startsWith('/translate ')) return handleTranslate(trimmed.slice(11).trim(), context);
  if (lower.startsWith('/classify ')) return handleClassify(trimmed.slice(10).trim(), context);
  if (lower.startsWith('/zero-shot ')) return handleZeroShot(trimmed.slice(11).trim(), context);
  if (lower.startsWith('/qa ')) return handleQA(trimmed.slice(4).trim(), context);
  if (lower.startsWith('/imagine ')) return handleImagine(trimmed.slice(9).trim(), context);
  if (lower.startsWith('/vision ')) return handleVision(trimmed.slice(8).trim(), context);
  if (lower.startsWith('/openmodel ')) return handleOpenModel(trimmed.slice(11).trim(), context);
  if (lower.startsWith('/build-page ')) return handleBuildPage(trimmed.slice(12).trim(), context);
  if (lower.startsWith('/code ')) return handleCode(trimmed.slice(6).trim(), context);
  if (lower.startsWith('/speak ')) return handleSpeak(trimmed.slice(7).trim(), context);
  if (lower === '/hf' || lower === '/hf help') return handleHelp();

  return { success: false, message: '' };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildSwanBotContext(ctx: { circleId: string; userId: string; userName?: string; model?: string }): SwanBotContext {
  return {
    userId: ctx.userId,
    circleId: ctx.circleId,
    userName: ctx.userName,
    model: ctx.model,
  };
}

function buildToolAction(
  toolName: string,
  title: string,
  inputText: string,
  outputText: string,
  status: string = 'completed',
): HfCommandResult['toolActions'] {
  return [
    {
      kind: 'hf_tool',
      toolName,
      title,
      status,
      model: 'swanbot-ai-proxy',
      inputPreview: inputText.slice(0, 100),
      outputPreview: outputText.slice(0, 100),
    },
  ];
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleSummarize(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/summarize <text>`' };
  }
  try {
    const prompt = `Summarize the following text concisely:\n\n${text}`;
    const response = await getSwanBotResponse(prompt, buildSwanBotContext(ctx));
    return {
      success: true,
      message: `**Summary:**\n${response}`,
      artifacts: [{ kind: 'summary', title: 'Text Summary', content: response }],
      toolActions: buildToolAction('hf_summarize', 'Summarize', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `Summarize failed: ${e.message}` };
  }
}

async function handleTranslate(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/translate to LANG: text` or `/translate LANG text`' };
  }
  try {
    // Parse "to LANG: text" or "LANG text"
    let lang: string;
    let body: string;
    const toMatch = text.match(/^to\s+(\w+)\s*:\s*(.+)$/is);
    if (toMatch) {
      lang = toMatch[1];
      body = toMatch[2].trim();
    } else {
      const parts = text.split(/\s+/);
      lang = parts[0];
      body = parts.slice(1).join(' ');
    }
    if (!body) {
      return { success: false, message: 'Usage: `/translate to LANG: text` or `/translate LANG text`' };
    }
    const prompt = `Translate the following to ${lang}:\n\n${body}`;
    const response = await getSwanBotResponse(prompt, buildSwanBotContext(ctx));
    return {
      success: true,
      message: `**Translation (${lang}):**\n${response}`,
      artifacts: [{ kind: 'translation', title: `Translation to ${lang}`, content: response }],
      toolActions: buildToolAction('hf_translate', 'Translate', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `Translate failed: ${e.message}` };
  }
}

async function handleClassify(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/classify <text>`' };
  }
  try {
    const prompt = `Classify the following text into categories. Return the top 3 categories with confidence scores as JSON:\n\n${text}`;
    const response = await getSwanBotResponse(prompt, buildSwanBotContext(ctx));

    // Attempt to extract JSON from the response
    let parsedContent = response;
    try {
      const jsonMatch = response.match(/\[[\s\S]*?\]|\{[\s\S]*?\}/);
      if (jsonMatch) {
        JSON.parse(jsonMatch[0]);
        parsedContent = jsonMatch[0];
      }
    } catch {
      // If JSON parsing fails, keep the raw response
    }

    return {
      success: true,
      message: `**Classification:**\n${response}`,
      artifacts: [{ kind: 'classification', title: 'Text Classification', content: parsedContent }],
      toolActions: buildToolAction('hf_classify', 'Classify', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `Classify failed: ${e.message}` };
  }
}

async function handleZeroShot(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/zero-shot LABEL1, LABEL2, ...: text`' };
  }
  try {
    // Parse "LABELS: text"
    const colonIdx = text.indexOf(':');
    if (colonIdx === -1) {
      return { success: false, message: 'Usage: `/zero-shot LABEL1, LABEL2, ...: text`' };
    }
    const labels = text.slice(0, colonIdx).trim();
    const body = text.slice(colonIdx + 1).trim();
    if (!labels || !body) {
      return { success: false, message: 'Usage: `/zero-shot LABEL1, LABEL2, ...: text`' };
    }

    const prompt = `Classify this text into one of these labels: ${labels}. Text: ${body}. Return JSON with label and score.`;
    const response = await getSwanBotResponse(prompt, buildSwanBotContext(ctx));

    let parsedContent = response;
    try {
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        JSON.parse(jsonMatch[0]);
        parsedContent = jsonMatch[0];
      }
    } catch {
      // Keep raw response
    }

    return {
      success: true,
      message: `**Zero-Shot Classification:**\n${response}`,
      artifacts: [{ kind: 'classification', title: 'Zero-Shot Classification', content: parsedContent }],
      toolActions: buildToolAction('hf_zero_shot', 'Zero-Shot Classify', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `Zero-shot classify failed: ${e.message}` };
  }
}

async function handleQA(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/qa CONTEXT: question` or `/qa question`' };
  }
  try {
    let question: string;
    let qaContext: string | null = null;

    // Parse "CONTEXT: question"
    const colonIdx = text.indexOf(':');
    if (colonIdx > 0 && colonIdx < text.length - 1) {
      const beforeColon = text.slice(0, colonIdx).trim();
      const afterColon = text.slice(colonIdx + 1).trim();
      // Only treat as context:question if the before part looks like context (more than one word)
      if (beforeColon.includes(' ')) {
        qaContext = beforeColon;
        question = afterColon;
      } else {
        question = text;
      }
    } else {
      question = text;
    }

    const prompt = qaContext
      ? `Given the following context: "${qaContext}"\n\nAnswer this question: ${question}`
      : `Answer this question: ${question}`;
    const response = await getSwanBotResponse(prompt, buildSwanBotContext(ctx));
    return {
      success: true,
      message: `**Answer:**\n${response}`,
      artifacts: [{ kind: 'summary', title: 'QA Answer', content: response }],
      toolActions: buildToolAction('hf_qa', 'Question Answering', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `QA failed: ${e.message}` };
  }
}

async function handleImagine(
  prompt: string,
  ctx: { circleId: string; userId: string; userName?: string; model?: string },
): Promise<HfCommandResult> {
  if (!prompt) {
    return { success: false, message: 'Usage: `/imagine <prompt>`' };
  }

  // Real image generation — call hf-proxy. Claude (SwanBot) cannot generate
  // images, so the previous SwanBot path returned text descriptions only.
  // Default model: black-forest-labs/FLUX.1-schnell (set in hf-proxy).
  // Note: text-to-image returns { image: dataUrl, ... }, while other binary
  // tasks return { data: dataUrl, ... }. Tolerate both.
  const result = await callHfProxy<{ image?: string; data?: string }>({
    task: 'text-to-image',
    inputs: prompt,
    circleId: ctx.circleId,
  });

  if (!result.ok) {
    return {
      success: false,
      message: `**Image generation failed**\n\n${result.error}\n\n_${hfErrorGuidance(result.code)}_`,
    };
  }

  const imageDataUrl = result.result?.image || result.result?.data;
  if (!imageDataUrl) {
    return { success: false, message: 'Image generation returned no data.' };
  }

  return {
    success: true,
    message: `**Generated image:** _${prompt}_`,
    artifacts: [{
      kind: 'image',
      title: prompt.slice(0, 80),
      url: imageDataUrl,
      content: prompt,
      metadata: { model: result.model, source: 'huggingface' },
    }],
    toolActions: buildToolAction('hf_imagine', 'Generate Image', prompt, `Image (${result.model})`),
  };
}

async function handleVision(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/vision <image description or URL>`' };
  }
  try {
    const prompt = `Describe what you would see in an image described as: ${text}`;
    const response = await getSwanBotResponse(prompt, buildSwanBotContext(ctx));
    return {
      success: true,
      message: `**Vision Analysis:**\n${response}`,
      artifacts: [{ kind: 'vision', title: 'Vision Description', content: response }],
      toolActions: buildToolAction('hf_vision', 'Vision', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `Vision failed: ${e.message}` };
  }
}

async function handleOpenModel(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string; model?: string },
): Promise<HfCommandResult> {
  if (!text) {
    return { success: false, message: 'Usage: `/openmodel <prompt>`' };
  }
  try {
    const response = await getSwanBotResponse(text, buildSwanBotContext(ctx));
    return {
      success: true,
      message: response,
      toolActions: buildToolAction('hf_openmodel', 'Open Model', text, response),
    };
  } catch (e: any) {
    return { success: false, message: `Open model failed: ${e.message}` };
  }
}

async function handleBuildPage(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string; model?: string },
): Promise<HfCommandResult> {
  if (!text) return { success: false, message: 'Usage: `/build-page <brief>`' };
  try {
    const structured = await getSwanBotStructuredResponse(`/build-page ${text}`, buildSwanBotContext(ctx));
    return {
      success: true,
      message: structured.response,
      artifacts: structured.artifacts as HfCommandResult['artifacts'],
      toolActions: structured.tool_actions?.map(action => ({
        kind: action.kind,
        toolName: action.tool_name,
        title: action.title,
        status: action.status,
        model: action.model || undefined,
        inputPreview: action.input_preview || undefined,
        outputPreview: action.output_preview || undefined,
      })),
    };
  } catch (e: any) {
    return { success: false, message: `Build page failed: ${e.message}` };
  }
}

async function handleCode(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string; model?: string },
): Promise<HfCommandResult> {
  if (!text) return { success: false, message: 'Usage: `/code <task>`' };

  // Primary: Qwen3-Coder via hf-proxy. It's a code-specialist model, so it
  // typically beats general-purpose Claude for code-gen latency + quality.
  // Pass task='chat' explicitly with the Qwen model — hf-proxy's OpenAI-
  // compatible endpoint accepts any model id via the router.
  const QWEN_CODER = 'Qwen/Qwen3-Coder-Next';
  const codePrompt = `You are a precise code assistant. Return only the code (with brief comments explaining tricky parts). Do not wrap in markdown unless multiple files. Task:\n\n${text}`;

  const hf = await callHfProxy<{ choices?: Array<{ message?: { content?: string } }> }>({
    task: 'chat',
    model: QWEN_CODER,
    inputs: { messages: [{ role: 'user', content: codePrompt }] },
    circleId: ctx.circleId,
    options: { max_tokens: 2048, temperature: 0.2 },
  });

  if (hf.ok) {
    const code = hf.result?.choices?.[0]?.message?.content?.trim();
    if (code) {
      return {
        success: true,
        message: `**Code (${hf.model.split('/').pop()})**\n\n${code}`,
        artifacts: [{
          kind: 'code',
          title: text.slice(0, 80),
          content: code,
          metadata: { model: hf.model, source: 'huggingface', backend: 'qwen3-coder' },
        }],
        toolActions: buildToolAction('hf_code', 'Code Generation', text, code),
      };
    }
  }

  // Graceful fallback: HF unavailable (token missing, rate-limited, network).
  // Code-gen is high-stakes — users want SOMETHING, not just an error. Fall
  // back to SwanBot/Claude with a note about the degraded path.
  try {
    const structured = await getSwanBotStructuredResponse(`/code ${text}`, buildSwanBotContext(ctx));
    const fallbackNotice = hf.ok ? '' : `\n\n_Note: generated via Claude (HuggingFace fallback: ${hf.code})_`;
    return {
      success: true,
      message: structured.response + fallbackNotice,
      artifacts: structured.artifacts as HfCommandResult['artifacts'],
      toolActions: structured.tool_actions?.map(action => ({
        kind: action.kind,
        toolName: action.tool_name,
        title: action.title,
        status: action.status,
        model: action.model || undefined,
        inputPreview: action.input_preview || undefined,
        outputPreview: action.output_preview || undefined,
      })),
    };
  } catch (e: any) {
    // Both paths failed — surface the original HF error since it's likely
    // the more actionable one (e.g. "set HF_TOKEN"), with the Claude error
    // appended as context.
    return {
      success: false,
      message: hf.ok
        ? `**Code generation failed**\n\n${e.message}`
        : `**Code generation failed**\n\nHuggingFace: ${hf.error}\nClaude fallback: ${e.message}\n\n_${hfErrorGuidance(hf.code)}_`,
    };
  }
}

async function handleSpeak(
  text: string,
  ctx: { circleId: string; userId: string; userName?: string; model?: string },
): Promise<HfCommandResult> {
  if (!text) return { success: false, message: 'Usage: `/speak <text>`' };

  // Real text-to-speech — call hf-proxy. SwanBot/Claude can't synthesize
  // audio, so the previous path returned only text descriptions.
  // Default model: espnet/kan-bayashi_ljspeech_vits (set in hf-proxy).
  // Tolerates both `{ data }` (TTS) and `{ image }` (some HF endpoints
  // mislabel content type) shapes for forward-compat.
  const result = await callHfProxy<{ data?: string; image?: string }>({
    task: 'text-to-speech',
    inputs: text,
    circleId: ctx.circleId,
  });

  if (!result.ok) {
    return {
      success: false,
      message: `**Speech generation failed**\n\n${result.error}\n\n_${hfErrorGuidance(result.code)}_`,
    };
  }

  const audioDataUrl = result.result?.data || result.result?.image;
  if (!audioDataUrl) {
    return { success: false, message: 'Speech generation returned no audio.' };
  }

  return {
    success: true,
    message: `**Generated audio:** _"${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"_`,
    artifacts: [{
      kind: 'audio',
      title: text.slice(0, 80),
      url: audioDataUrl,
      content: text,
      metadata: { model: result.model, source: 'huggingface' },
    }],
    toolActions: buildToolAction('hf_speak', 'Text to Speech', text, `Audio (${result.model})`),
  };
}

function handleHelp(): HfCommandResult {
  const helpText = `**HuggingSwan AI Tools**

| Command | Description |
|---------|-------------|
| \`/summarize <text>\` | Summarize text concisely |
| \`/translate to LANG: text\` | Translate text to a language |
| \`/classify <text>\` | Classify text into categories |
| \`/zero-shot LABELS: text\` | Zero-shot classification with custom labels |
| \`/qa CONTEXT: question\` | Question answering (context optional) |
| \`/imagine <prompt>\` | Generate an image |
| \`/vision <description>\` | Describe an image |
| \`/openmodel <prompt>\` | Open-ended AI response |
| \`/build-page <brief>\` | Generate a web page draft |
| \`/code <task>\` | Generate or refactor code |
| \`/speak <text>\` | Generate spoken audio |

_Powered by SwanBot AI. Use \`/hf\` to see this help._`;

  return {
    success: true,
    message: helpText,
  };
}
