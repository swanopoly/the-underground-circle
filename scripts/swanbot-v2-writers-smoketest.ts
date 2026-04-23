/**
 * swanbot-v2-writers-smoketest — verifies the M3b writer handlers in
 * supabase/functions/swanbot-v2-ai/index.ts. We can't import the Deno
 * file directly (it uses esm.sh + Deno.serve), so we rebuild the
 * handler logic under test against a stub Supabase client. The goal is
 * to pin down:
 *   - Input validation (title/content/missing ids)
 *   - Status normalisation for tasks.update_status
 *   - Cross-circle scope guards (task/mission/room must belong to the
 *     caller's circle before the update lands)
 *   - Error shape contract ({ ok: false, error } vs { ok: true, data })
 *
 * Run: npm run smoke:swanbot-v2-writers
 */

// ─── normalizeTaskStatus — mirror of the helper in index.ts ─────────
function normalizeTaskStatus(status?: string | null): string | null {
  if (!status) return null;
  const n = String(status).trim().toLowerCase();
  if (!n) return null;
  if (["open", "active"].includes(n)) return "todo";
  if (["in progress", "in-progress", "doing"].includes(n)) return "in_progress";
  if (["peer review", "peer-review"].includes(n)) return "peer_review";
  if (["todo", "in_progress", "peer_review", "review", "approved", "done"].includes(n)) return n;
  return null;
}

// ─── Stub Supabase client ───────────────────────────────────────────
// Mimics the narrow surface the writer handlers call: from(table).insert/.update/.select/.eq/.maybeSingle. Captures inserts/updates so the test
// can assert shape + scope guards.

type Row = Record<string, any>;
type TableName = "memory_entries" | "tasks" | "circle_missions" | "mission_tasks" | "messages" | "project_rooms" | "room_messages";

class StubBuilder {
  private op: "insert" | "update" | "select" = "select";
  private payload: any = null;
  private filters: Array<{ col: string; val: any }> = [];
  constructor(
    private store: StubStore,
    private table: TableName,
    private mode: "read" | "write",
  ) {}
  insert(payload: any) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: any) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  select(_cols?: string) {
    // For .select() chains after .insert()/.update() / as a read.
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push({ col, val });
    return this;
  }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true, true); }

  // Make the builder awaitable directly — mirrors supabase-js thenable
  // behaviour for updates like `await supabase.from(...).update(...).eq(...)`.
  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: (value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2> {
    return this.execute(false).then(onfulfilled, onrejected);
  }

  private async execute(_single = false, allowEmpty = false): Promise<{ data: any; error: any }> {
    if (this.op === "insert") {
      const rowId = `id_${Math.random().toString(36).slice(2, 10)}`;
      const row = { id: rowId, ...this.payload };
      this.store.inserted.push({ table: this.table, row });
      return { data: row, error: null };
    }
    if (this.op === "update") {
      const row = this.store.findBy(this.table, this.filters);
      this.store.updated.push({ table: this.table, filters: this.filters, payload: this.payload });
      return { data: row, error: null };
    }
    // read path
    const row = this.store.findBy(this.table, this.filters);
    if (!row && allowEmpty) return { data: null, error: null };
    return { data: row, error: null };
  }
}

class StubStore {
  rows: Partial<Record<TableName, Row[]>> = {};
  inserted: Array<{ table: TableName; row: any }> = [];
  updated: Array<{ table: TableName; filters: any[]; payload: any }> = [];
  seed(table: TableName, rows: Row[]) {
    this.rows[table] = rows;
  }
  findBy(table: TableName, filters: Array<{ col: string; val: any }>): Row | null {
    const rows = this.rows[table] || [];
    for (const r of rows) {
      if (filters.every((f) => r[f.col] === f.val)) return r;
    }
    return null;
  }
  clear() { this.inserted = []; this.updated = []; }
}

function makeStubClient(store: StubStore) {
  return {
    from: (table: TableName) => new StubBuilder(store, table, "read"),
  } as any;
}

// ─── Writer handler shims (reproduce the edge fn logic) ─────────────
// Keep these in lockstep with supabase/functions/swanbot-v2-ai/index.ts.

type Ctx = { supabase: any; circleId: string; userId: string };
type Result = { ok: true; data: any } | { ok: false; error: string };

