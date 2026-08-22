/**
 * Minimal line-by-line tokenizer for the Builder CODE view.
 *
 * No dependencies — we hand-roll a small state machine that recognizes the
 * language tokens users actually see in /build-page output (HTML with inline
 * <style> and <script>). The output is a flat list of { text, kind } spans
 * per line; the renderer maps kind → color.
 *
 * Deliberately imperfect. A real highlighter (prism, shiki) would win on
 * edge cases but pulls in kilobytes. This is tuned for the 90% case we ship.
 */

export type TokenKind =
  | 'text'        // default
  | 'tag'         // <div>, </div>, <img />
  | 'attr'        // class=
  | 'string'      // "foo", 'bar'
  | 'comment'     // <!-- ... -->, // ..., /* ... */
  | 'keyword'     // const, function, return, import, export, if, else, etc
  | 'number'      // 42, 3.14, 0xff
  | 'punct'       // { } ( ) [ ] ; : ,
  | 'selector'    // .foo, #id, body, @media — inside <style>
  | 'prop';       // color:, padding: — inside <style> rules

export interface Token {
  text: string;
  kind: TokenKind;
}

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'this',
  'class', 'extends', 'import', 'export', 'from', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'delete',
  'in', 'of', 'null', 'undefined', 'true', 'false', 'void',
]);

// Contextual language — we flip modes when we cross <style>/</style> and
// <script>/</script> boundaries. This is the cheapest way to keep HTML
// attrs from being colored as CSS properties.
type Mode = 'html' | 'style' | 'script';

export class StreamTokenizer {
  private mode: Mode = 'html';

  // Tokenize one line in the current mode. Honors open/close tags so the
  // caller can feed the tokenizer sequentially across multi-line files.
  tokenizeLine(line: string): Token[] {
    if (this.mode === 'style') return this.tokenizeStyle(line);
    if (this.mode === 'script') return this.tokenizeScript(line);
    return this.tokenizeHtml(line);
  }

