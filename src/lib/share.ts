/**
 * Share sheet — Web Share API on capable browsers/native, clipboard fallback
 * everywhere else. Returns a `kind` so the caller can show the right toast
 * ("Shared" vs "Copied to clipboard").
 *
 * Works on:
 *   - iOS Safari, Android Chrome  → native share sheet
 *   - macOS Safari, recent Chrome → native share sheet
 *   - Firefox, older browsers     → clipboard fallback
 *   - React Native iOS/Android    → uses the React Native Share API
 *
 * Why not just always copy? Native share sheets are a step-change UX win on
 * mobile — one tap to send to Messages, WhatsApp, Slack, etc. instead of
 * "open clipboard, switch app, paste."
 */

import { Platform, Share as RNShare } from 'react-native';

export interface ShareInput {
  title: string;       // Used as the share sheet title / subject
  text: string;        // Body/description shown in the share sheet
  url: string;         // The link to share
}

export type ShareResult =
  | { kind: 'native'; shared: true }            // user completed native share
  | { kind: 'native'; shared: false }           // user opened sheet but cancelled
  | { kind: 'clipboard' }                       // copied URL to clipboard
  | { kind: 'unsupported'; reason: string };    // couldn't share or copy

export async function shareLink(input: ShareInput): Promise<ShareResult> {
  // Native (iOS/Android) — use React Native's built-in Share module.
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    try {
      const result = await RNShare.share({
        title: input.title,
        message: `${input.text}\n${input.url}`,
        url: input.url, // iOS-only field; Android uses message
      });
      return { kind: 'native', shared: result.action !== RNShare.dismissedAction };
    } catch (err) {
      console.warn('[share] native share failed, falling back to clipboard:', err);
      return await copyToClipboardFallback(input.url);
    }
  }

  // Web — prefer native share API (mobile browsers, recent desktop), fall
  // back to clipboard. We feature-detect at runtime instead of compile-time
  // because Safari and Chrome handle navigator.share differently per version.
  if (typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function') {
    try {
      await (navigator as any).share({
        title: input.title,
        text: input.text,
        url: input.url,
      });
      return { kind: 'native', shared: true };
    } catch (err: any) {
      // AbortError = user cancelled the sheet. Not actually a failure.
      if (err?.name === 'AbortError') {
        return { kind: 'native', shared: false };
      }
      console.warn('[share] navigator.share failed, falling back to clipboard:', err);
      return await copyToClipboardFallback(input.url);
    }
  }

  return await copyToClipboardFallback(input.url);
}

async function copyToClipboardFallback(url: string): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return { kind: 'clipboard' };
    } catch (err) {
      console.warn('[share] clipboard write failed:', err);
      return { kind: 'unsupported', reason: 'Clipboard write failed' };
    }
  }
  // Last resort — execCommand (deprecated but works in older browsers).
  if (typeof document !== 'undefined') {
    try {
      const el = document.createElement('textarea');
      el.value = url;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (ok) return { kind: 'clipboard' };
    } catch {}
  }
  return { kind: 'unsupported', reason: 'Neither share nor clipboard available' };
}

/**
 * User-facing label for the result of a share action. Use as toast/snackbar
 * text so the caller doesn't have to re-implement this everywhere.
 */
export function shareResultMessage(result: ShareResult): string {
  if (result.kind === 'native') {
    return result.shared ? 'Shared!' : '';
  }
  if (result.kind === 'clipboard') return 'Link copied to clipboard';
  return `Couldn't share: ${result.reason}`;
}