async function saveMemory(input: any, ctx: Ctx): Promise<Result> {
  const title = String(input?.title || "").trim().slice(0, 120);
  const content = String(input?.content || "").trim().slice(0, 4000);
  if (!title || !content) return { ok: false, error: "title and content required" };
  const allowedKinds = ["fact", "instruction", "preference", "decision", "finding", "context"];
  const kind = allowedKinds.includes(input?.kind || "") ? input.kind : "fact";
  const importance = kind === "instruction" ? 0.9 : kind === "decision" ? 0.8 : 0.6;
  const { data, error } = await ctx.supabase
    .from("memory_entries")
    .insert({
      scope: "circle",
      circle_id: ctx.circleId,
      user_id: ctx.userId,
      memory_kind: kind,
      title,
      content,
      source_surface: "main_chat",
      retrieval_mode: "on_demand",
      importance,
      visibility: "circle_shared",
      is_active: true,
      metadata: { via: "swanbot-v2-ai" },
    })
    .select("id, memory_kind, title")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id, kind: data.memory_kind, title: data.title } };
}

async function tasksCreate(input: any, ctx: Ctx): Promise<Result> {
  const title = String(input?.title || "").trim().slice(0, 200);
  if (!title) return { ok: false, error: "title required" };
  const priority = ["low", "normal", "high", "urgent"].includes(input?.priority || "") ? input.priority : "normal";
  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      circle_id: ctx.circleId,
      title,
      description: input?.description ? String(input.description).slice(0, 4000) : null,
      priority,
      assigned_to: input?.assigneeId || null,
      created_by: ctx.userId,
      status: "todo",
    })
    .select("id, title, status, priority, assigned_to")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function tasksUpdateStatus(input: any, ctx: Ctx): Promise<Result> {
  const taskId = String(input?.taskId || "").trim();
  if (!taskId) return { ok: false, error: "taskId required" };
  const normalized = normalizeTaskStatus(input?.status);
  if (!normalized) return { ok: false, error: "invalid status" };
  const { data: row, error: rowErr } = await ctx.supabase
    .from("tasks")
    .select("id, circle_id")
    .eq("id", taskId)
    .maybeSingle();
  if (rowErr) return { ok: false, error: rowErr.message };
  if (!row || row.circle_id !== ctx.circleId) return { ok: false, error: "task not found in this circle" };
  const update: Record<string, unknown> = { status: normalized, updated_at: new Date().toISOString() };
  if (normalized === "done") update.completed_at = new Date().toISOString();
  const { error } = await ctx.supabase.from("tasks").update(update).eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { taskId, status: normalized } };
}

