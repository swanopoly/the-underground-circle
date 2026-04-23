/**
 * swanbot-v2-approvals-smoketest — M3d coverage.
 *
 * Server-side approvals (reimplemented handler logic against the stub
 * Supabase client from the writers test):
 *   - approvals.list default status=pending; filters by circle; 'all' skips status filter
 *   - approvals.request requires title + approvalKind; rejects invalid kind;
 *     scope-guards runId (rejects cross-circle); falls back to ctx.runId
 *     when input.runId omitted; clamps timeoutSeconds to [30, 86400]
 *   - approvals.resolve requires 'approved' | 'rejected'; scope-guards
 *     circle_id; rejects already-resolved rows
 *
 * Client-side credentials.get (reimplemented from src/lib/swanbot.ts):
 *   - Requires item; passes vault + fields straight through
 *   - Bridge failure surfaces error cleanly
 *
 * Run: npm run smoke:swanbot-v2-approvals
 */

// ─── Stub Supabase builder (copied + trimmed from writers test) ────
type Row = Record<string, any>;
type TableName = "agent_run_approvals" | "agent_runs";

class StubBuilder {
  private op: "insert" | "update" | "select" = "select";
  private payload: any = null;
  private filters: Array<{ col: string; val: any }> = [];
  private noEqs: Array<{ col: string; val: any }> = [];
  private ordered = false;
  constructor(private store: StubStore, private table: TableName) {}
  insert(payload: any) { this.op = "insert"; this.payload = payload; return this; }
  update(payload: any) { this.op = "update"; this.payload = payload; return this; }
  select(_cols?: string) { return this; }
  eq(col: string, val: any) { this.filters.push({ col, val }); return this; }
  order(_col: string, _opts?: any) { this.ordered = true; return this; }
  limit(_n: number) { return this; }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true, true); }
  then<T = { data: any; error: any }>(onfulfilled?: (v: { data: any; error: any }) => T | PromiseLike<T>) {
    return this.execute(false).then(onfulfilled!);
  }
  private async execute(_single = false, allowEmpty = false): Promise<{ data: any; error: any }> {
    if (this.op === "insert") {
      const row = { id: `id_${Math.random().toString(36).slice(2, 10)}`, ...this.payload };
      this.store.inserted.push({ table: this.table, row });
      return { data: row, error: null };
    }
    if (this.op === "update") {
      this.store.updated.push({ table: this.table, filters: this.filters, payload: this.payload });
      return { data: null, error: null };
    }
    const rows = (this.store.rows[this.table] || []).filter((r) => this.filters.every((f) => r[f.col] === f.val));
    if (_single) {
      if (rows.length === 0 && allowEmpty) return { data: null, error: null };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

class StubStore {
  rows: Partial<Record<TableName, Row[]>> = {};
  inserted: Array<{ table: TableName; row: any }> = [];
  updated: Array<{ table: TableName; filters: any[]; payload: any }> = [];
  seed(table: TableName, rows: Row[]) { this.rows[table] = rows; }
  clear() { this.inserted = []; this.updated = []; }
}

function makeClient(store: StubStore) {
  return { from: (t: TableName) => new StubBuilder(store, t) } as any;
}

// ─── Handler shims (mirror supabase/functions/swanbot-v2-ai/index.ts) ─
type Ctx = { supabase: any; circleId: string; userId: string; runId?: string | null };
type Result = { ok: true; data: any } | { ok: false; error: string };

const APPROVAL_KINDS = [
  "tool_use","publish","external_send","file_write","browser_action",
  "cost_threshold","privileged_action","plan_approval","deliverable_review",
];

async function approvalsList(input: any, ctx: Ctx): Promise<Result> {
  const status = String(input?.status || "pending");
  const limit = Math.max(1, Math.min(50, input?.limit ?? 20));
  let q = ctx.supabase
    .from("agent_run_approvals")
    .select("id, title, approval_kind, status, requested_at, resolved_at, description")
    .eq("circle_id", ctx.circleId)
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { status, count: (data || []).length, approvals: data || [] } };
}

async function approvalsRequest(input: any, ctx: Ctx): Promise<Result> {
  const title = String(input?.title || "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "title required" };
  const approvalKind = input?.approvalKind || "privileged_action";
  if (!APPROVAL_KINDS.includes(approvalKind)) return { ok: false, error: "invalid approvalKind" };
  const effectiveRunId = (input?.runId && String(input.runId).trim()) || ctx.runId;
  if (!effectiveRunId) return { ok: false, error: "runId required (no current run and none provided)" };
  const { data: run, error: runErr } = await ctx.supabase
    .from("agent_runs")
    .select("id, circle_id")
    .eq("id", effectiveRunId)
    .maybeSingle();
  if (runErr) return { ok: false, error: runErr.message };
  if (!run || run.circle_id !== ctx.circleId) return { ok: false, error: "run not found in this circle" };
  const timeout = typeof input?.timeoutSeconds === "number"
    ? Math.max(30, Math.min(86400, input.timeoutSeconds))
    : 300;
  const { data, error } = await ctx.supabase
    .from("agent_run_approvals")
    .insert({
      run_id: effectiveRunId,
      circle_id: ctx.circleId,
      approval_kind: approvalKind,
      title,
      description: input?.description ? String(input.description).slice(0, 2000) : null,
      payload: input?.payload || {},
      status: "pending",
      requested_by: ctx.userId,
      timeout_seconds: timeout,
      metadata: { via: "swanbot-v2-ai" },
    })
    .select("id, title, status")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id, title: data.title, status: data.status } };
}

