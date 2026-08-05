const FILE_EXTENSION_PATTERN = [
  'png',
  'jpe?g',
  'gif',
  'webp',
  'svg',
  'heic',
  'pdf',
  'docx?',
  'xlsx?',
  'pptx?',
  'txt',
  'md',
  'csv',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'zip',
  'psd',
  'ai',
  'indd',
  'mov',
  'mp4',
  'mp3',
  'wav',
].join('|');

const QUOTED_FILENAME_RE = new RegExp(`["']([^"']+\\.(?:${FILE_EXTENSION_PATTERN}))["']`, 'i');
const TOKEN_FILENAME_RE = new RegExp(`\\b([A-Za-z0-9][A-Za-z0-9._()@+\\-]*\\.(?:${FILE_EXTENSION_PATTERN}))\\b`, 'ig');
const LOOSE_FILENAME_RE = new RegExp(`\\b([A-Za-z0-9][A-Za-z0-9._()@+\\- /]*\\.(?:${FILE_EXTENSION_PATTERN}))\\b`, 'i');
const ANY_EXTENSION_RE = /\.[A-Za-z0-9]{1,12}\b/;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripSearchLanguage(value: string): string {
  return compact(value)
    .replace(/^(?:can|could|would)\s+you\s+/i, '')
    .replace(/^(?:please\s+)?(?:search|find|locate)\s+(?:files?|folders?)?\s*(?:in|inside|under)\s+.+?\s+(?:for|matching|named|containing)\s+/i, '')
    .replace(/^(?:please\s+)?(?:search|find|locate)\s+(?:files?|folders?)?\s*(?:for\s+)?/i, '')
    .replace(/^(?:please\s+)?(?:look\s+for|open|read|show(?:\s+me)?|preview|inspect|summari[sz]e)\s+/i, '')
    .replace(/^(?:where\s+(?:is|are)|tell\s+me\s+where\s+(?:is|are))\s+(?:my\s+|the\s+|a\s+|an\s+)?/i, '')
    .replace(/^(?:the|a|an|my)\s+/i, '')
    .replace(/^(?:file|folder|image|photo|picture|document)\s+(?:named\s+|called\s+)?/i, '')
    .replace(/^(?:named|called)\s+/i, '')
    .replace(/\s+(?:(?:that'?s|thats|that\s+is|which\s+is)\s+)?(?:on|in|inside|under|from)\s+(?:the\s+|my\s+)?(?:computer|mac|laptop|desktop|downloads?|documents?|pictures?|photos?|home folder|home directory|files?)\s*$/i, '')
    .replace(/\s+(?:on|in|inside|under|from)\s+(?:my\s+)?(?:computer|mac|laptop|desktop|downloads?|documents?|pictures?|photos?|home folder|home directory|files?)\s*$/i, '')
    .replace(/\s+(?:file|folder|image|photo|picture|document)\s*$/i, '')
    .trim();
}

export function extractFilenameLikeFromText(value: string | null | undefined): string | null {
  const text = compact(String(value || ''));
  if (!text) return null;

  const quoted = text.match(QUOTED_FILENAME_RE)?.[1];
  if (quoted) return compact(quoted);

  TOKEN_FILENAME_RE.lastIndex = 0;
  const token = text.match(TOKEN_FILENAME_RE)?.[0];
  if (token) return compact(token);

  const loose = text.match(LOOSE_FILENAME_RE)?.[1];
  if (!loose) return null;

  const cleaned = stripSearchLanguage(loose);
  return cleaned && ANY_EXTENSION_RE.test(cleaned) ? cleaned : compact(loose);
}

export function normalizeDesktopFileSearchQuery(value: string | null | undefined): string {
  const text = compact(String(value || ''));
  if (!text) return '';

  const filename = extractFilenameLikeFromText(text);
  if (filename) return filename.slice(0, 120);

  return (stripSearchLanguage(text) || text).slice(0, 120);
}