async function missionsCreateTask(input: any, ctx: Ctx): Promise<Result> {
  const missionId = String(input?.missionId || "").trim();
  const title = String(input?.title || "").trim().slice(0, 200);
  if (!missionId || !title) return { ok: false, error: "missionId and title required" };
  const { data: mission, error: missionErr } = await ctx.supabase
    .from("circle_missions")
    .select("id, circle_id")
    .eq("id", missionId)
    .maybeSingle();
  if (missionErr) return { ok: false, error: missionErr.message };
  if (!mission || mission.circle_id !== ctx.circleId) return { ok: false, error: "mission not found in this circle" };
  const { data, error } = await ctx.supabase
    .from("mission_tasks")
    .insert({
      mission_id: missionId,
      title,
      description: input?.description ? String(input.description).slice(0, 4000) : null,
      assignee_id: input?.assigneeId || null,
    })
    .select("id, title, status")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

async function roomsSendMessage(input: any, ctx: Ctx): Promise<Result> {
  const roomId = String(input?.roomId || "").trim();
  const content = String(input?.content || "").trim().slice(0, 4000);
  if (!roomId || !content) return { ok: false, error: "roomId and content required" };
  const messageType = ["chat", "agent_output", "edit_event", "system", "playground"].includes(input?.messageType || "")
    ? input.messageType
    : "chat";
  const { data: room, error: roomErr } = await ctx.supabase
    .from("project_rooms")
    .select("id, circle_id")
    .eq("id", roomId)
    .maybeSingle();
  if (roomErr) return { ok: false, error: roomErr.message };
  if (!room || room.circle_id !== ctx.circleId) return { ok: false, error: "room not found in this circle" };
  const { data, error } = await ctx.supabase
    .from("room_messages")
    .insert({
      room_id: roomId,
      user_id: ctx.userId,
      content,
      message_type: messageType,
      metadata: { via: "swanbot-v2-ai" },
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id, roomId, messageType } };
}

// ─── Test runner ───────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error("FAIL:", m); }
function pass(m: string) { console.log("pass:", m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const ctx: Ctx = { supabase: null, circleId: "circle_A", userId: "user_1" };

  // ─── normalizeTaskStatus ───────────────────────────────────────
  assert(normalizeTaskStatus("in progress") === "in_progress", "normalize: 'in progress'");
  assert(normalizeTaskStatus("In-Progress") === "in_progress", "normalize: 'In-Progress' case-insensitive");
  assert(normalizeTaskStatus("open") === "todo", "normalize: 'open' → todo");
  assert(normalizeTaskStatus("Done") === "done", "normalize: 'Done' → done");
  assert(normalizeTaskStatus("todo") === "todo", "normalize: canonical passthrough");
  assert(normalizeTaskStatus("bogus") === null, "normalize: unknown rejected");
  assert(normalizeTaskStatus("") === null, "normalize: empty rejected");
  assert(normalizeTaskStatus(undefined) === null, "normalize: undefined rejected");

  // ─── save_memory ──────────────────────────────────────────────
  {
    const store = new StubStore();
    ctx.supabase = makeStubClient(store);
    const r = await saveMemory({ title: "Deploy Tue", content: "Deploy every Tuesday.", kind: "instruction" }, ctx);
    assert(r.ok, "save_memory: happy path ok");
    assert(store.inserted.length === 1 && store.inserted[0].table === "memory_entries", "save_memory: inserts into memory_entries");
    const row = store.inserted[0].row;
    assert(row.scope === "circle", "save_memory: scope=circle");
    assert(row.circle_id === "circle_A", "save_memory: circle_id scoped");
    assert(row.memory_kind === "instruction", "save_memory: kind preserved");
    assert(row.importance === 0.9, "save_memory: instruction importance 0.9");
    assert(row.visibility === "circle_shared", "save_memory: visibility=circle_shared");

    // Validation
    store.clear();
    const r2 = await saveMemory({ title: "", content: "hi" }, ctx);
    assert(!r2.ok && /title and content required/.test((r2 as any).error), "save_memory: empty title rejected");
    const r3 = await saveMemory({ title: "t", content: "" }, ctx);
    assert(!r3.ok, "save_memory: empty content rejected");
    assert(store.inserted.length === 0, "save_memory: no insert on validation failure");

    // Unknown kind → defaults to 'fact'
    const r4 = await saveMemory({ title: "t", content: "c", kind: "evil" }, ctx);
    assert(r4.ok, "save_memory: unknown kind still ok");
    const row4 = store.inserted.at(-1)!.row;
    assert(row4.memory_kind === "fact", "save_memory: unknown kind coerced to fact");
    assert(row4.importance === 0.6, "save_memory: fact importance 0.6");
  }

  // ─── tasks.create ─────────────────────────────────────────────
  {
    const store = new StubStore();
    ctx.supabase = makeStubClient(store);
    const r = await tasksCreate({ title: "Ship v2", priority: "high" }, ctx);
    assert(r.ok, "tasks.create: happy path ok");
    const row = store.inserted[0].row;
    assert(row.circle_id === "circle_A", "tasks.create: circle-scoped");
    assert(row.priority === "high", "tasks.create: priority preserved");
    assert(row.status === "todo", "tasks.create: defaults to todo");
    assert(row.created_by === "user_1", "tasks.create: created_by=caller");

    // Bogus priority → defaults to 'normal'
    store.clear();
    const r2 = await tasksCreate({ title: "x", priority: "CRITICAL" }, ctx);
    assert(r2.ok, "tasks.create: bogus priority still ok");
    assert(store.inserted[0].row.priority === "normal", "tasks.create: bogus priority → normal");

    // Missing title
    const r3 = await tasksCreate({}, ctx);
    assert(!r3.ok && /title required/.test((r3 as any).error), "tasks.create: missing title rejected");
  }

  // ─── tasks.update_status ──────────────────────────────────────
  {
    const store = new StubStore();
    store.seed("tasks", [{ id: "task_mine", circle_id: "circle_A" }, { id: "task_theirs", circle_id: "circle_B" }]);
    ctx.supabase = makeStubClient(store);

    const r = await tasksUpdateStatus({ taskId: "task_mine", status: "in progress" }, ctx);
    assert(r.ok, "tasks.update_status: own task ok");
    assert(store.updated.length === 1, "tasks.update_status: update fired");
    assert(store.updated[0].payload.status === "in_progress", "tasks.update_status: normalised status persisted");

    // Cross-circle task — MUST be rejected even if the id is valid.
    store.clear();
    const r2 = await tasksUpdateStatus({ taskId: "task_theirs", status: "done" }, ctx);
    assert(!r2.ok && /not found in this circle/.test((r2 as any).error), "tasks.update_status: cross-circle blocked");
    assert(store.updated.length === 0, "tasks.update_status: no update on cross-circle reject");

    // Unknown task
    const r3 = await tasksUpdateStatus({ taskId: "ghost", status: "done" }, ctx);
    assert(!r3.ok, "tasks.update_status: unknown task rejected");

    // Invalid status
    const r4 = await tasksUpdateStatus({ taskId: "task_mine", status: "zzzz" }, ctx);
    assert(!r4.ok && /invalid status/.test((r4 as any).error), "tasks.update_status: invalid status rejected");

    // done → completed_at set
    store.clear();
    const r5 = await tasksUpdateStatus({ taskId: "task_mine", status: "done" }, ctx);
    assert(r5.ok, "tasks.update_status: 'done' accepted");
    assert(typeof store.updated[0].payload.completed_at === "string", "tasks.update_status: completed_at set on done");
  }

  // ─── missions.create_task ─────────────────────────────────────
  {
    const store = new StubStore();
    store.seed("circle_missions", [
      { id: "m_ok", circle_id: "circle_A" },
      { id: "m_other", circle_id: "circle_B" },
    ]);
    ctx.supabase = makeStubClient(store);

    const r = await missionsCreateTask({ missionId: "m_ok", title: "Write tests" }, ctx);
    assert(r.ok, "missions.create_task: own mission ok");
    assert(store.inserted.length === 1 && store.inserted[0].table === "mission_tasks", "missions.create_task: inserts into mission_tasks");
    assert(store.inserted[0].row.mission_id === "m_ok", "missions.create_task: mission_id scoped");

    // Cross-circle — blocked
    store.clear();
    const r2 = await missionsCreateTask({ missionId: "m_other", title: "sneak" }, ctx);
    assert(!r2.ok && /not found in this circle/.test((r2 as any).error), "missions.create_task: cross-circle blocked");
    assert(store.inserted.length === 0, "missions.create_task: no insert on cross-circle");

    const r3 = await missionsCreateTask({ missionId: "", title: "x" }, ctx);
    assert(!r3.ok, "missions.create_task: missing missionId rejected");
  }

  // ─── rooms.send_message ───────────────────────────────────────
  {
    const store = new StubStore();
    store.seed("project_rooms", [
      { id: "room_mine", circle_id: "circle_A" },
      { id: "room_theirs", circle_id: "circle_B" },
    ]);
    ctx.supabase = makeStubClient(store);

    const r = await roomsSendMessage({ roomId: "room_mine", content: "hi" }, ctx);
    assert(r.ok, "rooms.send_message: own room ok");
    assert(store.inserted[0].row.message_type === "chat", "rooms.send_message: default messageType=chat");
    assert(store.inserted[0].row.user_id === "user_1", "rooms.send_message: user_id=caller");

    // Cross-circle
    store.clear();
    const r2 = await roomsSendMessage({ roomId: "room_theirs", content: "inject" }, ctx);
    assert(!r2.ok && /not found in this circle/.test((r2 as any).error), "rooms.send_message: cross-circle blocked");
    assert(store.inserted.length === 0, "rooms.send_message: no insert on cross-circle");

    // Bogus messageType → defaults to chat
    const r3 = await roomsSendMessage({ roomId: "room_mine", content: "x", messageType: "evil" }, ctx);
    assert(r3.ok && store.inserted.at(-1)!.row.message_type === "chat", "rooms.send_message: bogus type → chat");

    // Long content trimmed
    const longContent = "A".repeat(6000);
    const r4 = await roomsSendMessage({ roomId: "room_mine", content: longContent }, ctx);
    assert(r4.ok, "rooms.send_message: long content accepted");
    assert(store.inserted.at(-1)!.row.content.length === 4000, "rooms.send_message: content capped at 4000 chars");
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot-v2-writers smoke-test failure(s)`);
    process.exit(1);
  }
  console.log("\nAll swanbot-v2-writers smoke cases passed.");
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
