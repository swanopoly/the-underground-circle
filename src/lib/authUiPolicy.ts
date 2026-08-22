export type AuthUiAction =
  | 'login'
  | 'signup'
  | 'oauth'
  | 'sso'
  | 'reset_request'
  | 'password_update';

type AuthErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
} | string | null | undefined;

function errorText(error: AuthErrorLike): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (!error || typeof error !== 'object') return '';
  return [error.name, error.code, error.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function errorStatus(error: AuthErrorLike): number | null {
  if (!error || typeof error !== 'object' || typeof error.status !== 'number') return null;
  return error.status;
}

export function normalizeAuthEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isExistingAccountError(error: AuthErrorLike): boolean {
  const text = errorText(error);
  return text.includes('already registered')
    || text.includes('already exists')
    || text.includes('user_already_exists');
}

export function getSafeAuthErrorMessage(action: AuthUiAction, error: AuthErrorLike): string {
  const text = errorText(error);
  const status = errorStatus(error);

  if (status === 429 || text.includes('rate limit') || text.includes('too many request')) {
    return 'Too many attempts. Wait a moment before trying again.';
  }

  if (
    text.includes('network')
    || text.includes('failed to fetch')
    || text.includes('aborterror')
    || text.includes('timed out')
  ) {
    return action === 'login'
      ? 'Sign-in timed out. Check your connection and try again.'
      : 'We could not reach the authentication service. Check your connection and try again.';
  }

  if (
    action === 'login'
    && (
      text.includes('weakpassword')
      || text.includes('weak_password')
      || text.includes('password is known to be leaked')
      || text.includes('password does not meet')
    )
  ) {
    return 'For security, reset your password before signing in.';
  }

  if (action === 'login') {
    return 'Email or password is incorrect.';
  }
  if (action === 'signup') {
    return 'We could not create the account. Check the details and try again.';
  }
  if (action === 'reset_request') {
    return 'We could not start password recovery. Check your connection and try again.';
  }
  if (action === 'password_update') {
    if (
      status === 401
      || text.includes('expired')
      || text.includes('session')
      || text.includes('token')
    ) {
      return 'This password-reset link is invalid or expired. Request a new one.';
    }
    return 'We could not update the password. Request a new reset link and try again.';
  }
  if (action === 'sso') {
    return 'SSO sign-in could not be started. Check the company domain and try again.';
  }
  return 'Sign-in could not be completed. Try again.';
}

export function buildPasswordResetRedirect(origin?: string | null): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL('/reset-password', origin).toString();
  } catch {
    return undefined;
  }
}

export function isPasswordRecoveryLocation(
  pathname?: string | null,
  search?: string | null,
  hash?: string | null,
): boolean {
  if ((pathname || '').replace(/\/+$/, '') === '/reset-password') return true;
  const combined = `${search || ''}&${hash || ''}`.toLowerCase();
  return /(?:[?&#]|^)type=recovery(?:[&#]|$)/.test(combined);
}

/** Install a scoped, visible keyboard focus ring for the auth surfaces. */
export function installAuthFocusStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('uc-auth-focus-styles')) return;
  const style = document.createElement('style');
  style.id = 'uc-auth-focus-styles';
  style.textContent = `
    [data-uc-auth-surface] *:focus-visible {
      outline: 3px solid #b8ff61 !important;
      outline-offset: 3px !important;
    }
    [data-uc-auth-surface] input:focus-visible,
    [data-uc-auth-surface] textarea:focus-visible {
      outline-width: 2px !important;
      outline-offset: 1px !important;
    }
    /* Opt-out for fields whose own shell lights up on focus. The ring is
       drawn on the bare <input>, which has no radius, so it reads as a
       hard-edged box inside the shell's rounded border. Only tag a field
       that has a replacement indicator — an untagged field keeps the ring. */
    [data-uc-auth-surface] [data-uc-auth-field]:focus,
    [data-uc-auth-surface] [data-uc-auth-field]:focus-visible {
      outline: none !important;
    }
  `;
  document.head.appendChild(style);
}
