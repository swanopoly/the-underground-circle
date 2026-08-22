/**
 * Durable Chat image generation client.
 *
 * The Edge function owns provider calls and private Storage. Chat messages keep
 * only an opaque image id plus bounded provenance; signed URLs are short-lived
 * render state and must never become the canonical persisted artifact.
 */

import type { SwanBotStructuredArtifact } from './swanbot';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStrictLocalAiModeMessage, isStrictLocalAiModeEnabled } from './privacyMode';
import {
  GENERATED_CHAT_IMAGE_SOURCE,
  asGeneratedChatImageRecord,
  boundedGeneratedChatImageString,
  isAllowedGeneratedChatImageMimeType,
  isGeneratedChatImageSha256,
  isOpaqueGeneratedChatImageId,
  isPersistedChatUuid,
  isTrustedGeneratedChatImageSignedUrl,
  type GeneratedChatImageMetadata,
} from './generatedChatImageArtifactCore';
export {
  isGeneratedChatImageArtifact,
  projectGeneratedChatImageArtifactForPersistence,
  readFreshGeneratedChatImageUrl,
  readGeneratedChatImageMetadata,
} from './generatedChatImageArtifactCore';
export type { GeneratedChatImageMetadata } from './generatedChatImageArtifactCore';

const FUNCTION_NAME = 'image-generate';
const MAX_PROMPT_CHARS = 8_000;
const MAX_LABEL_CHARS = 160;
const MAX_ERROR_CHARS = 320;
const GENERATE_DEADLINE_MS = 105_000;
const SIGN_DEADLINE_MS = 15_000;

export type GeneratedChatImageErrorCode =
  | 'validation'
  | 'privacy_blocked'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'key_missing'
  | 'unsupported_model'
  | 'rate_limited'
  | 'upstream_error'
  | 'network'
  | 'aborted'
  | 'outcome_unknown'
  | 'invalid_response'
  | 'internal'
  | (string & {});

export interface GenerateChatImageArgs {
  prompt: string;
  circleId: string;
  threadId: string;
  sourceMessageId: string;
  requestedModel?: string;
  provider?: string;
  model?: string;
  accessToken?: string;
  signal?: AbortSignal;
}

export interface GenerateChatImageSuccess {
  ok: true;
  artifact: SwanBotStructuredArtifact;
  provider: string;
  model: string;
  message: string;
}

export interface GeneratedChatImageFailure {
  ok: false;
  code: GeneratedChatImageErrorCode;
  message: string;
  retryable?: boolean;
}

export type GenerateChatImageResult = GenerateChatImageSuccess | GeneratedChatImageFailure;

export interface RefreshGeneratedChatImageUrlArgs {
  imageId: string;
  circleId: string;
  accessToken?: string;
  signal?: AbortSignal;
}

export interface RefreshGeneratedChatImageUrlSuccess {
  ok: true;
  imageId: string;
  url: string;
  expiresAt?: string;
}

export type RefreshGeneratedChatImageUrlResult =
  | RefreshGeneratedChatImageUrlSuccess
  | GeneratedChatImageFailure;

type UnknownRecord = Record<string, unknown>;
const asRecord = asGeneratedChatImageRecord;
const boundedString = boundedGeneratedChatImageString;

function boundedOptionalString(value: unknown, maxChars = MAX_LABEL_CHARS): string | undefined {
  return boundedString(value, maxChars) || undefined;
}

const isOpaqueImageId = isOpaqueGeneratedChatImageId;
const isSha256 = isGeneratedChatImageSha256;
const isAllowedMimeType = isAllowedGeneratedChatImageMimeType;
const isSafeTransientImageUrl = isTrustedGeneratedChatImageSignedUrl;

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message)));
}

function createBoundedSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const relayCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener('abort', relayCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', relayCallerAbort);
    },
  };
}

function sanitizeErrorMessage(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value.trim() : '';
  return (message || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_ERROR_CHARS);
}

function errorCodeFromStatus(status: number | null): GeneratedChatImageErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status != null && status >= 500) return 'upstream_error';
  return 'network';
}

