/**
 * RFC 6238 TOTP (Time-Based One-Time Password) generator.
 *
 * Used by the Site Credential Vault to generate the current 6-digit code
 * for a stored TOTP seed without round-tripping the seed through any
 * external service. All computation is local; the seed only needs to leave
 * the encrypted column for the duration of one HMAC.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  // Strip whitespace, hyphens, and 'otpauth://' query-string padding;
  // accept the seed in either canonical "JBSWY3DPEHPK3PXP" form or in
  // an otpauth:// URL.
  const trimmed = input.trim();
  let secret = trimmed;
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      const param = url.searchParams.get('secret');
      if (param) secret = param;
    } catch {
      // Fall through and let the cleanup below try.
    }
  }
  const cleaned = secret.replace(/[\s\-_=]/g, '').toUpperCase();
  if (!cleaned) return new Uint8Array(0);
  if (!/^[A-Z2-7]+$/.test(cleaned)) {
    throw new Error('Invalid base32 character in TOTP seed.');
  }
  const bits = cleaned
    .split('')
    .map((ch) => {
      const idx = BASE32_ALPHABET.indexOf(ch);
      if (idx < 0) throw new Error('Invalid base32 character.');
      return idx.toString(2).padStart(5, '0');
    })
    .join('');
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

function uint64BE(value: number): Uint8Array {
  // 8-byte big-endian counter. RFC 6238 uses 64-bit counters but TOTP
  // values fit in 53 bits comfortably for any time we care about.
  const buf = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    buf[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return buf;
}

export interface TotpOptions {
  /** Step size in seconds. Default 30 — what every authenticator uses. */
  period?: number;
  /** Number of digits in the code. Default 6. */
  digits?: number;
  /** Override "now" for testing. Defaults to Date.now(). */
  now?: number;
}

export interface TotpCode {
  code: string;
  /** Seconds remaining until the current code expires. */
  remainingSeconds: number;
  /** Step size that was used. */
  period: number;
}

export async function generateTotp(seed: string, options: TotpOptions = {}): Promise<TotpCode> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API unavailable in this runtime.');
  }
  const period = options.period ?? 30;
  const digits = options.digits ?? 6;
  const seconds = Math.floor((options.now ?? Date.now()) / 1000);
  const counter = Math.floor(seconds / period);
  const remainingSeconds = period - (seconds % period);

  const keyBytes = base32Decode(seed);
  if (keyBytes.length === 0) {
    throw new Error('TOTP seed is empty.');
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counterBytes = uint64BE(counter);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      counterBytes.buffer.slice(counterBytes.byteOffset, counterBytes.byteOffset + counterBytes.byteLength) as ArrayBuffer,
    ),
  );

  // Dynamic truncation per RFC 4226 §5.3.
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const mod = 10 ** digits;
  const code = String(binary % mod).padStart(digits, '0');
  return { code, remainingSeconds, period };
}
