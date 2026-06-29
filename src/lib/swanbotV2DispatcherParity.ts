/**
 * swanbotV2DispatcherParity — pure source parsers that derive the set of
 * client-delegated (`clientOnly: true`) tool NAMES from three real files, so a
 * smoke can assert dispatcher↔v2 parity without importing any of them.
 *
 * The risk this guards (G1): a client-delegated tool added to the v2 edge
 * `TOOLS` array with no handler in `swanbotClientToolDispatcher.ts` (desktop.*
 * cases) or in `swanbot.ts` `dispatchOneClientTool` (browser/workspace/
 * verification/credentials/wp cases). The dispatcher's `default` and
 * `dispatchOneClientTool`'s `default` both return a silent error/null, so a
 * missing handler would NOT surface at build time — only at runtime as
 * "Unknown client tool". The parity smoke fails closed instead.
 *
 * Each parser takes file CONTENT (the smoke does the `readFileSync`) so this
 * module stays tsx-loadable with zero runtime imports.
 */

/**
 * Extract the names of `clientOnly: true` tools from the v2 edge `TOOLS` array.
 * In the real file all client-delegated tools live inside one of two
 * `...[ ... ].map((spec) => ({ ... clientOnly: true ... }))` groups; we collect
 * every `name: "..."` literal inside a group whose `.map(...)` decoration sets
 * `clientOnly: true`. Inline (non-grouped) clientOnly tools are also captured
 * as a defensive guard (currently zero).
 */
export function parseV2ClientOnlyToolNames(v2Source: string): string[] {
  const lines = v2Source.split('\n');
  const startIdx = lines.findIndex((line) => /const TOOLS:\s*ToolDef\[\]\s*=\s*\[/.test(line));
  if (startIdx < 0) throw new Error('parseV2ClientOnlyToolNames: TOOLS array start not found');
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^\];\s*$/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) throw new Error('parseV2ClientOnlyToolNames: TOOLS array terminator not found');

  const names: string[] = [];
  let inGroup = false;
  let groupStartLine = -1;
  let groupNames: string[] = [];
  // Track inline clientOnly: capture the most recent top-level name when an
  // inline `clientOnly: true` appears outside a group.
  let lastTopLevelName: string | null = null;
  const inlineClientOnlyNames = new Set<string>();

  for (let i = startIdx + 1; i < endIdx; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    if (/^\.\.\.\[\s*$/.test(trimmed)) {
      inGroup = true;
      groupStartLine = i;
      groupNames = [];
      continue;
    }

    if (/^\]\.map\(\(spec\)/.test(trimmed) && inGroup) {
      let decorationEnd = Math.min(i + 15, endIdx - 1);
      for (let j = i; j <= decorationEnd; j += 1) {
        if (/satisfies ToolDef\)\),\s*$/.test(lines[j].trim())) {
          decorationEnd = j;
          break;
        }
      }
      const decoration = lines.slice(i, decorationEnd + 1).join('\n');
      if (/clientOnly:\s*true/.test(decoration)) {
        names.push(...groupNames);
      }
      inGroup = false;
      groupNames = [];
      i = decorationEnd;
      continue;
    }

    const nameMatch = trimmed.match(/^name:\s*"([^"]+)",?\s*$/);
    if (nameMatch) {
      if (inGroup) groupNames.push(nameMatch[1]);
      else lastTopLevelName = nameMatch[1];
      continue;
    }

    if (/^clientOnly:\s*true,?$/.test(trimmed) && !inGroup && lastTopLevelName) {
      inlineClientOnlyNames.add(lastTopLevelName);
    }
  }

  for (const n of inlineClientOnlyNames) names.push(n);
  return Array.from(new Set(names));
}

/**
 * Extract `desktop.*` case labels handled by the root-owned desktop dispatcher
 * (`swanbotClientToolDispatcher.ts`). Each `case 'desktop.x':` is one handler.
 */
export function parseDesktopDispatcherToolNames(dispatcherSource: string): string[] {
  const names = new Set<string>();
  const re = /case\s+'(desktop\.[a-z0-9_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dispatcherSource))) names.add(m[1]);
  return Array.from(names);
}

/**
 * Extract the inline client-tool case labels handled by `dispatchOneClientTool`
 * in `swanbot.ts` — the browser/workspace/verification/credentials/wp families.
 * Scoped to the `dispatchOneClientTool` switch body so unrelated `case` labels
 * elsewhere in the file are not counted.
 */
export function parseInlineClientToolNames(swanbotSource: string): string[] {
  const fnIdx = swanbotSource.indexOf('async function dispatchOneClientTool');
  if (fnIdx < 0) throw new Error('parseInlineClientToolNames: dispatchOneClientTool not found');
  // Bound the scan to the function body: from the fn start to the first
  // `default:` return that closes the switch.
  const afterFn = swanbotSource.slice(fnIdx);
  const defaultIdx = afterFn.indexOf('default:');
  const body = defaultIdx >= 0 ? afterFn.slice(0, defaultIdx) : afterFn;
  const names = new Set<string>();
  const re = /case\s+'((?:browser|workspace|verification|credentials|wp)\.[a-z0-9_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) names.add(m[1]);
  return Array.from(names);
}