function isRetryableFailure(code: string, status: number | null): boolean {
  return code === 'network'
    || code === 'rate_limited'
    || code === 'upstream_error'
    || status === 429
    || (status != null && status >= 500);
}

async function normalizeInvokeFailure(
  error: unknown,
  signal?: AbortSignal,
  didTimeout = false,
  operation: 'generate' | 'sign' = 'sign',
): Promise<GeneratedChatImageFailure> {
  if (didTimeout) {
    return operation === 'generate'
      ? {
          ok: false,
          code: 'outcome_unknown',
          message: 'Image generation did not return a final receipt in time. It may have reached the provider, so Chat will not retry it automatically.',
          retryable: false,
        }
      : {
          ok: false,
          code: 'network',
          message: 'Reloading the generated image timed out. Try again.',
          retryable: true,
        };
  }
  if (isAbortError(error, signal)) {
    return { ok: false, code: 'aborted', message: 'Image request was cancelled.', retryable: false };
  }

  const record = asRecord(error);
  const context = record?.context;
  let status: number | null = null;
  let responseBody: UnknownRecord | null = null;
  if (typeof Response !== 'undefined' && context instanceof Response) {
    status = context.status;
    try {
      responseBody = asRecord(await context.clone().json());
    } catch {
      responseBody = null;
    }
  }

  const structuredCode = boundedString(responseBody?.code, 80);
  if (operation === 'generate' && !structuredCode) {
    return {
      ok: false,
      code: 'outcome_unknown',
      message: 'The image service response was interrupted after dispatch may have started. The image may still have been generated, so Chat will not retry automatically.',
      retryable: false,
    };
  }
  const rawCode = structuredCode ?? errorCodeFromStatus(status);
  const code = rawCode.toLowerCase() as GeneratedChatImageErrorCode;
  const message = sanitizeErrorMessage(
    responseBody?.message ?? responseBody?.error ?? record?.message,
    'Image service is unavailable right now.',
  );
  const serverRetryable = typeof responseBody?.retryable === 'boolean'
    ? responseBody.retryable
    : undefined;
  return {
    ok: false,
    code,
    message,
    retryable: code === 'outcome_unknown'
      ? false
      : serverRetryable ?? isRetryableFailure(code, status),
  };
}

async function resolveExactClient(accessToken: string | undefined): Promise<SupabaseClient | null> {
  let token = accessToken?.trim() || null;
  if (!token) {
    const { getFreshAccessToken } = await import('./authSession');
    token = await getFreshAccessToken();
  }
  if (!token) return null;
  const { getSupabaseClientForAccessToken } = await import('./supabase');
  return getSupabaseClientForAccessToken(token);
}

