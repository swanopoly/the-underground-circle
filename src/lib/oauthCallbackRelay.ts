const OAUTH_CALLBACK_PATH = '/oauth/email-calendar/callback';
const OAUTH_NONCE_PATTERN = /^[a-f0-9]{48}$/;
const OAUTH_PROVIDERS = new Set(['google', 'microsoft', 'yahoo']);

/**
 * Relay a provider callback from the trusted app origin to the exact opener.
 * Returns true when this window is the dedicated callback popup, so the full
 * app is not mounted behind the short-lived completion message.
 */
export function relayOAuthCallbackFromAppOrigin(): boolean {
  if (typeof window === 'undefined' || window.location.pathname !== OAUTH_CALLBACK_PATH) {
    return false;
  }

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const provider = params.get('provider') || '';
  const nonce = params.get('nonce') || '';
  const email = (params.get('email') || '').slice(0, 320);
  const error = (params.get('error') || '').slice(0, 500);
  const success = params.get('success') === '1';
  const validEnvelope = OAUTH_PROVIDERS.has(provider)
    && OAUTH_NONCE_PATTERN.test(nonce)
    && (!success || !error);

  // Clear callback details from the address bar before communicating. The
  // values contain no tokens, but this also keeps screenshots/history clean.
  try {
    window.history.replaceState(null, '', OAUTH_CALLBACK_PATH);
  } catch {}

  try {
    document.title = validEnvelope ? 'Connection complete' : 'Connection failed';
    document.body.textContent = validEnvelope
      ? 'Connection complete. This window will close automatically.'
      : 'The connection could not be verified. Close this window and try again.';
    document.body.style.cssText = [
      'margin:0',
      'min-height:100vh',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'box-sizing:border-box',
      'background:#0a0a0a',
      'color:#f5f7f2',
      'font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace',
      'text-align:center',
    ].join(';');
  } catch {}

  if (validEnvelope && window.opener) {
    window.opener.postMessage({
      type: 'oauth-callback',
      success,
      provider,
      email,
      error,
      nonce,
    }, window.location.origin);
  }

  window.setTimeout(() => window.close(), validEnvelope ? 750 : 2000);
  return true;
}