  private tokenizeHtml(line: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = line.length;
    while (i < len) {
      // Opening HTML comment
      if (line.startsWith('<!--', i)) {
        const end = line.indexOf('-->', i + 4);
        if (end >= 0) {
          tokens.push({ text: line.slice(i, end + 3), kind: 'comment' });
          i = end + 3;
        } else {
          tokens.push({ text: line.slice(i), kind: 'comment' });
          i = len;
        }
        continue;
      }
      // Tag open
      if (line[i] === '<' && /[a-zA-Z/!]/.test(line[i + 1] || '')) {
        const tagEnd = line.indexOf('>', i);
        const end = tagEnd < 0 ? len : tagEnd + 1;
        const inner = line.slice(i, end);
        // Track style/script transitions
        const nameMatch = inner.match(/^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
        const name = nameMatch ? nameMatch[1].toLowerCase() : '';
        if (name === 'style' && !inner.startsWith('</')) this.mode = 'style';
        if (name === 'script' && !inner.startsWith('</')) this.mode = 'script';
        this.pushTagTokens(inner, tokens);
        i = end;
        continue;
      }
      // Default text until next <
      const next = line.indexOf('<', i);
      if (next < 0) {
        tokens.push({ text: line.slice(i), kind: 'text' });
        break;
      }
      tokens.push({ text: line.slice(i, next), kind: 'text' });
      i = next;
    }
    return tokens;
  }

  private pushTagTokens(tag: string, out: Token[]): void {
    // Split "<tag attr="val" …>" into tag + attrs. Simple pass.
    let i = 0;
    const len = tag.length;
    // Leading "<" or "</"
    if (tag.startsWith('</')) { out.push({ text: '</', kind: 'tag' }); i = 2; }
    else if (tag.startsWith('<')) { out.push({ text: '<', kind: 'tag' }); i = 1; }

    // Tag name
    const nameMatch = tag.slice(i).match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    if (nameMatch) {
      out.push({ text: nameMatch[0], kind: 'tag' });
      i += nameMatch[0].length;
    }

    // Attributes
    while (i < len) {
      const rest = tag.slice(i);
      // whitespace
      const wsMatch = rest.match(/^\s+/);
      if (wsMatch) { out.push({ text: wsMatch[0], kind: 'text' }); i += wsMatch[0].length; continue; }
      // closing '>' or '/>'
      if (tag[i] === '>' || (tag[i] === '/' && tag[i + 1] === '>')) {
        const chunk = tag[i] === '/' ? '/>' : '>';
        out.push({ text: chunk, kind: 'tag' });
        i += chunk.length;
        continue;
      }
      // attribute name
      const attrNameMatch = rest.match(/^[a-zA-Z_:][a-zA-Z0-9_:.-]*/);
      if (attrNameMatch) {
        out.push({ text: attrNameMatch[0], kind: 'attr' });
        i += attrNameMatch[0].length;
        if (tag[i] === '=') { out.push({ text: '=', kind: 'punct' }); i += 1; }
        // value (quoted or bare)
        const q = tag[i];
        if (q === '"' || q === "'") {
          const end = tag.indexOf(q, i + 1);
          if (end < 0) { out.push({ text: tag.slice(i), kind: 'string' }); i = len; }
          else { out.push({ text: tag.slice(i, end + 1), kind: 'string' }); i = end + 1; }
        } else {
          const bare = rest.slice(attrNameMatch[0].length + 1).match(/^[^\s>]+/);
          if (bare) { out.push({ text: bare[0], kind: 'string' }); i += bare[0].length; }
        }
        continue;
      }
      // fallback: consume one char
      out.push({ text: tag[i], kind: 'text' });
      i += 1;
    }
  }

  private tokenizeStyle(line: string): Token[] {
    // Look for </style> — ends style mode for the rest of the file
    const close = line.toLowerCase().indexOf('</style');
    if (close >= 0) {
      const before = line.slice(0, close);
      const tokens = this.cssLine(before);
      this.mode = 'html';
      const tail = line.slice(close);
      // Tail still contains a closing tag; run through HTML tokenizer
      tokens.push(...this.tokenizeHtml(tail));
      return tokens;
    }
    return this.cssLine(line);
  }

  private pushStringsAndNumbers(text: string, out: Token[]): void {
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let end = i + 1;
        while (end < text.length) {
          if (text[end] === quote && text[end - 1] !== '\\') break;
          end += 1;
        }
        out.push({ text: text.slice(i, Math.min(end + 1, text.length)), kind: 'string' });
        i = Math.min(end + 1, text.length);
        continue;
      }

      const numberMatch = text.slice(i).match(/^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|ms|s|deg)?)/);
      if (numberMatch) {
        out.push({ text: numberMatch[0], kind: 'number' });
        i += numberMatch[0].length;
        continue;
      }

      const punctMatch = text.slice(i).match(/^[(),/]/);
      if (punctMatch) {
        out.push({ text: punctMatch[0], kind: 'punct' });
        i += punctMatch[0].length;
        continue;
      }

      let next = i + 1;
      while (next < text.length) {
        const nextCh = text[next];
        if (nextCh === '"' || nextCh === "'" || /[(),/]/.test(nextCh)) break;
        if (/^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|\d)/.test(text.slice(next))) break;
        next += 1;
      }
      out.push({ text: text.slice(i, next), kind: 'text' });
      i = next;
    }
  }

  private cssLine(line: string): Token[] {
    const tokens: Token[] = [];
    // Full-line comment /* … */
    const commentStart = line.indexOf('/*');
    if (commentStart >= 0) {
      if (commentStart > 0) tokens.push(...this.cssLine(line.slice(0, commentStart)));
      const commentEnd = line.indexOf('*/', commentStart + 2);
      if (commentEnd >= 0) {
        tokens.push({ text: line.slice(commentStart, commentEnd + 2), kind: 'comment' });
        tokens.push(...this.cssLine(line.slice(commentEnd + 2)));
      } else {
        tokens.push({ text: line.slice(commentStart), kind: 'comment' });
      }
      return tokens;
    }
    // property: value; pattern
    const propMatch = line.match(/^(\s*)([a-zA-Z-]+)(\s*:\s*)([^;]*)(;?)(.*)$/);
    if (propMatch) {
      const [, lead, prop, sep, val, semi, rest] = propMatch;
      if (lead) tokens.push({ text: lead, kind: 'text' });
      tokens.push({ text: prop, kind: 'prop' });
      tokens.push({ text: sep, kind: 'punct' });
      // value may contain strings
      this.pushStringsAndNumbers(val, tokens);
      if (semi) tokens.push({ text: semi, kind: 'punct' });
      if (rest) tokens.push({ text: rest, kind: 'text' });
      return tokens;
    }
    // selector line (e.g. `.foo, #bar {` or `body {`)
    const selectorMatch = line.match(/^(\s*)([^{]*)(\{?)(.*)$/);
    if (selectorMatch && selectorMatch[2].trim()) {
      const [, lead, sel, brace, rest] = selectorMatch;
      if (lead) tokens.push({ text: lead, kind: 'text' });
      tokens.push({ text: sel, kind: 'selector' });
      if (brace) tokens.push({ text: brace, kind: 'punct' });
      if (rest) tokens.push({ text: rest, kind: 'text' });
      return tokens;
    }
    return [{ text: line, kind: 'text' }];
  }

  private tokenizeScript(line: string): Token[] {
    // Detect </script> closing
    const close = line.toLowerCase().indexOf('</script');
    if (close >= 0) {
      const before = line.slice(0, close);
      const tokens = this.jsLine(before);
      this.mode = 'html';
      tokens.push(...this.tokenizeHtml(line.slice(close)));
      return tokens;
    }
    return this.jsLine(line);
  }

  private jsLine(line: string): Token[] {
    const tokens: Token[] = [];
    // // single-line comment
    const sl = line.indexOf('//');
    if (sl >= 0) {
      tokens.push(...this.jsPart(line.slice(0, sl)));
      tokens.push({ text: line.slice(sl), kind: 'comment' });
      return tokens;
    }
    return this.jsPart(line);
  }

  private jsPart(part: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = part.length;
    while (i < len) {
      const c = part[i];
      // String
      if (c === '"' || c === '\'' || c === '`') {
        const end = part.indexOf(c, i + 1);
        if (end < 0) { tokens.push({ text: part.slice(i), kind: 'string' }); i = len; }
        else { tokens.push({ text: part.slice(i, end + 1), kind: 'string' }); i = end + 1; }
        continue;
      }
      // Identifier / keyword
      if (/[a-zA-Z_$]/.test(c)) {
        const m = part.slice(i).match(/^[a-zA-Z_$][a-zA-Z_$0-9]*/);
        const word = m![0];
        tokens.push({ text: word, kind: JS_KEYWORDS.has(word) ? 'keyword' : 'text' });
        i += word.length;
        continue;
      }
      // Number
      if (/\d/.test(c)) {
        const m = part.slice(i).match(/^\d+(\.\d+)?/);
        tokens.push({ text: m![0], kind: 'number' });
        i += m![0].length;
        continue;
      }
      // Punct
      if ('{}()[];:,.=<>+-*/!&|?'.includes(c)) {
        tokens.push({ text: c, kind: 'punct' });
        i += 1;
        continue;
      }
      tokens.push({ text: c, kind: 'text' });
      i += 1;
    }
    return tokens;
  }
}

export const TOKEN_COLORS: Record<TokenKind, string> = {
  text:     '#d8e1ef',
  tag:      '#60a5fa',   // blue
  attr:     '#6366f1',   // cyan
  string:   '#86efac',   // green
  comment:  '#64748b',   // gray
  keyword:  '#c084fc',   // violet
  number:   '#facc15',   // yellow
  punct:    '#94a3b8',   // slate
  selector: '#f472b6',   // pink
  prop:     '#6366f1',   // cyan (same as attrs)
};