function validateGenerateArgs(args: GenerateChatImageArgs): GeneratedChatImageFailure | null {
  const prompt = String(args.prompt || '').trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return {
      ok: false,
      code: 'validation',
      message: `Describe the image in 1-${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
      retryable: false,
    };
  }
  if (!isPersistedChatUuid(args.circleId) || !isPersistedChatUuid(args.threadId) || !isPersistedChatUuid(args.sourceMessageId)) {
    return {
      ok: false,
      code: 'validation',
      message: 'Image generation requires one persisted Chat message in the active circle and thread.',
      retryable: false,
    };
  }
  for (const value of [args.requestedModel, args.provider, args.model]) {
    if (value != null && !boundedString(value)) {
      return { ok: false, code: 'validation', message: 'Image model selection is invalid.', retryable: false };
    }
  }
  if (args.accessToken != null && (!args.accessToken.trim() || args.accessToken.trim().length > 16_384)) {
    return { ok: false, code: 'validation', message: 'Image generation requires a valid session.', retryable: false };
  }
  return null;
}

function normalizeGenerateResponse(
  raw: unknown,
  args: GenerateChatImageArgs,
): GenerateChatImageResult {
  const data = asRecord(raw);
  const image = asRecord(data?.image) || asRecord(data?.artifact);
  if (!data) {
    return {
      ok: false,
      code: 'outcome_unknown',
      message: 'Image generation returned no durable receipt. The image may still have been generated, so Chat will not retry automatically.',
      retryable: false,
    };
  }
  if (data.ok === false || data.error) {
    const code = boundedString(data.code, 80)?.toLowerCase();
    if (!code) {
      return {
        ok: false,
        code: 'outcome_unknown',
        message: 'Image generation returned an incomplete failure receipt. The image may still have been generated, so Chat will not retry automatically.',
        retryable: false,
      };
    }
    return {
      ok: false,
      code,
      message: sanitizeErrorMessage(data.message ?? data.error, 'Image generation failed.'),
      retryable: code === 'outcome_unknown'
        ? false
        : typeof data.retryable === 'boolean' ? data.retryable : isRetryableFailure(code, null),
    };
  }
  if (data.ok !== true) {
    return {
      ok: false,
      code: 'outcome_unknown',
      message: 'Image generation returned an incomplete durable receipt. The image may still have been generated, so Chat will not retry automatically.',
      retryable: false,
    };
  }

  const generatedImageId = data.imageId
    ?? data.generatedImageId
    ?? image?.imageId
    ?? image?.generatedImageId
    ?? image?.id;
  const url = data.signedUrl ?? data.url ?? image?.signedUrl ?? image?.url;
  const provider = boundedString(data.provider ?? image?.provider);
  const model = boundedString(data.model ?? image?.model);
  const requestedModel = boundedOptionalString(data.requestedModel ?? image?.requestedModel ?? args.requestedModel);
  const mimeTypeValue = data.mimeType ?? image?.mimeType;
  const mimeType = typeof mimeTypeValue === 'string' ? mimeTypeValue.toLowerCase() : null;
  const shaValue = data.sha256 ?? image?.sha256;
  const sha256 = typeof shaValue === 'string' ? shaValue.toLowerCase() : null;
  const expiresAt = boundedOptionalString(data.expiresAt ?? image?.expiresAt, 80);
  if (
    !isOpaqueImageId(generatedImageId)
    || !isSafeTransientImageUrl(url, undefined, args.circleId)
    || !provider
    || !model
    || !isAllowedMimeType(mimeType)
    || !isSha256(sha256)
  ) {
    return {
      ok: false,
      code: 'outcome_unknown',
      message: 'Image generation did not return a complete durable receipt. The image may still have been generated, so Chat will not retry automatically.',
      retryable: false,
    };
  }

  const metadata: GeneratedChatImageMetadata = {
    source: GENERATED_CHAT_IMAGE_SOURCE,
    generatedImageId,
    provider,
    model,
    ...(requestedModel ? { requestedModel } : {}),
    mimeType,
    sha256,
  };
  return {
    ok: true,
    artifact: {
      kind: 'image',
      title: boundedString(data.title ?? image?.title, MAX_LABEL_CHARS) || 'Generated image',
      content: null,
      url,
      metadata: {
        ...metadata,
        ...(expiresAt ? { expiresAt } : {}),
      },
    },
    provider,
    model,
    message: sanitizeErrorMessage(data.message, `Generated an image with ${provider} ${model}.`),
  };
}

export async function generateChatImage(args: GenerateChatImageArgs): Promise<GenerateChatImageResult> {
  if (isStrictLocalAiModeEnabled()) {
    return {
      ok: false,
      code: 'privacy_blocked',
      message: getStrictLocalAiModeMessage(),
      retryable: false,
    };
  }
  const invalid = validateGenerateArgs(args);
  if (invalid) return invalid;
  if (args.signal?.aborted) {
    return { ok: false, code: 'aborted', message: 'Image request was cancelled.', retryable: false };
  }

  const request = createBoundedSignal(args.signal, GENERATE_DEADLINE_MS);
  let dispatchStarted = false;
  try {
    const client = await resolveExactClient(args.accessToken);
    if (!client) {
      return { ok: false, code: 'unauthenticated', message: 'Sign in again before generating an image.', retryable: false };
    }
    if (request.signal.aborted) {
      return request.didTimeout()
        ? { ok: false, code: 'network', message: 'Preparing the image request timed out. Try again.', retryable: true }
        : { ok: false, code: 'aborted', message: 'Image request was cancelled.', retryable: false };
    }
    dispatchStarted = true;
    const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
      body: {
        action: 'generate',
        prompt: args.prompt.trim(),
        circleId: args.circleId,
        threadId: args.threadId,
        sourceMessageId: args.sourceMessageId,
        ...(args.requestedModel ? { requestedModel: args.requestedModel.trim() } : {}),
        ...(args.provider ? { provider: args.provider.trim() } : {}),
        ...(args.model ? { model: args.model.trim() } : {}),
      },
      signal: request.signal,
    });
    if (error) return normalizeInvokeFailure(error, args.signal, request.didTimeout(), 'generate');
    return normalizeGenerateResponse(data, args);
  } catch (error) {
    if (!dispatchStarted) {
      if (isAbortError(error, args.signal)) {
        return { ok: false, code: 'aborted', message: 'Image request was cancelled.', retryable: false };
      }
      return {
        ok: false,
        code: 'network',
        message: request.didTimeout()
          ? 'Preparing the image request timed out. Try again.'
          : 'Could not prepare an authenticated image request. Try again.',
        retryable: true,
      };
    }
    return normalizeInvokeFailure(error, args.signal, request.didTimeout(), 'generate');
  } finally {
    request.cleanup();
  }
}

export async function refreshGeneratedChatImageUrl(
  args: RefreshGeneratedChatImageUrlArgs,
): Promise<RefreshGeneratedChatImageUrlResult> {
  if (!isOpaqueImageId(args.imageId) || !isPersistedChatUuid(args.circleId)) {
    return {
      ok: false,
      code: 'validation',
      message: 'This generated image does not have a valid circle-scoped reference.',
      retryable: false,
    };
  }
  if (args.accessToken != null && (!args.accessToken.trim() || args.accessToken.trim().length > 16_384)) {
    return { ok: false, code: 'validation', message: 'Reloading this image requires a valid session.', retryable: false };
  }
  if (args.signal?.aborted) {
    return { ok: false, code: 'aborted', message: 'Image request was cancelled.', retryable: false };
  }

  const request = createBoundedSignal(args.signal, SIGN_DEADLINE_MS);
  try {
    const client = await resolveExactClient(args.accessToken);
    if (!client) {
      return { ok: false, code: 'unauthenticated', message: 'Sign in again to reload this image.', retryable: false };
    }
    if (request.signal.aborted) {
      return normalizeInvokeFailure(new Error('aborted'), args.signal, request.didTimeout(), 'sign');
    }
    const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
      body: {
        action: 'sign',
        imageId: args.imageId,
        circleId: args.circleId,
      },
      signal: request.signal,
    });
    if (error) return normalizeInvokeFailure(error, args.signal, request.didTimeout(), 'sign');

    const record = asRecord(data);
    if (record?.ok === false || record?.error) {
      const code = boundedString(record.code, 80)?.toLowerCase() || 'internal';
      return {
        ok: false,
        code,
        message: sanitizeErrorMessage(record.message ?? record.error, 'Could not reload this image.'),
        retryable: typeof record.retryable === 'boolean' ? record.retryable : isRetryableFailure(code, null),
      };
    }
    if (record?.ok !== true) {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'Image service returned an invalid secure-link receipt.',
        retryable: true,
      };
    }
    const image = asRecord(record?.image);
    const returnedImageId = record?.imageId ?? record?.generatedImageId ?? image?.imageId ?? image?.id;
    const url = record?.signedUrl ?? record?.url ?? image?.signedUrl ?? image?.url;
    const expiresAt = boundedOptionalString(record?.expiresAt ?? image?.expiresAt, 80);
    if (returnedImageId !== args.imageId || !isSafeTransientImageUrl(url, undefined, args.circleId)) {
      return {
        ok: false,
        code: 'invalid_response',
        message: 'Image service returned an invalid circle-scoped URL receipt.',
        retryable: true,
      };
    }
    return {
      ok: true,
      imageId: args.imageId,
      url,
      ...(expiresAt ? { expiresAt } : {}),
    };
  } catch (error) {
    return normalizeInvokeFailure(error, args.signal, request.didTimeout(), 'sign');
  } finally {
    request.cleanup();
  }
}
