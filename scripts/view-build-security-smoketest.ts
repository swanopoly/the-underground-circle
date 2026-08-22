import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/view-build/index.ts"),
  "utf8",
);

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`view-build security smoke failed: ${message}`);
}

check(source.includes("escapeHtml(title)"), "error titles are escaped");
check(source.includes("escapeHtml(message)"), "error messages are escaped");
check(source.includes('if (req.method !== "GET")'), "renderer rejects non-GET methods");
check(source.includes('"X-Content-Type-Options": "nosniff"'), "nosniff is present");
check(source.includes('"Referrer-Policy": "no-referrer"'), "referrers are suppressed");
check(source.includes('"Content-Security-Policy": publishedPageCsp'), "published CSP is emitted");
check(source.includes('"Content-Security-Policy": errorPageCsp'), "error CSP is emitted");
check(source.includes("sandbox allow-scripts allow-forms allow-modals allow-popups"), "published HTML is sandboxed");
check(!source.includes("sandbox allow-same-origin"), "sandbox never restores same-origin authority");
check(!source.includes("allow-top-navigation"), "sandbox cannot navigate the viewer");
check(source.includes('"base-uri \'none\'"'), "base URL injection is blocked");
check(source.includes('"X-Frame-Options": "SAMEORIGIN"'), "public content framing is restricted");
check(source.includes('"X-Frame-Options": "DENY"'), "error pages cannot be framed");
check(source.includes('"Cross-Origin-Resource-Policy": "cross-origin"'), "public sharing has an explicit resource policy");

console.log(`view-build security smoke passed (${assertions} assertions)`);
