// a11yTargetResolverCore — resolve a durable human label ("Export") to the
// authoritative accessibility element (dotted path + SoM elementIndex) at READ
// time, closing the stale-path window between an observe and the follow-up act.
//
// Computer-use expansion v6. PURE + tsx-loadable: zero runtime imports, no
// Date.now()/Math.random(), every export TOTAL (null/undefined/wrong-type/
// huge/hostile input yields a safe neutral result, never throws) and bounded.
//
// Input is the rendered a11y-tree lines produced by renderA11yTree() in
// src/lib/desktopBridge.ts, e.g.:
//   "[1.2.4.0] AXButton \"Export\""                 (no SoM index)
//   "  [#7] [1.2.4.0] AXButton \"Export\" = \"…\""  (SoM index [#7], path 1.2.4.0)
// The [#N] prefix is the `elementIndex` accepted by click_element /
// set_element_value; the [path] bracket is the dotted `id`.

/** A single parsed accessibility node addressed by SoM index and/or dotted path. */
export interface A11yTreeNode {
  /** SoM-style stable index ([#N]) assigned by the bridge for this read. */
  index?: number;
  /** Dotted path / id from the [path] bracket, e.g. "1.2.4.0". */
  path?: string;
  /** AX role token, e.g. "AXButton" or "button". */
  role?: string;
  /** Human label (title / description). */
  label?: string;
}

/** Result of resolving a target string against a set of rendered a11y lines. */
export interface A11yTargetResolution {
  /** True only when exactly one element matched the best tier. */
  found: boolean;
  /** SoM index of the resolved element (preferred addressing), when present. */
  elementIndex?: number;
  /** Dotted path of the resolved element, when present. */
  path?: string;
  /** AX role of the resolved element, when known. */
  role?: string;
  /** True when more than one element matched the best tier. */
  ambiguous: boolean;
  /** Count of matches in the chosen tier (0 when not found). */
  candidates: number;
  /** Human/model-facing explanation; recommends elementIndex over bare path. */
  note: string;
}

// Bounds — keep work and output finite even for hostile input.
const MAX_STRING = 2_000_000; // cap a single blob before splitting into lines
const MAX_LINES = 20_000; // cap number of lines scanned
const MAX_NODES = 20_000; // cap parsed nodes retained
const MAX_LINE = 4_000; // cap per-line length before regex work
const MAX_FIELD = 200; // cap path/label length
const MAX_ROLE = 80; // cap role length
const MAX_TARGET_DISPLAY = 80; // cap target text shown in notes
const MAX_INDEX = 10_000_000; // sane upper bound for a SoM index
const PREVIEW = 5; // ambiguous-candidate preview count

function coerceLineString(item: unknown): string | null {
  if (typeof item === 'string') return item;
  if (typeof item === 'number' && Number.isFinite(item)) return String(item);
  if (typeof item === 'boolean') return String(item);
  return null; // objects / null / undefined / functions → skip
}

/**
 * Parse ONE rendered a11y line into a node. Returns null for header lines,
 * blanks, truncation trailers, slice markers, and anything that is not an
 * addressable node line. Tolerant of indentation and missing fields.
 */
