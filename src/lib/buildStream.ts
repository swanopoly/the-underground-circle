/**
 * Chat Live Builder — streaming client
 *
 * Thin fetch wrapper around the `build-stream` edge function. Returns an
 * async iterator of events so the caller can yield tokens into the UI as
 * they arrive, rather than waiting for the full response.
 *
 * Events:
 *   { kind: 'delta', text }    — an append-only token chunk
 *   { kind: 'phase', name }    — best-effort stage label (planning / writing head / …)
 *   { kind: 'done',  text }    — full generated text; stream ends after this
 *   { kind: 'error', error }   — upstream error; stream ends after this
 */

import { supabase } from './supabase';

export type BuildStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'phase'; name: string }
  | { kind: 'done'; text: string; tokensOut?: number }
  | { kind: 'error'; error: string };

interface StreamOpts {
  brief: string;
  model?: string;
  systemExtra?: string;
  signal?: AbortSignal;
}

const FN_URL_SUFFIX = '/functions/v1/build-stream';

function resolveFnUrl(): string {
  const base = (supabase as any)?.supabaseUrl as string | undefined;
  if (!base) throw new Error('Supabase URL not configured');
  return `${base}${FN_URL_SUFFIX}`;
}

/**
 * Open a streaming build-page request. Returns a lazy async iterator —
 * caller drives iteration with `for await`.
 */
export async function* streamBuildPage(opts: StreamOpts): AsyncGenerator<BuildStreamEvent, void, void> {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session?.session?.access_token;

  const res = await fetch(resolveFnUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      brief: opts.brief,
      model: opts.model,
      system_extra: opts.systemExtra,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield { kind: 'error', error: `build-stream ${res.status}: ${text.slice(0, 400)}` };
    return;
  }

  // Parse SSE frames as they arrive. Each frame is separated by \n\n; each
  // line inside starts with `event:` or `data:`. We keep a buffer of the
  // partial frame across reads so multi-byte / multi-chunk frames are
  // reconstructed correctly.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      const parts = buffered.split('\n\n');
      buffered = parts.pop() || '';

      for (const frame of parts) {
        let event = 'message';
        let dataStr = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataStr += line.slice(6);
        }
        if (!dataStr) continue;
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (event === 'delta' && typeof data?.text === 'string') {
          yield { kind: 'delta', text: data.text };
        } else if (event === 'phase' && typeof data?.name === 'string') {
          yield { kind: 'phase', name: data.name };
        } else if (event === 'done') {
          yield { kind: 'done', text: String(data?.text || ''), tokensOut: data?.tokens_out };
          return;
        } else if (event === 'error') {
          yield { kind: 'error', error: String(data?.error || 'unknown') };
          return;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

/**
 * Convenience wrapper that runs the stream with two simple callbacks —
 * handy for `useEffect` consumers that don't want to manage an iterator.
 * Returns an unsubscribe function that aborts the underlying fetch.
 */
export function subscribeBuildStream(
  opts: Omit<StreamOpts, 'signal'>,
  handlers: {
    onDelta?: (text: string, aggregated: string) => void;
    onPhase?: (name: string) => void;
    onDone?: (fullText: string, tokensOut?: number) => void;
    onError?: (message: string) => void;
  },
): () => void {
  const controller = new AbortController();
  let aggregated = '';

  (async () => {
    try {
      for await (const ev of streamBuildPage({ ...opts, signal: controller.signal })) {
        if (controller.signal.aborted) return;
        switch (ev.kind) {
          case 'delta':
            aggregated += ev.text;
            handlers.onDelta?.(ev.text, aggregated);
            break;
          case 'phase':
            handlers.onPhase?.(ev.name);
            break;
          case 'done':
            handlers.onDone?.(ev.text || aggregated, ev.tokensOut);
            return;
          case 'error':
            handlers.onError?.(ev.error);
            return;
        }
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      handlers.onError?.(err?.message || 'stream aborted');
    }
  })();

  return () => controller.abort();
}

/**
 * Heuristic: pull the longest <html>…</html> block out of the streamed
 * text. Falls back to the whole text if no tag boundary is found.
 */
export function extractHtmlFromStream(text: string): string {
  const htmlStart = text.indexOf('<!DOCTYPE html');
  if (htmlStart >= 0) {
    const end = text.lastIndexOf('</html>');
    if (end > htmlStart) return text.slice(htmlStart, end + '</html>'.length);
  }
  const tagStart = text.indexOf('<html');
  if (tagStart >= 0) {
    const end = text.lastIndexOf('</html>');
    if (end > tagStart) return text.slice(tagStart, end + '</html>'.length);
  }
  return text.trim();
}
