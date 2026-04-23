/**
 * skillFrontmatter — pure parser for SKILL.md frontmatter, extracted out
 * of `skillLibrary.ts` so tests and non-RN environments can import it
 * without dragging Supabase / React Native in.
 *
 * Handles the five fields we care about (name, description, version,
 * tags, platform). Anything richer is returned via `rawFrontmatter` for
 * the caller to parse with a full YAML library if needed.
 *
 * Accepted tag forms:
 *   tags: [a, b, c]
 *   tags: a, b, c
 *   tags: "a", 'b'
 */

export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  body: string;
  rawFrontmatter: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: content, rawFrontmatter: '' };
  const [, frontmatter, body] = match;
  const out: ReturnType<typeof parseSkillFrontmatter> = { body, rawFrontmatter: frontmatter };
  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    switch (key) {
      case 'name':        out.name = value; break;
      case 'description': out.description = value; break;
      case 'version':     out.version = value; break;
      case 'tags': {
        const inner = value.replace(/^\[|\]$/g, '');
        out.tags = inner
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        break;
      }
    }
  }
  return out;
}