function parseA11yLine(raw: string): A11yTreeNode | null {
  let s = raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) : raw;
  s = s.trim();
  // Node lines always start with a '[' bracket after trimming.
  if (!s || s.charCodeAt(0) !== 91 /* '[' */) return null;

  let index: number | undefined;
  let path: string | undefined;

  // Optional SoM index prefix: [#N]
  const idxMatch = /^\[#(\d+)\]\s*/.exec(s);
  if (idxMatch) {
    const n = Number(idxMatch[1]);
    if (Number.isInteger(n) && n > 0 && n < MAX_INDEX) index = n;
    s = s.slice(idxMatch[0].length);
  }

  // Optional [path] bracket. A real dotted path/id has no whitespace; a bracket
  // containing whitespace (e.g. "[slice: 38 of 412 …]") is a marker, not a node.
  const pathMatch = /^\[([^\]]*)\]\s*/.exec(s);
  if (pathMatch) {
    const p = pathMatch[1].trim();
    if (p && /\s/.test(p)) return null; // marker-like bracket → not a node line
    if (p) path = p.length > MAX_FIELD ? p.slice(0, MAX_FIELD) : p;
    s = s.slice(pathMatch[0].length);
  }

  // Without any addressing token this is not a usable node.
  if (index === undefined && path === undefined) return null;

  s = s.trim();

  // Role: first token that is neither whitespace nor a quote.
  let role: string | undefined;
  const roleMatch = /^([^\s"]+)/.exec(s);
  if (roleMatch) {
    const r = roleMatch[1];
    role = r.length > MAX_ROLE ? r.slice(0, MAX_ROLE) : r;
    s = s.slice(r.length).trim();
  }

  // Label: only when the remainder opens with a quote. A remainder that opens
  // with '=' is a `= "value"` state field (renderA11yTree emits value without a
  // label), which is NOT a human label and must not be treated as one.
  let label: string | undefined;
  if (s.charCodeAt(0) === 34 /* '"' */) {
    const lm = /^"((?:[^"\\]|\\.)*)"/.exec(s);
    // renderA11yTree only escapes '"' → '\"'; undo just that. When the line was
    // truncated at MAX_LINE the closing quote can be missing — capture the
    // remainder so a truncated label still resolves by prefix/substring.
    const captured = lm ? lm[1] : s.slice(1);
    const decoded = captured.replace(/\\"/g, '"');
    label = decoded.length > MAX_FIELD ? decoded.slice(0, MAX_FIELD) : decoded;
  }

  const node: A11yTreeNode = {};
  if (index !== undefined) node.index = index;
  if (path !== undefined) node.path = path;
  if (role !== undefined) node.role = role;
  if (label !== undefined) node.label = label;
  return node;
}

/**
 * Parse rendered a11y lines into nodes. Accepts an array of lines, a single
 * newline-joined blob, or anything else (→ []). Always returns a bounded array.
 */
export function parseA11yLines(lines: unknown): A11yTreeNode[] {
  const out: A11yTreeNode[] = [];
  try {
    let arr: unknown[];
    if (typeof lines === 'string') {
      const blob = lines.length > MAX_STRING ? lines.slice(0, MAX_STRING) : lines;
      arr = blob.split(/\r?\n/);
    } else if (Array.isArray(lines)) {
      arr = lines;
    } else {
      return out;
    }
    const limit = Math.min(arr.length, MAX_LINES);
    for (let i = 0; i < limit; i++) {
      const str = coerceLineString(arr[i]);
      if (str === null) continue;
      const node = parseA11yLine(str);
      if (node) {
        out.push(node);
        if (out.length >= MAX_NODES) break;
      }
    }
  } catch {
    return out;
  }
  return out;
}

