/**
 * wordpressMediaUpload — pure helpers for robust WordPress REST media uploads.
 *
 * WordPress' `POST /wp/v2/media` endpoint accepts either a `multipart/form-data`
 * body or a raw-binary body. The raw-binary path is more reliable for filename
 * and mime fidelity because WP reads the filename from the `Content-Disposition`
 * header rather than guessing from a multipart part name. These helpers build
 * the raw-binary request headers and the caption follow-up body, and classify
 * the mime type so callers can FALL BACK to multipart when the mime is
 * indeterminate (never a hard failure).
 *
 * Dependency-light by design (no `fetch`, no credential derivation, `import
 * type` only) so it can be exercised by a standalone tsx smoke. It NEVER builds
 * an Authorization value — callers pass a pre-resolved Authorization string.
 */

/** Common image/document extensions WordPress media accepts. */
const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};

/**
 * Strip CRLF, quotes, and path separators from a filename so it is safe to
 * embed inside a `Content-Disposition` header value. Falls back to `'upload'`
 * when the input is empty/whitespace after sanitization. Never throws.
 */
export function sanitizeMediaFilename(name: string | null | undefined): string {
  if (!name) return 'upload';
  // Take the basename — drop any path component.
  const basename = String(name).split(/[\\/]/).pop() ?? '';
  const cleaned = basename
    .replace(/[\r\n]+/g, '') // CRLF / header-injection
    .replace(/["']/g, '') // quotes that would break the quoted-string
    .replace(/[\x00-\x1f\x7f]+/g, '') // other control chars
    .trim();
  return cleaned.length > 0 ? cleaned : 'upload';
}

/**
 * Resolve the upload mime type. Prefers a non-empty, image/* (or any explicit
 * type/subtype) blob type; otherwise maps the filename extension. Returns
 * `null` when indeterminate so the caller can fall back to the multipart path
 * rather than send a wrong/empty Content-Type. Never throws.
 */
export function resolveUploadMimeType(
  blobType: string | null | undefined,
  fileName: string | null | undefined,
): string | null {
  const trimmed = (blobType ?? '').trim().toLowerCase();
  if (trimmed && /^[a-z]+\/[a-z0-9.+-]+$/.test(trimmed)) {
    return trimmed;
  }
  const ext = String(fileName ?? '')
    .split('.')
    .pop()
    ?.toLowerCase()
    .trim();
  if (ext && EXTENSION_MIME_MAP[ext]) return EXTENSION_MIME_MAP[ext];
  return null;
}

/**
 * Build the headers for a raw-binary media upload. `authorization` is passed
 * through verbatim (this helper never touches credentials). `mimeType` is set
 * as Content-Type verbatim, and the sanitized filename is embedded in a
 * `Content-Disposition: attachment` header.
 */
export function buildMediaUploadHeaders(args: {
  authorization: string;
  mimeType: string;
  filename: string;
}): Record<string, string> {
  return {
    Authorization: args.authorization,
    'Content-Type': args.mimeType,
    'Content-Disposition': `attachment; filename="${sanitizeMediaFilename(args.filename)}"`,
  };
}

/**
 * Build the JSON body for a caption follow-up `POST /media/{id}`. Mirrors how
 * the alt_text follow-up is gated: returns `{ caption }` only when the caption
 * is a non-empty trimmed string, else `null` (caller skips the request).
 */
export function buildCaptionFollowUpBody(
  caption: string | null | undefined,
): { caption: string } | null {
  const trimmed = (caption ?? '').trim();
  if (!trimmed) return null;
  return { caption: trimmed };
}