async function approvalsResolve(input: any, ctx: Ctx): Promise<Result> {
  const approvalId = String(input?.approvalId || "").trim();
  if (!approvalId) return { ok: false, error: "approvalId required" };
  if (input?.status !== "approved" && input?.status !== "rejected") {
    return { ok: false, error: "status must be 'approved' or 'rejected'" };
  }
  const { data: row, error: rowErr } = await ctx.supabase
    .from("agent_run_approvals")
    .select("id, circle_id, status")
    .eq("id", approvalId)
    .maybeSingle();
  if (rowErr) return { ok: false, error: rowErr.message };
  if (!row || row.circle_id !== ctx.circleId) return { ok: false, error: "approval not found in this circle" };
  if (row.status !== "pending") return { ok: false, error: `approval already ${row.status}` };
  const { error } = await ctx.supabase
    .from("agent_run_approvals")
    .update({
      status: input.status,
      resolved_by: ctx.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", approvalId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { approvalId, status: input.status } };
}

// ─── credentials.get client dispatcher shim ────────────────────────
async function dispatchCredentialsGet(
  stubGet: (opts: { item: string; vault?: string; fields?: string[] }) => Promise<any>,
  input: Record<string, any>,
) {
  const item = String(input?.item || "").trim();
  if (!item) return { ok: false, error: "item required" };
  const vault = typeof input?.vault === "string" ? input.vault.trim() : undefined;
  const fields = Array.isArray(input?.fields)
    ? (input.fields as unknown[]).map((f) => String(f)).filter(Boolean)
    : undefined;
  try {
    const r = await stubGet({ item, vault, fields });
    if (!r.ok) return { ok: false, error: r.error || "credential fetch failed" };
    return { ok: true, data: { item, vault: vault || null, fields: r.fields } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ─── Test runner ───────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error("FAIL:", m); }
function pass(m: string) { console.log("pass:", m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  // ─── approvals.list ──────────────────────────────────────────
  {
    const store = new StubStore();
    store.seed("agent_run_approvals", [
      { id: "a1", circle_id: "circle_A", status: "pending", title: "Publish draft", approval_kind: "publish", requested_at: "t1" },
      { id: "a2", circle_id: "circle_A", status: "approved", title: "Send email", approval_kind: "external_send", requested_at: "t2" },
      { id: "a3", circle_id: "circle_B", status: "pending", title: "Other circle", approval_kind: "publish", requested_at: "t3" },
    ]);
    const ctx: Ctx = { supabase: makeClient(store), circleId: "circle_A", userId: "u1" };
    const r1 = await approvalsList({}, ctx);
    assert(r1.ok, "approvals.list: default status ok");
    assert((r1 as any).data.status === "pending", "approvals.list: default status=pending");
    assert((r1 as any).data.count === 1, "approvals.list: default filters to pending+own-circle");
    assert((r1 as any).data.approvals[0].id === "a1", "approvals.list: returns correct row");

    const r2 = await approvalsList({ status: "all" }, ctx);
    assert((r2 as any).data.count === 2, "approvals.list: 'all' drops status filter (still scoped to circle)");

    const r3 = await approvalsList({ status: "approved" }, ctx);
    assert((r3 as any).data.count === 1, "approvals.list: 'approved' narrows correctly");
  }

  // ─── approvals.request ───────────────────────────────────────
  {
    const store = new StubStore();
    store.seed("agent_runs", [
      { id: "run_mine", circle_id: "circle_A" },
      { id: "run_theirs", circle_id: "circle_B" },
    ]);
    const ctx: Ctx = { supabase: makeClient(store), circleId: "circle_A", userId: "u1", runId: "run_mine" };

    const r1 = await approvalsRequest({ title: "Publish post", approvalKind: "publish" }, ctx);
    assert(r1.ok, "approvals.request: happy path with ctx.runId");
    assert(store.inserted[0].row.run_id === "run_mine", "approvals.request: attaches to ctx.runId");
    assert(store.inserted[0].row.requested_by === "u1", "approvals.request: requested_by=caller");
    assert(store.inserted[0].row.timeout_seconds === 300, "approvals.request: default timeout 300s");

    // Missing title
    store.clear();
    const r2 = await approvalsRequest({ approvalKind: "publish" }, ctx);
    assert(!r2.ok && /title required/.test((r2 as any).error), "approvals.request: missing title rejected");

    // Invalid kind
    const r3 = await approvalsRequest({ title: "x", approvalKind: "haxx" }, ctx);
    assert(!r3.ok && /invalid approvalKind/.test((r3 as any).error), "approvals.request: invalid kind rejected");

    // Cross-circle run id
    const r4 = await approvalsRequest({ title: "x", approvalKind: "publish", runId: "run_theirs" }, ctx);
    assert(!r4.ok && /run not found in this circle/.test((r4 as any).error), "approvals.request: cross-circle runId blocked");
    assert(store.inserted.length === 0, "approvals.request: no insert on cross-circle reject");

    // No ctx.runId, no input.runId
    const ctxNoRun: Ctx = { supabase: makeClient(store), circleId: "circle_A", userId: "u1" };
    const r5 = await approvalsRequest({ title: "x", approvalKind: "publish" }, ctxNoRun);
    assert(!r5.ok && /runId required/.test((r5 as any).error), "approvals.request: no runId → rejected");

    // Timeout clamping
    store.clear();
    const r6 = await approvalsRequest({ title: "t", approvalKind: "publish", timeoutSeconds: 5 }, ctx);
    assert(r6.ok && store.inserted[0].row.timeout_seconds === 30, "approvals.request: low timeout clamped to 30s");

    store.clear();
    const r7 = await approvalsRequest({ title: "t", approvalKind: "publish", timeoutSeconds: 999999 }, ctx);
    assert(r7.ok && store.inserted[0].row.timeout_seconds === 86400, "approvals.request: high timeout clamped to 86400s");
  }

  // ─── approvals.resolve ───────────────────────────────────────
  {
    const store = new StubStore();
    store.seed("agent_run_approvals", [
      { id: "a_pending", circle_id: "circle_A", status: "pending" },
      { id: "a_done", circle_id: "circle_A", status: "approved" },
      { id: "a_other", circle_id: "circle_B", status: "pending" },
    ]);
    const ctx: Ctx = { supabase: makeClient(store), circleId: "circle_A", userId: "u1" };

    const r1 = await approvalsResolve({ approvalId: "a_pending", status: "approved" }, ctx);
    assert(r1.ok, "approvals.resolve: happy path ok");
    assert(store.updated[0].payload.status === "approved", "approvals.resolve: status persisted");
    assert(store.updated[0].payload.resolved_by === "u1", "approvals.resolve: resolved_by=caller");
    assert(typeof store.updated[0].payload.resolved_at === "string", "approvals.resolve: resolved_at set");

    // Cross-circle
    store.clear();
    const r2 = await approvalsResolve({ approvalId: "a_other", status: "approved" }, ctx);
    assert(!r2.ok && /not found in this circle/.test((r2 as any).error), "approvals.resolve: cross-circle blocked");
    assert(store.updated.length === 0, "approvals.resolve: no update on cross-circle reject");

    // Already resolved
    const r3 = await approvalsResolve({ approvalId: "a_done", status: "rejected" }, ctx);
    assert(!r3.ok && /already approved/.test((r3 as any).error), "approvals.resolve: already-resolved rejected");

    // Invalid status
    const r4 = await approvalsResolve({ approvalId: "a_pending", status: "maybe" }, ctx);
    assert(!r4.ok && /'approved' or 'rejected'/.test((r4 as any).error), "approvals.resolve: invalid status rejected");

    // Missing id
    const r5 = await approvalsResolve({ status: "approved" }, ctx);
    assert(!r5.ok, "approvals.resolve: missing id rejected");
  }

  // ─── credentials.get (client dispatcher) ─────────────────────
  {
    const calls: Array<any> = [];
    const happyGet = async (opts: any) => { calls.push(opts); return { ok: true, fields: { username: "u", password: "p" } }; };

    const r1 = await dispatchCredentialsGet(happyGet, { item: "WordPress", vault: "Prod", fields: ["username", "password"] });
    assert(r1.ok, "credentials.get: happy path ok");
    assert((r1.data as any).vault === "Prod", "credentials.get: vault passthrough");
    assert((r1.data as any).fields.username === "u", "credentials.get: fields returned");
    assert(calls[0].fields[0] === "username", "credentials.get: fields array passed through");

    // Missing item
    const r2 = await dispatchCredentialsGet(happyGet, {});
    assert(!r2.ok && /item required/.test(r2.error!), "credentials.get: missing item rejected");

    // Non-string fields filtered out
    const r3 = await dispatchCredentialsGet(happyGet, { item: "x", fields: ["ok", "", 42, null, "also"] });
    assert(r3.ok, "credentials.get: mixed fields still ok");
    const passed = calls.at(-1)!.fields;
    assert(passed.includes("ok") && passed.includes("also") && !passed.includes(""), "credentials.get: empty/junk fields filtered");

    // Bridge offline
    const deadGet = async () => ({ ok: false, error: "Bridge not running", fields: {} });
    const r4 = await dispatchCredentialsGet(deadGet, { item: "x" });
    assert(!r4.ok && /Bridge not running/.test(r4.error!), "credentials.get: bridge offline surfaces error");

    // Thrown error
    const throwGet = async () => { throw new Error("op CLI missing"); };
    const r5 = await dispatchCredentialsGet(throwGet, { item: "x" });
    assert(!r5.ok && /op CLI missing/.test(r5.error!), "credentials.get: throw surfaced as error");
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot-v2-approvals smoke-test failure(s)`);
    process.exit(1);
  }
  console.log("\nAll swanbot-v2-approvals smoke cases passed.");
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