function normTarget(target: unknown): string {
  let t: string;
  if (typeof target === 'string') t = target;
  else if (typeof target === 'number' && Number.isFinite(target)) t = String(target);
  else return '';
  t = t.trim();
  // Tolerate a caller that wraps the label in quotes: "Export" → Export.
  if (t.length >= 2 && t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function displayOf(t: string): string {
  return t.length > MAX_TARGET_DISPLAY ? t.slice(0, MAX_TARGET_DISPLAY) + '…' : t;
}

function labelKey(n: A11yTreeNode): string {
  return typeof n.label === 'string' ? n.label.trim().toLowerCase() : '';
}

/** Role match variants: lowercased role, plus AX-prefix-stripped form. */
function roleMatches(n: A11yTreeNode, t: string): boolean {
  if (typeof n.role !== 'string') return false;
  const r = n.role.trim().toLowerCase();
  if (!r) return false;
  if (r === t) return true;
  if (r.length > 2 && r.startsWith('ax') && r.slice(2) === t) return true;
  return false;
}

function validIndex(n: A11yTreeNode): number | undefined {
  return typeof n.index === 'number' && Number.isInteger(n.index) && n.index > 0
    ? n.index
    : undefined;
}

function tokenOf(n: A11yTreeNode): string {
  const idx = validIndex(n);
  if (idx !== undefined) return '#' + idx;
  if (typeof n.path === 'string' && n.path) return n.path;
  return '?';
}

/**
 * Resolve a durable target label (or role) to the authoritative element in the
 * given rendered a11y lines.
 *
 * Matching is tiered so ambiguity stays predictable:
 *   1. exact label (case-insensitive)
 *   2. exact role  (case-insensitive, AX-prefix tolerant) — only if tier 1 empty
 *   3. label contains target (case-insensitive)           — only if 1 & 2 empty
 *
 * Exactly one match in the chosen tier → found (with elementIndex + path).
 * More than one → ambiguous (candidates = count). None → not found.
 * The note always prefers the elementIndex over the bare path.
 */
export function resolveA11yTarget(target: unknown, lines: unknown): A11yTargetResolution {
  try {
    const t = normTarget(target);
    if (!t) {
      return {
        found: false,
        ambiguous: false,
        candidates: 0,
        note: 'Provide a non-empty target label or role to resolve.',
      };
    }
    const disp = displayOf(t);
    const nodes = parseA11yLines(lines);
    if (nodes.length === 0) {
      return {
        found: false,
        ambiguous: false,
        candidates: 0,
        note: `No accessibility nodes to resolve "${disp}" against — read or observe the app first.`,
      };
    }

    const lt = t.toLowerCase();
    const tierLabelExact = nodes.filter((n) => labelKey(n) === lt);
    const tier =
      tierLabelExact.length > 0
        ? tierLabelExact
        : (() => {
            const tierRoleExact = nodes.filter((n) => roleMatches(n, lt));
            if (tierRoleExact.length > 0) return tierRoleExact;
            return nodes.filter((n) => {
              const k = labelKey(n);
              return k.length > 0 && k.includes(lt);
            });
          })();

    if (tier.length === 0) {
      return {
        found: false,
        ambiguous: false,
        candidates: 0,
        note: `No accessibility element matched "${disp}" among ${nodes.length} parsed node${nodes.length === 1 ? '' : 's'}. Check the label text or read a targeted slice.`,
      };
    }

    if (tier.length > 1) {
      const preview = tier.slice(0, PREVIEW).map(tokenOf).join(', ');
      const more = tier.length > PREVIEW ? ', …' : '';
      return {
        found: false,
        ambiguous: true,
        candidates: tier.length,
        note: `"${disp}" is ambiguous: ${tier.length} matching elements (${preview}${more}). Narrow with a more specific label or role, or read a targeted slice.`,
      };
    }

    // Exactly one authoritative match.
    const node = tier[0];
    const elementIndex = validIndex(node);
    const path = typeof node.path === 'string' && node.path ? node.path : undefined;
    const role = typeof node.role === 'string' && node.role ? node.role : undefined;
    const roleNote = role ? `, role ${role}` : '';

    let note: string;
    if (elementIndex !== undefined) {
      const pathNote = path ? `, path ${path}` : '';
      note = `Resolved "${disp}" to elementIndex ${elementIndex} (${pathNote ? pathNote.slice(2) : 'no path'}${roleNote}). Use elementIndex for click/set — it is validated against this read; do not reuse a bare path.`;
    } else if (path) {
      note = `Resolved "${disp}" to path ${path}${roleNote}. No stable elementIndex in this read — re-read the a11y tree to get one, or act by path.`;
    } else {
      note = `Resolved "${disp}"${roleNote}, but it carries no elementIndex or path — re-read the a11y tree before acting.`;
    }

    const res: A11yTargetResolution = { found: true, ambiguous: false, candidates: 1, note };
    if (elementIndex !== undefined) res.elementIndex = elementIndex;
    if (path !== undefined) res.path = path;
    if (role !== undefined) res.role = role;
    return res;
  } catch {
    return {
      found: false,
      ambiguous: false,
      candidates: 0,
      note: 'Unable to resolve target.',
    };
  }
}
