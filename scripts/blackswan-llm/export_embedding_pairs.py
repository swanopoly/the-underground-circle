#!/usr/bin/env python3
"""
BlackSwan LLM — Embedding-pair export (Composer-pattern flywheel, phase 1 of
the semsearch recipe).

Cursor's verified semantic-search recipe: "trained our own embedding model …
on agent traces with LLM-ranked relevance" (docs/BLACKSWAN_COMPOSER_PATTERN.md,
roadmap item 3). This script is OUR phase 1: export (query, memory, relevance)
pairs from real usage so a future embedding fine-tune learns what our agents
actually found relevant — not what a generic embedding thinks is relevant.

Where the pairs really live (verified against the app source, 2026-07):

  A. `messages` (main chat) — there is NO metadata column. Bot rows embed the
     persisted metadata JSON inside `content` after the `[[UC_CHAT_META]]`
     marker (src/lib/persistedChatMetadata.ts:1274, BOT_META_MARKER at :21,
     written via src/lib/chatAgentService.ts persistMainChatBotMessageWithRetry
     -> src/lib/chatService.ts persistChatMessage). That JSON carries
     `memoryRefs` (PromptMemoryReference: title/score/confidence/scope/
     memoryKind — survives every persistence tier: slice(0,8) compact at :972,
     slice(0,4) minimal at :1109) and `memoriesUsed` (titles only).
     Query = nearest preceding non-bot message in the same circle/thread.

  B. `room_messages.metadata` (rooms) — a REAL jsonb column
     (supabase/migrations/20260227_room_messages.sql:12). Agent rows carry
     `memory_references` (full refs) + `memories_used` via
     buildRoomAgentMessageMetadata (src/lib/roomMessageMetadata.ts:59-60,
     written in src/lib/roomChatService.ts:210-223).
     Query = nearest preceding user chat row in the same room, falling back
     to agent_runs.goal via metadata.run_id.

  C. `memory_access_log` — a true retrieval log (migration
     20260408_memory_v2_retrieval_privacy.sql:150): memory_id, run_id,
     user_id, surface, reason('startup'|'retrieval'|...). Written by
     retrieveForTurn (src/lib/memoryService.ts:1046) and logMemoryAccess
     (:3290). KNOWN GAP: no production caller passes `runId` into
     retrieveForTurn (src/lib/swanbot.ts:2357 and ChatTab.tsx:4330 both omit
     it), so run_id is NULL in practice and the row can't be joined back to
     the triggering query (agent_runs.goal). No score column either. We still
     export whatever run_id-bearing rows exist and report the gap loudly.

  D. `memory_entries` self-pairs — (content -> title) contrastive
     pretraining fallback so the export is never empty. memory_entries also
     holds the pgvector embeddings themselves (vector(1536),
     migration 20260417_memory_embeddings.sql; match_memories RPC returns
     cosine similarity, which is the base of PromptMemoryReference.score —
     src/lib/memoryService.ts:995).

Not exportable: OpenSwan transcripts are device-local storage only
(src/lib/openswanTranscripts.ts, key prefix `uc_openswan_transcript_v1:`) and
nothing stamps memoryRefs/memoriesUsed onto agent_runs.metadata.

Output: raw_data/embedding_pairs.jsonl, one pair per line:
  {"query": <trigger text, clamped 500>, "memory_title": ..., "memory_kind": ...,
   "scope": ..., "score": <retrieval score|null>, "confidence": ...,
   "source": "<table/path>", "created_at": ...}

Usage:
  export SUPABASE_URL=https://your-project.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...
  python export_embedding_pairs.py [--output PATH] [--max-rows N]
                                   [--self-pairs auto|always|never]

Privacy: same posture as export_tool_traces.py — PII/secret patterns scrubbed
before write; queries clamped to 500 chars; identical (query, title) pairs
deduped; hard row cap.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OUTPUT_DIR = Path(__file__).parent / "raw_data"
DEFAULT_OUTPUT = OUTPUT_DIR / "embedding_pairs.jsonl"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# Marker constant mirrored from src/lib/persistedChatMetadata.ts:21
# (BOT_META_MARKER = '\n[[UC_CHAT_META]]').
META_MARKER = "[[UC_CHAT_META]]"
# Bot-authored rows render as "🦢 **Name:** ..." / "🤖 **Name:** ..." with the
# legacy crown prefix "👑 **OpenSwan:** " (persistedChatMetadata.ts:19-20).
BOT_PREFIX_RE = re.compile(r"^(?:🦢|🤖|👑)\s?\*\*[^*]{1,80}:\*\*\s?")

MAX_QUERY_CHARS = 500
MAX_TITLE_CHARS = 300

MAX_ROWS_DEFAULT = int(os.environ.get("EMBED_PAIRS_MAX_ROWS", "100000"))
MAX_BOT_MESSAGES = int(os.environ.get("EMBED_PAIRS_MAX_BOT_MESSAGES", "20000"))
MAX_CONTEXT_MESSAGES = int(os.environ.get("EMBED_PAIRS_MAX_CONTEXT_MESSAGES", "100000"))
MAX_ROOM_MESSAGES = int(os.environ.get("EMBED_PAIRS_MAX_ROOM_MESSAGES", "40000"))
MAX_ACCESS_ROWS = int(os.environ.get("EMBED_PAIRS_MAX_ACCESS_ROWS", "50000"))
MAX_MEMORY_ROWS = int(os.environ.get("EMBED_PAIRS_MAX_MEMORY_ROWS", "20000"))
# How far back (rows) to scan for the triggering user turn in a thread.
PAIRING_LOOKBACK = 40
# --self-pairs auto: only add memory_entries self-pairs when real usage pairs
# are this scarce.
SELF_PAIR_AUTO_THRESHOLD = 500

# Mirrors the anonymization posture of export_tool_traces.py: emails, phones,
# bearer/API tokens, long hex/base64 blobs, JWTs, wallet-looking strings.
PII_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}", re.I), "Bearer <token>"),
    (re.compile(r"\beyJ[A-Za-z0-9._-]{20,}"), "<jwt>"),
    (re.compile(r"\b(sk|pk|rk|hf|ghp|gho|xox[bpas])[-_][A-Za-z0-9]{16,}", re.I), "<api_key>"),
    (re.compile(r"\b[A-Fa-f0-9]{32,}\b"), "<hex>"),
    (re.compile(r"\b(?:\+?\d[\d\s().-]{8,}\d)\b"), "<phone>"),
]


class ExportError(RuntimeError):
    pass


def scrub_text(value, max_chars):
    """Scrub PII/secret-looking strings from text; clamp length."""
    if not isinstance(value, str):
        return ""
    out = value
    for pattern, repl in PII_PATTERNS:
        out = pattern.sub(repl, out)
    out = out.strip()
    if len(out) > max_chars:
        out = out[:max_chars] + "…"
    return out


def fetch_table(table_name, select="*", order=None, limit=50000, filters=None):
    """Paginated fetch from Supabase REST API (mirrors export_tool_traces)."""
    all_rows = []
    offset = 0
    page_size = 1000

    while len(all_rows) < limit:
        url = f"{SUPABASE_URL}/rest/v1/{table_name}"
        params = {"select": select, "limit": page_size, "offset": offset}
        if order:
            params["order"] = order
        if filters:
            params.update(filters)

        try:
            resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
        except requests.RequestException as exc:
            raise ExportError(f"{table_name} request failed: {exc}") from exc
        if resp.status_code != 200:
            raise ExportError(f"{table_name} returned {resp.status_code}: {resp.text[:300]}")

        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    return all_rows


def fetch_by_ids(table_name, ids, select):
    """Chunked `id=in.(...)` fetch so join lookups stay under URL limits."""
    rows = []
    ids = [i for i in dict.fromkeys(ids) if i]
    for start in range(0, len(ids), 100):
        chunk = ids[start:start + 100]
        rows.extend(fetch_table(
            table_name,
            select=select,
            limit=len(chunk),
            filters={"id": f"in.({','.join(chunk)})"},
        ))
    return rows


# ── Pair assembly ────────────────────────────────────────────────────────────

def make_pair(query, title, kind, scope, score, confidence, source, created_at):
    query = scrub_text(query, MAX_QUERY_CHARS)
    title = scrub_text(title, MAX_TITLE_CHARS)
    if not query or not title:
        return None
    return {
        "query": query,
        "memory_title": title,
        "memory_kind": kind if isinstance(kind, str) and kind else None,
        "scope": scope if isinstance(scope, str) and scope else None,
        "score": score if isinstance(score, (int, float)) else None,
        "confidence": confidence if isinstance(confidence, (int, float)) else None,
        "source": source,
        "created_at": created_at,
    }


def ref_fields(ref):
    """Tolerate camelCase (TS PromptMemoryReference) and snake_case keys."""
    if not isinstance(ref, dict):
        return None
    title = ref.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    return {
        "title": title,
        "kind": ref.get("memoryKind") or ref.get("memory_kind"),
        "scope": ref.get("scope"),
        "score": ref.get("score"),
        "confidence": ref.get("confidence"),
    }


def parse_uc_chat_meta(content):
    """Pull the [[UC_CHAT_META]] JSON suffix out of a messages.content value."""
    if not isinstance(content, str):
        return None
    idx = content.find(META_MARKER)
    if idx < 0:
        return None
    raw = content[idx + len(META_MARKER):].strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def visible_text(content):
    """Message text with any bot prefix and metadata suffix stripped."""
    if not isinstance(content, str):
        return ""
    idx = content.find(META_MARKER)
    body = content[:idx] if idx >= 0 else content
    return BOT_PREFIX_RE.sub("", body).strip()


def find_preceding_query(rows, index, is_query_row):
    """Nearest earlier row in the same ordered group that reads as a user turn."""
    lo = max(0, index - PAIRING_LOOKBACK)
    for j in range(index - 1, lo - 1, -1):
        row = rows[j]
        if is_query_row(row):
            text = visible_text(row.get("content"))
            if text:
                return text
    return None


# ── Source A: main chat `messages` (metadata embedded in content) ────────────

def export_main_chat_pairs():
    like_filter = {"content": f"like.*{META_MARKER}*"}
    select_with_flag = "id,circle_id,thread_id,content,created_at,is_bot"
    select_fallback = "id,circle_id,thread_id,content,created_at"

    print(f"[messages] fetching bot rows carrying {META_MARKER} (limit {MAX_BOT_MESSAGES})…")
    try:
        try:
            bot_rows = fetch_table(
                "messages", select=select_with_flag, order="created_at.desc",
                limit=MAX_BOT_MESSAGES, filters=like_filter,
            )
            has_is_bot = True
        except ExportError:
            # Pre-migration schema without is_bot (chatService has the same fallback).
            bot_rows = fetch_table(
                "messages", select=select_fallback, order="created_at.desc",
                limit=MAX_BOT_MESSAGES, filters=like_filter,
            )
            has_is_bot = False
    except ExportError as exc:
        print(f"[messages] SKIPPED — {exc}", file=sys.stderr)
        return []

    bot_rows = [r for r in bot_rows if parse_uc_chat_meta(r.get("content"))]
    print(f"  {len(bot_rows)} bot rows with parseable metadata")
    if not bot_rows:
        return []

    circle_ids = sorted({r.get("circle_id") for r in bot_rows if r.get("circle_id")})
    print(f"[messages] fetching context rows for {len(circle_ids)} circles (limit {MAX_CONTEXT_MESSAGES})…")
    context_rows = []
    try:
        for start in range(0, len(circle_ids), 40):
            chunk = circle_ids[start:start + 40]
            remaining = MAX_CONTEXT_MESSAGES - len(context_rows)
            if remaining <= 0:
                break
            context_rows.extend(fetch_table(
                "messages",
                select=select_with_flag if has_is_bot else select_fallback,
                order="created_at.desc",
                limit=remaining,
                filters={"circle_id": f"in.({','.join(chunk)})"},
            ))
    except ExportError as exc:
        print(f"[messages] context fetch degraded — {exc}", file=sys.stderr)
    print(f"  {len(context_rows)} context rows")

    # Group by (circle, thread) and order ascending so "the turn before the
    # bot reply" is a backward scan.
    groups = {}
    seen_ids = set()
    for row in context_rows:
        if row.get("id") in seen_ids:
            continue
        seen_ids.add(row.get("id"))
        key = (row.get("circle_id"), row.get("thread_id") or "__main__")
        groups.setdefault(key, []).append(row)
    for rows in groups.values():
        rows.sort(key=lambda r: r.get("created_at") or "")

    def is_user_turn(row):
        if row.get("is_bot") is True:
            return False
        content = row.get("content") or ""
        if META_MARKER in content:
            return False
        if BOT_PREFIX_RE.match(content):
            return False
        return True

    pairs = []
    for key, rows in groups.items():
        for index, row in enumerate(rows):
            meta = parse_uc_chat_meta(row.get("content"))
            if not meta:
                continue
            refs = meta.get("memoryRefs") if isinstance(meta.get("memoryRefs"), list) else []
            used = meta.get("memoriesUsed") if isinstance(meta.get("memoriesUsed"), list) else []
            if not refs and not used:
                continue
            query = find_preceding_query(rows, index, is_user_turn)
            if not query:
                continue
            created_at = row.get("created_at")
            for ref in refs:
                fields = ref_fields(ref)
                if not fields:
                    continue
                pairs.append(make_pair(
                    query, fields["title"], fields["kind"], fields["scope"],
                    fields["score"], fields["confidence"],
                    "messages.uc_chat_meta.memoryRefs", created_at,
                ))
            ref_titles = {str(ref.get("title", "")).strip().lower() for ref in refs if isinstance(ref, dict)}
            for title in used:
                if not isinstance(title, str) or title.strip().lower() in ref_titles:
                    continue
                pairs.append(make_pair(
                    query, title, None, None, None, None,
                    "messages.uc_chat_meta.memoriesUsed", created_at,
                ))

    pairs = [p for p in pairs if p]
    print(f"  {len(pairs)} raw pairs from main chat")
    return pairs


# ── Source B: room_messages.metadata (real jsonb column) ─────────────────────

def export_room_pairs(run_goals):
    print(f"[room_messages] fetching rows (limit {MAX_ROOM_MESSAGES})…")
    try:
        rows = fetch_table(
            "room_messages",
            select="id,room_id,user_id,agent_name,content,message_type,metadata,created_at",
            order="created_at.desc",
            limit=MAX_ROOM_MESSAGES,
        )
    except ExportError as exc:
        print(f"[room_messages] SKIPPED — {exc}", file=sys.stderr)
        return [], set()

    groups = {}
    for row in rows:
        groups.setdefault(row.get("room_id"), []).append(row)
    for group in groups.values():
        group.sort(key=lambda r: r.get("created_at") or "")

    def row_meta(row):
        meta = row.get("metadata")
        return meta if isinstance(meta, dict) else {}

    def is_agent_row(row):
        return row_meta(row).get("bot") is True or row.get("message_type") == "agent_output"

    def is_user_turn(row):
        return (not is_agent_row(row)) and row.get("message_type") in (None, "chat")

    pairs = []
    wanted_run_ids = set()
    for group in groups.values():
        for index, row in enumerate(group):
            if not is_agent_row(row):
                continue
            meta = row_meta(row)
            refs = meta.get("memory_references") if isinstance(meta.get("memory_references"), list) else []
            used = meta.get("memories_used") if isinstance(meta.get("memories_used"), list) else []
            if not refs and not used:
                continue
            query = find_preceding_query(group, index, is_user_turn)
            run_id = meta.get("run_id")
            if not query and isinstance(run_id, str) and run_id:
                query = run_goals.get(run_id)
                if query is None:
                    wanted_run_ids.add(run_id)
                    continue
            if not query:
                continue
            created_at = row.get("created_at")
            for ref in refs:
                fields = ref_fields(ref)
                if not fields:
                    continue
                pairs.append(make_pair(
                    query, fields["title"], fields["kind"], fields["scope"],
                    fields["score"], fields["confidence"],
                    "room_messages.metadata.memory_references", created_at,
                ))
            ref_titles = {str(ref.get("title", "")).strip().lower() for ref in refs if isinstance(ref, dict)}
            for title in used:
                if not isinstance(title, str) or title.strip().lower() in ref_titles:
                    continue
                pairs.append(make_pair(
                    query, title, None, None, None, None,
                    "room_messages.metadata.memories_used", created_at,
                ))

    pairs = [p for p in pairs if p]
    print(f"  {len(pairs)} raw pairs from rooms ({len(wanted_run_ids)} deferred on agent_runs.goal)")
    return pairs, wanted_run_ids


# ── Source C: memory_access_log joined to memory_entries + agent_runs ────────

def export_access_log_pairs(run_goals):
    print(f"[memory_access_log] fetching retrieval/search rows (limit {MAX_ACCESS_ROWS})…")
    try:
        rows = fetch_table(
            "memory_access_log",
            select="memory_id,run_id,surface,reason,created_at",
            order="created_at.desc",
            limit=MAX_ACCESS_ROWS,
            filters={"reason": "in.(retrieval,search)"},
        )
    except ExportError as exc:
        print(f"[memory_access_log] SKIPPED — {exc}", file=sys.stderr)
        return [], {"total": 0, "with_run_id": 0}

    with_run = [r for r in rows if r.get("run_id")]
    stats = {"total": len(rows), "with_run_id": len(with_run)}
    print(f"  {stats['total']} rows, {stats['with_run_id']} carry run_id (joinable to a query)")
    if not with_run:
        return [], stats

    memory_ids = [r.get("memory_id") for r in with_run]
    run_ids = [r.get("run_id") for r in with_run if r.get("run_id") not in run_goals]
    try:
        memories = fetch_by_ids(
            "memory_entries", memory_ids,
            select="id,title,memory_kind,scope,confidence",
        )
        mem_by_id = {m.get("id"): m for m in memories}
        for run in fetch_by_ids("agent_runs", run_ids, select="id,goal,title"):
            run_goals[run.get("id")] = run.get("goal") or run.get("title") or ""
    except ExportError as exc:
        print(f"[memory_access_log] join fetch failed — {exc}", file=sys.stderr)
        return [], stats

    pairs = []
    for row in with_run:
        memory = mem_by_id.get(row.get("memory_id"))
        query = run_goals.get(row.get("run_id"))
        if not memory or not query:
            continue
        pairs.append(make_pair(
            query, memory.get("title"), memory.get("memory_kind"), memory.get("scope"),
            None, memory.get("confidence"),
            "memory_access_log+agent_runs.goal", row.get("created_at"),
        ))

    pairs = [p for p in pairs if p]
    print(f"  {len(pairs)} pairs from the access log")
    return pairs, stats


# ── Source D: memory_entries (content -> title) self-pairs ───────────────────

def export_self_pairs():
    print(f"[memory_entries] fetching active memories for self-pairs (limit {MAX_MEMORY_ROWS})…")
    try:
        rows = fetch_table(
            "memory_entries",
            select="id,title,content,memory_kind,scope,confidence,created_at",
            order="created_at.desc",
            limit=MAX_MEMORY_ROWS,
            filters={"is_active": "eq.true"},
        )
    except ExportError as exc:
        print(f"[memory_entries] SKIPPED — {exc}", file=sys.stderr)
        return []

    pairs = []
    for row in rows:
        content = row.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        pairs.append(make_pair(
            content, row.get("title"), row.get("memory_kind"), row.get("scope"),
            None, row.get("confidence"),
            "memory_entries.self_pair", row.get("created_at"),
        ))
    pairs = [p for p in pairs if p]
    print(f"  {len(pairs)} self-pairs (contrastive pretraining fallback)")
    return pairs


# ── Reporting ────────────────────────────────────────────────────────────────

def print_persistence_notes(access_stats, usage_pair_count):
    print("\n" + "=" * 74)
    print("PERSISTENCE NOTES (verified against the app source)")
    print("=" * 74)
    print(
        "* Main-chat memory refs ARE durable, but only as JSON embedded in\n"
        "  messages.content after the [[UC_CHAT_META]] marker — there is no\n"
        "  metadata column (src/lib/persistedChatMetadata.ts:1274 via\n"
        "  src/lib/chatService.ts persistChatMessage). This exporter parses it."
    )
    print(
        "* room_messages.metadata is a real jsonb column carrying\n"
        "  memory_references with scores (src/lib/roomMessageMetadata.ts:59)."
    )
    if access_stats["total"] > 0 and access_stats["with_run_id"] == 0:
        print(
            f"* NOTE / GAP: memory_access_log has {access_stats['total']} retrieval rows but ZERO\n"
            "  carry run_id, so none can be joined back to the query that triggered\n"
            "  them. The column exists and retrieveForTurn already forwards it\n"
            "  (src/lib/memoryService.ts:1041) — the one-line fix is passing\n"
            "  `runId` at the call sites: src/lib/swanbot.ts:2357 (retrieveForTurn\n"
            "  args) and ChatTab.tsx:4330. logMemoryAccess (memoryService.ts:3282)\n"
            "  never records run_id at all."
        )
    elif access_stats["total"] == 0:
        print(
            "* NOTE: memory_access_log returned no retrieval rows (table missing,\n"
            "  empty, or not exposed). The joinable-query gap described in the\n"
            "  script header still applies once rows exist."
        )
    print(
        "* agent_runs.metadata never carries memoriesUsed/memoryRefs — no writer\n"
        "  stamps them (verified across src/lib). If wanted, the natural spot is\n"
        "  the finalize metadata merge in src/lib/agentRunPersistence.ts (opts.metadata)."
    )
    print(
        "* OpenSwan transcripts are device-local only\n"
        "  (src/lib/openswanTranscripts.ts, uc_openswan_transcript_v1:*) — not a\n"
        "  DB table, so they contribute nothing to this export."
    )
    if usage_pair_count == 0:
        print(
            "\n*** LOUD NOTE: no usage-derived (query -> memory) pairs were found in\n"
            "*** this database. Either chat/rooms have no bot messages with memory\n"
            "*** refs yet, or persistence is pre-migration. The export falls back to\n"
            "*** memory_entries (content -> title) self-pairs for contrastive\n"
            "*** pretraining only — relevance labels will need the writers above."
        )
    print("=" * 74)


def main():
    parser = argparse.ArgumentParser(description="Export (query, memory, relevance) embedding-training pairs from real usage.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help=f"Output JSONL path (default {DEFAULT_OUTPUT})")
    parser.add_argument("--max-rows", type=int, default=MAX_ROWS_DEFAULT, help=f"Hard cap on exported pairs (default {MAX_ROWS_DEFAULT})")
    parser.add_argument(
        "--self-pairs", choices=("auto", "always", "never"), default="auto",
        help=f"memory_entries (content -> title) fallback pairs: auto adds them when usage pairs < {SELF_PAIR_AUTO_THRESHOLD}",
    )
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.", file=sys.stderr)
        sys.exit(1)

    run_goals = {}

    chat_pairs = export_main_chat_pairs()
    room_pairs, deferred_room_run_ids = export_room_pairs(run_goals)
    access_pairs, access_stats = export_access_log_pairs(run_goals)

    # Rooms deferred on agent_runs.goal: the access-log join may have hydrated
    # run_goals; also fetch any still-missing runs, then retry once.
    if deferred_room_run_ids:
        missing = [rid for rid in deferred_room_run_ids if rid not in run_goals]
        if missing:
            try:
                for run in fetch_by_ids("agent_runs", missing, select="id,goal,title"):
                    run_goals[run.get("id")] = run.get("goal") or run.get("title") or ""
            except ExportError as exc:
                print(f"[room_messages] agent_runs goal fetch failed — {exc}", file=sys.stderr)
        retry_pairs, _ = export_room_pairs(run_goals)
        if len(retry_pairs) > len(room_pairs):
            room_pairs = retry_pairs

    usage_pairs = chat_pairs + room_pairs + access_pairs
    self_pairs = []
    if args.self_pairs == "always" or (args.self_pairs == "auto" and len(usage_pairs) < SELF_PAIR_AUTO_THRESHOLD):
        self_pairs = export_self_pairs()

    # Dedupe identical (query, title) — richest sources were appended first,
    # so the score/confidence-bearing variant of a duplicate wins.
    deduped = []
    seen = set()
    for pair in usage_pairs + self_pairs:
        key = (pair["query"].strip().lower(), pair["memory_title"].strip().lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(pair)
        if len(deduped) >= args.max_rows:
            print(f"Hit --max-rows cap ({args.max_rows}); stopping.")
            break

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w") as fh:
        for pair in deduped:
            fh.write(json.dumps(pair, ensure_ascii=False) + "\n")

    by_source = {}
    scored = 0
    for pair in deduped:
        by_source[pair["source"]] = by_source.get(pair["source"], 0) + 1
        if pair["score"] is not None:
            scored += 1
    print(f"\nWrote {len(deduped)} pairs ({scored} with retrieval scores) → {output_path}")
    for source, count in sorted(by_source.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>7}  {source}")

    print_persistence_notes(access_stats, len(usage_pairs))


if __name__ == "__main__":
    main()
