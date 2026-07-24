#!/usr/bin/env python3
"""
Convert exported app data (raw_data/) into ShareGPT training format.

Reads Supabase exports and generates conversation pairs suitable for
BlackSwan fine-tuning.

Output: training_data/app_data.jsonl
"""

import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

RAW_DIR = Path(__file__).parent / "raw_data"
OUTPUT = Path(__file__).parent / "training_data" / "app_data.jsonl"
REPO_ROOT = Path(__file__).resolve().parents[2]

SESSION_GAP = timedelta(minutes=30)
MAX_DOC_CHARS = 5200
MIN_DOC_CHARS = 220

CHAT_META_RE = re.compile(r"\[\[UC_CHAT_META\]\].*$", re.DOTALL)
OPEN_SWAN_PREFIX_RE = re.compile(
    r"^\s*(?:🦢\s*)?(?:\*\*)?(?:OpenSwan|BlackSwan|SwanBot)(?:\*\*)?\s*:\s*",
    re.IGNORECASE,
)
THINKING_RE = re.compile(r"^\s*(?:Thinking Process|Thought Process|Reasoning)\s*:\s*", re.IGNORECASE)

LOCAL_DOC_PATHS = [
    "AGENTS.md",
    "CLAUDE.md",
    "docs/AGENTS_ROADMAP.md",
    "docs/UC_APP_STACK_REFERENCE.md",
    "docs/CODING_AGENT_BEST_PRACTICES.md",
    "docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md",
    "docs/DESIGN_AGENT_BEST_PRACTICES.md",
    "docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md",
    "docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md",
    "docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md",
    "docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md",
    "docs/SWANBOT_OPENSWAN_CHAT_BUILDOUT_2026-06-24.md",
    "docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md",
    "docs/SWANBOT_V2_MIGRATION_PLAN.md",
    "docs/OPENROUTER_INTEGRATION_RESEARCH_2026-05-06.md",
    "docs/CHAT_SWANBOT_OPENSWAN_CAPABILITY_AND_FUTURE.md",
    "docs/CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN.md",
    "docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md",
    "docs/HUMAN_PARITY_CAPABILITY_MAP.md",
    "docs/AI_FIRST_COMPUTER_INTEGRATION_PLAN.md",
    "docs/MULTI_AGENT_FILE_COORDINATION.md",
    "docs/page-audits/chat-tab.md",
    "docs/page-audits/rooms-tab.md",
    "docs/page-audits/swanbot-screen.md",
    "docs/page-audits/wiki-screen.md",
]

PRODUCT_LOGIC_PATHS = [
    "src/lib/blackswanRouting.ts",
    "src/lib/chatAutomationPlanner.ts",
    "src/lib/runChatAutomationPlan.ts",
    "src/lib/swanbot.ts",
    "src/lib/serviceProfileSouls.ts",
    "src/lib/crossProviderRouter.ts",
    "src/lib/universalInvoke.ts",
    "src/lib/agentExecutionCore.ts",
    "src/lib/openswanToolRuntime.ts",
    "src/lib/chatComputerRequestRouter.ts",
    "src/lib/computerTaskEvidenceContract.ts",
    "src/lib/appAutomationControlSurfaces.ts",
    # Named as an owner in CLAUDE.md's "Computer Use" prose (chat handoff
    # metadata + persisted-row route-decision summary) but not in the
    # "## Runtime Map" table itself, so discover_runtime_map_paths() below
    # never picks it up automatically. Listed here explicitly instead.
    "src/lib/chatComputerHandoffContext.ts",
]

# CLAUDE.md's "## Runtime Map" table (Concern | Owner) is documented as the
# canonical, actively-maintained map of "owner" files for chat/agent/computer
# systems (see docs/AGENTS_ROADMAP.md). It changes far more often than anyone
# remembers to update PRODUCT_LOGIC_PATHS above, so we parse it at each
# training cycle and union its backtick-quoted, existing source paths into
# PRODUCT_LOGIC_PATHS instead of relying solely on the hardcoded list.
RUNTIME_MAP_SECTION_HEADING = "## Runtime Map"
RUNTIME_MAP_NEXT_HEADING_RE = re.compile(r"^## ", re.MULTILINE)
RUNTIME_MAP_PATH_RE = re.compile(r"`([\w./_-]+\.(?:ts|tsx|py|sql))`")


def discover_runtime_map_paths(claude_md_path=None):
    """Parse CLAUDE.md's '## Runtime Map' table for owner file paths.

    Returns a sorted list of repo-relative paths that (a) appear
    backtick-quoted in the table and (b) actually exist on disk right now.
    Falls back to an empty list (never raises) if CLAUDE.md is missing or its
    format has drifted enough that the section can't be found — callers
    should union the result with the hardcoded PRODUCT_LOGIC_PATHS, not
    replace it, so a parsing miss degrades gracefully instead of silently
    emptying the training set.
    """
    claude_md_path = claude_md_path or (REPO_ROOT / "CLAUDE.md")
    try:
        text = claude_md_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []

    start = text.find(RUNTIME_MAP_SECTION_HEADING)
    if start == -1:
        return []
    start += len(RUNTIME_MAP_SECTION_HEADING)
    next_heading = RUNTIME_MAP_NEXT_HEADING_RE.search(text, start)
    section = text[start:next_heading.start()] if next_heading else text[start:]

    found = set()
    for match in RUNTIME_MAP_PATH_RE.findall(section):
        if (REPO_ROOT / match).exists():
            found.add(match)
    return sorted(found)


def resolved_product_logic_paths():
    """Hardcoded PRODUCT_LOGIC_PATHS unioned with CLAUDE.md's live Runtime Map."""
    return sorted(set(PRODUCT_LOGIC_PATHS) | set(discover_runtime_map_paths()))

BLACKSWAN_SYSTEM = """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

You have quiet confidence — knowledgeable but never arrogant. Direct. No fluff, no corporate speak.
You give real feedback. You genuinely care about the people here.
You know productivity, design, UI/UX, coding, architecture, and general knowledge."""


def load_json(name):
    path = RAW_DIR / f"{name}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())


def make_example(source, conversations, **meta):
    """Attach source metadata without changing the ShareGPT turn shape."""
    return {
        "conversations": conversations,
        "metadata": {
            "source": source,
            **{k: v for k, v in meta.items() if v is not None and v != ""},
        },
    }


def tag_examples(source, examples):
    tagged = []
    for ex in examples:
        copy = dict(ex)
        metadata = dict(copy.get("metadata") or {})
        metadata.setdefault("source", source)
        copy["metadata"] = metadata
        tagged.append(copy)
    return tagged


def parse_time(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def clean_chat_content(value):
    text = (value or "").replace("\x00", "").strip()
    if not text:
        return ""
    text = CHAT_META_RE.sub("", text).strip()
    text = OPEN_SWAN_PREFIX_RE.sub("", text).strip()
    text = THINKING_RE.sub("", text).strip()
    if text.lower() in {"[deleted]", "(deleted)", "deleted", "message deleted"}:
        return ""
    return text


def merge_same_role(turns, role, content):
    if not content:
        return
    if turns and turns[-1]["from"] == role:
        turns[-1]["value"] = f"{turns[-1]['value']}\n{content}"
    else:
        turns.append({"from": role, "value": content})


def valid_conversation(turns):
    return (
        len(turns) >= 3
        and any(t.get("from") == "human" for t in turns)
        and any(t.get("from") == "gpt" for t in turns)
    )


def split_sessions(rows):
    sessions = []
    current = []
    for row in rows:
        if current:
            prev_t = parse_time(current[-1].get("created_at"))
            curr_t = parse_time(row.get("created_at"))
            if prev_t and curr_t and (curr_t - prev_t) > SESSION_GAP:
                sessions.append(current)
                current = []
        current.append(row)
    if current:
        sessions.append(current)
    return sessions


def chunk_text(text, max_chars=MAX_DOC_CHARS, min_chars=MIN_DOC_CHARS):
    text = re.sub(r"\n{3,}", "\n\n", (text or "").strip())
    if len(text) <= max_chars:
        return [text] if len(text) >= min_chars else []

    chunks = []
    current = []
    current_len = 0
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if len(para) > max_chars:
            if current and current_len >= min_chars:
                chunks.append("\n\n".join(current))
            current, current_len = [], 0
            for start in range(0, len(para), max_chars):
                part = para[start:start + max_chars].strip()
                if len(part) >= min_chars:
                    chunks.append(part)
            continue
        if current and current_len + len(para) + 2 > max_chars:
            if current_len >= min_chars:
                chunks.append("\n\n".join(current))
            current, current_len = [], 0
        current.append(para)
        current_len += len(para) + 2
    if current and current_len >= min_chars:
        chunks.append("\n\n".join(current))
    return chunks


def doc_title(path, fallback="Underground Circle reference"):
    stem = path.stem.replace("-", " ").replace("_", " ").strip()
    return stem.title() if stem else fallback


def convert_terminal_pairs():
    """Convert terminal command/response pairs into training conversations."""
    cmds = load_json("office_terminal_messages")
    resps = load_json("office_terminal_responses")
    resp_by_msg = {r["message_id"]: r for r in resps}

    examples = []
    for cmd in cmds:
        resp = resp_by_msg.get(cmd["id"])
        if not resp or not resp.get("response_text"):
            continue
        command = (cmd.get("command_text") or "").strip()
        response = (resp.get("response_text") or "").strip()
        if not command or not response or len(response) < 20:
            continue
        # Clean the swan emoji prefix
        response = response.replace("🦢 **", "").replace("**", "")
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": command},
                {"from": "gpt", "value": response},
            ]
        })
    return examples


def convert_agent_activity():
    """Convert agent activity into instruction-following examples."""
    activity = load_json("agent_activity")
    examples = []

    for item in activity:
        if item.get("activity_type") not in ("task_completed", "message_out"):
            continue
        title = (item.get("title") or "").strip()
        body = (item.get("body") or "").strip()
        if not title or not body or len(body) < 30:
            continue

        # Frame as "what did you do?" conversations
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"What's the status on: {title}"},
                {"from": "gpt", "value": body},
            ]
        })
    return examples


def convert_tasks():
    """Convert tasks into planning/breakdown conversations."""
    tasks = load_json("tasks")
    examples = []

    for task in tasks:
        title = (task.get("title") or "").strip()
        desc = (task.get("description") or "").strip()
        status = task.get("status", "")
        if not title or not desc or len(desc) < 20:
            continue
        # Skip auto-generated reports (they're just logs)
        if title.startswith("[Auto]"):
            continue

        if status == "done":
            examples.append({
                "conversations": [
                    {"from": "system", "value": BLACKSWAN_SYSTEM},
                    {"from": "human", "value": f"I need to {title.lower()}. How should I approach this?"},
                    {"from": "gpt", "value": f"Here's what I'd suggest for that:\n\n{desc}\n\nMark it done when you've shipped it."},
                ]
            })
    return examples


def convert_check_ins():
    """Convert check-ins into coaching conversations."""
    check_ins = load_json("check_ins")
    examples = []

    for ci in check_ins:
        content = (ci.get("content") or "").strip()
        if not content or len(content) < 10:
            continue
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"Check-in: {content}"},
                {"from": "gpt", "value": "Good to see you checking in. Stay locked in — what's the one thing you're shipping today?"},
            ]
        })
    return examples


def convert_messages():
    """Convert main circle chat rows into multi-turn and adjacent Q/A examples."""
    msgs = load_json("messages")
    examples = []

    grouped = {}
    for msg in msgs:
        content = clean_chat_content(msg.get("content"))
        if not content:
            continue
        key = msg.get("thread_id") or msg.get("circle_id") or "main"
        row = dict(msg)
        row["_clean_content"] = content
        grouped.setdefault(key, []).append(row)

    for key, rows in grouped.items():
        rows.sort(key=lambda m: m.get("created_at") or "")
        for session_index, session in enumerate(split_sessions(rows)):
            turns = [{"from": "system", "value": BLACKSWAN_SYSTEM}]
            for msg in session:
                role = "gpt" if msg.get("is_bot") else "human"
                merge_same_role(turns, role, msg["_clean_content"])
            if valid_conversation(turns):
                examples.append(make_example(
                    "messages_session",
                    turns,
                    group_id=key,
                    session_index=session_index,
                    row_count=len(session),
                ))

            # Short adjacent prompt/response examples make the fine-tune
            # learn real app replies even when the full thread is noisy.
            for i, msg in enumerate(session):
                if msg.get("is_bot"):
                    continue
                reply_parts = []
                for nxt in session[i + 1:]:
                    if not nxt.get("is_bot"):
                        break
                    reply = nxt.get("_clean_content") or ""
                    if reply:
                        reply_parts.append(reply)
                    if len(reply_parts) >= 2:
                        break
                reply_text = "\n".join(reply_parts).strip()
                if len(reply_text) < 10:
                    continue
                examples.append(make_example(
                    "messages_adjacent_pair",
                    [
                        {"from": "system", "value": BLACKSWAN_SYSTEM},
                        {"from": "human", "value": msg["_clean_content"]},
                        {"from": "gpt", "value": reply_text},
                    ],
                    group_id=key,
                    message_id=msg.get("id"),
                ))

    return examples


def convert_room_messages():
    """Convert room chat messages into conversation examples."""
    msgs = load_json("room_messages")
    examples = []

    # Group by room
    rooms = {}
    for m in msgs:
        rid = m.get("room_id", "")
        if rid not in rooms:
            rooms[rid] = []
        rooms[rid].append(m)

    for rid, room_msgs in rooms.items():
        room_msgs.sort(key=lambda m: m.get("created_at") or "")
        chats = []
        for msg in room_msgs:
            mtype = msg.get("message_type") or "chat"
            if mtype not in ("chat", "agent_output", "system"):
                continue
            content = clean_chat_content(msg.get("content"))
            if not content:
                continue
            row = dict(msg)
            row["_clean_content"] = content
            chats.append(row)

        if not chats:
            continue

        for session_index, session in enumerate(split_sessions(chats)):
            turns = [{"from": "system", "value": BLACKSWAN_SYSTEM}]
            for msg in session:
                role = "gpt" if msg.get("agent_name") or msg.get("message_type") in ("agent_output", "system") else "human"
                merge_same_role(turns, role, msg["_clean_content"])
            if valid_conversation(turns):
                examples.append(make_example(
                    "room_messages_session",
                    turns,
                    room_id=rid,
                    session_index=session_index,
                    row_count=len(session),
                ))
                continue

            # Some room rows are only saved agent outputs. They are still
            # valuable for teaching BlackSwan the app's room/status voice.
            for msg in session:
                if not (msg.get("agent_name") or msg.get("message_type") in ("agent_output", "system")):
                    continue
                content = msg["_clean_content"]
                if len(content) < 30:
                    continue
                prompt = "Summarize the latest room agent update."
                if msg.get("message_type") == "system":
                    prompt = "Give me the room status summary."
                examples.append(make_example(
                    "room_agent_output",
                    [
                        {"from": "system", "value": BLACKSWAN_SYSTEM},
                        {"from": "human", "value": prompt},
                        {"from": "gpt", "value": content},
                    ],
                    room_id=rid,
                    message_id=msg.get("id"),
                    message_type=msg.get("message_type"),
                ))

    return examples


def convert_missions():
    """Convert circle missions + tasks into accountability + planning conversations.

    Schema reference (see migration 20260410_circle_missions.sql):
      circle_missions: id, circle_id, title, description, owner_id,
                       status (draft/active/completed/archived),
                       deadline, template_id, created_at, updated_at
      mission_tasks:   id, mission_id, title, description, assignee_id,
                       agent_name, status (pending/in_progress/done/blocked),
                       sort_order, evidence (jsonb), completed_at, created_at
    """
    missions = load_json("circle_missions")
    tasks = load_json("mission_tasks")
    examples = []

    # Index tasks by mission_id so we can attach the breakdown.
    tasks_by_mission = {}
    for t in tasks:
        mid = t.get("mission_id")
        if not mid:
            continue
        tasks_by_mission.setdefault(mid, []).append(t)

    for m in missions:
        title = (m.get("title") or "").strip()
        # No `goal` column in real schema — description carries the goal.
        goal = (m.get("description") or "").strip()
        status = m.get("status", "")
        if not title or len(title) < 5:
            continue
        mission_tasks = tasks_by_mission.get(m["id"], [])
        # Sort by the real `sort_order` column so the breakdown
        # reads in the order the operator laid it out.
        mission_tasks.sort(key=lambda t: t.get("sort_order", 0))

        # Mission planning conversation — what would BlackSwan
        # propose as a task breakdown for this title?
        if mission_tasks and len(mission_tasks) >= 2:
            task_lines = []
            for t in mission_tasks:
                tt = (t.get("title") or "").strip()
                td = (t.get("description") or "").strip()
                if not tt:
                    continue
                line = f"- {tt}"
                if td:
                    line += f": {td[:140]}"
                task_lines.append(line)
            if task_lines:
                ask = f"Help me plan a mission: {title}."
                if goal:
                    ask += f" Context: {goal[:200]}."
                reply = "Here's how I'd break it down:\n\n" + "\n".join(task_lines)
                if status == "completed":
                    reply += "\n\nThis one's already shipped — keep that energy."
                elif status == "active":
                    reply += "\n\nKnock the first task out today and the rest get easier."
                examples.append({
                    "conversations": [
                        {"from": "system", "value": BLACKSWAN_SYSTEM},
                        {"from": "human", "value": ask},
                        {"from": "gpt", "value": reply},
                    ]
                })

        # Status-check conversation when the mission is in flight.
        if status in ("active", "completed"):
            done_count = sum(1 for t in mission_tasks if t.get("status") == "done")
            total = len(mission_tasks)
            if total > 0:
                pct = round(100 * done_count / total)
                state = "DONE 🎯" if status == "completed" else f"{pct}% in flight"
                examples.append({
                    "conversations": [
                        {"from": "system", "value": BLACKSWAN_SYSTEM},
                        {"from": "human", "value": f"How's '{title}' going?"},
                        {"from": "gpt", "value": f"Mission `{title}` — {state}. {done_count}/{total} tasks shipped." + (
                            " Don't lose momentum on the rest." if status != "completed" else ""
                        )},
                    ]
                })
    return examples


def convert_proof_of_work():
    """Convert proof-of-work entries into shipping summaries.

    Schema (20260410_circle_missions.sql):
      proof_of_work: id, circle_id, mission_id, user_id, agent_name,
                     pow_type ('commit'|'pr'|'deploy'|'agent_run'|'checkin'|'manual'),
                     title, detail (jsonb), created_at
    The `detail` JSONB usually carries the description / url / metadata
    fields — we pull a short summary out of it for the recap.
    """
    pow_entries = load_json("proof_of_work")
    examples = []

    def detail_summary(entry):
        d = entry.get("detail")
        if isinstance(d, dict):
            for key in ("summary", "description", "body", "message", "url"):
                v = d.get(key)
                if isinstance(v, str) and v.strip():
                    return v.strip()
        return ""

    # Group by user (or agent if no user_id) so we can build
    # per-actor shipping summaries.
    by_actor = {}
    for entry in pow_entries:
        actor = entry.get("user_id") or entry.get("agent_name")
        if not actor:
            continue
        title = (entry.get("title") or "").strip()
        if not title:
            continue
        by_actor.setdefault(actor, []).append((
            title,
            detail_summary(entry),
            entry.get("pow_type", ""),
            entry.get("created_at", ""),
        ))

    # Per-actor "what did I ship" recap. Keeps the last 6 entries to
    # stay realistic for a weekly recap window.
    for _actor, items in by_actor.items():
        items.sort(key=lambda x: x[3], reverse=True)
        recent = items[:6]
        if len(recent) < 2:
            continue
        bullets = []
        for (title, detail_text, pow_type, _) in recent:
            line = f"- {title}"
            if pow_type:
                line += f" ({pow_type})"
            if detail_text and len(detail_text) > 20:
                line += f" — {detail_text[:140]}"
            bullets.append(line)
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": "What have I shipped recently?"},
                {"from": "gpt", "value": "Here's the proof of work I've got for you:\n\n" + "\n".join(bullets) + "\n\nKeep stacking wins."},
            ]
        })

    # Individual entry → "describe what you shipped" example.
    for entry in pow_entries:
        title = (entry.get("title") or "").strip()
        detail_text = detail_summary(entry)
        if not title or not detail_text or len(detail_text) < 30:
            continue
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"I just shipped: {title}"},
                {"from": "gpt", "value": f"Logged. `{title}` — {detail_text[:300]}. That's the kind of receipt that compounds."},
            ]
        })
    return examples


def convert_github_events():
    """Convert circle_github_events into team shipping summaries.

    The killer-feature behavior per CLAUDE.md: BlackSwan watches the
    repo and tells the team what shipped this week. We chunk events
    by week per circle and build "summarize the week" conversations.

    Schema reference (20260311_github_integration.sql):
      circle_github_events: id, circle_id, connection_id, event_type
                            ('push'|'pull_request'|'issues'|'release'|'workflow_run'),
                            action (e.g. 'opened', 'closed', 'merged',
                            'completed'), title, body, author, ref,
                            commits_count, additions, ..., created_at.
    """
    events = load_json("circle_github_events")
    examples = []

    # Bucket events by (circle_id, week) — week is YYYY-WW.
    from datetime import datetime
    buckets = {}
    for ev in events:
        cid = ev.get("circle_id", "")
        ts = ev.get("created_at", "")
        if not cid or not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            wk = f"{dt.year}-W{dt.isocalendar().week:02d}"
        except (ValueError, AttributeError):
            continue
        buckets.setdefault((cid, wk), []).append(ev)

    for (_cid, wk), evs in buckets.items():
        # Need a few events to make a meaningful summary.
        if len(evs) < 3:
            continue
        # Bucket by event type. PR state lives in `action` for this
        # schema (opened / closed / merged), not a separate column.
        pushes = [e for e in evs if e.get("event_type") == "push"]
        prs_opened = [e for e in evs if e.get("event_type") == "pull_request" and e.get("action") == "opened"]
        prs_merged = [e for e in evs if e.get("event_type") == "pull_request" and e.get("action") in ("merged", "closed")]
        ci_failed = [e for e in evs if e.get("event_type") == "workflow_run" and e.get("action") in ("failure", "failed")]
        ci_passed = [e for e in evs if e.get("event_type") == "workflow_run" and e.get("action") in ("success", "completed")]

        # Top contributors — `author` is the GitHub login.
        actors = {}
        for e in evs:
            login = e.get("author")
            if login:
                actors[login] = actors.get(login, 0) + 1
        top = sorted(actors.items(), key=lambda x: -x[1])[:3]

        bullet_parts = []
        if pushes:
            commits_total = sum(int(p.get("commits_count") or 0) for p in pushes)
            line = f"- {len(pushes)} push{'es' if len(pushes) != 1 else ''}"
            if commits_total:
                line += f" ({commits_total} commit{'s' if commits_total != 1 else ''})"
            bullet_parts.append(line)
        if prs_merged:
            titles = [e.get("title") for e in prs_merged[:3] if e.get("title")]
            line = f"- {len(prs_merged)} PR{'s' if len(prs_merged) != 1 else ''} merged"
            if titles:
                line += f" — {', '.join(titles)}"
            bullet_parts.append(line)
        if prs_opened:
            bullet_parts.append(f"- {len(prs_opened)} PR{'s' if len(prs_opened) != 1 else ''} still open")
        if ci_passed:
            bullet_parts.append(f"- {len(ci_passed)} CI runs passed")
        if ci_failed:
            bullet_parts.append(f"- {len(ci_failed)} CI failure{'s' if len(ci_failed) != 1 else ''} (worth a look)")
        if top:
            who = ", ".join([f"{login} ({n})" for login, n in top])
            bullet_parts.append(f"- Most active: {who}")

        if not bullet_parts:
            continue

        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": "What shipped this week?"},
                {"from": "gpt", "value": f"Here's the shipping report for {wk}:\n\n" + "\n".join(bullet_parts) + ("\n\nKeep cooking." if not ci_failed else "\n\nClose those CI failures before they pile up.")},
            ]
        })
    return examples


def convert_automations():
    """Convert automation rows into ops-style conversations.

    Schema (20260313_circle_automations.sql):
      circle_automations: id, circle_id, created_by, name, description,
                          icon, trigger_type, cron_expression,
                          enabled, last_run_at, last_error,
                          template_id, created_at, updated_at, ...
    There's no last_run_summary column in this table — the automation
    reports its result to agent_activity. So we synthesize the
    conversation from the automation's intent (description + trigger)
    rather than its last response.
    """
    autos = load_json("circle_automations")
    examples = []
    for a in autos:
        name = (a.get("name") or "").strip()
        desc = (a.get("description") or "").strip()
        trigger = a.get("trigger_type") or ""
        cron = a.get("cron_expression") or ""
        enabled = a.get("enabled", False)
        last_err = (a.get("last_error") or "").strip()
        if not name or not desc or len(desc) < 20:
            continue
        if last_err:
            reply = f"`{name}` ({trigger or 'custom trigger'}) is currently failing: {last_err[:200]}. {desc[:240]}"
        elif not enabled:
            reply = f"`{name}` ({trigger or 'custom trigger'}) is paused. Original intent: {desc[:280]}"
        else:
            schedule = f"runs on {cron}" if cron and trigger == 'schedule' else f"{trigger or 'custom'} trigger"
            reply = f"`{name}` — {schedule}. Purpose: {desc[:280]}"
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"What does the {name} automation do?"},
                {"from": "gpt", "value": reply},
            ]
        })
    return examples


def convert_circle_context():
    """Convert circle descriptions and memory into app-grounding examples."""
    circles = load_json("circles")
    memories = load_json("circle_memory")
    examples = []

    memories_by_circle = {}
    for item in memories:
        cid = item.get("circle_id")
        content = (item.get("content") or "").strip()
        if cid and content:
            memories_by_circle.setdefault(cid, []).append(item)

    for circle in circles:
        cid = circle.get("id")
        name = (circle.get("name") or "this circle").strip()
        parts = []
        for label, key in (("Description", "description"), ("Vibe", "vibe"), ("Rules", "rules")):
            value = circle.get(key)
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False)
            value = (value or "").strip()
            if value:
                parts.append(f"{label}: {value}")
        for mem in sorted(memories_by_circle.get(cid, []), key=lambda m: m.get("created_at") or "")[-3:]:
            parts.append(f"Memory: {mem.get('content', '').strip()}")
        if not parts:
            continue
        examples.append(make_example(
            "circle_context",
            [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"What should you remember about {name}?"},
                {"from": "gpt", "value": "\n".join(parts)},
            ],
            circle_id=cid,
        ))

    return examples


def markdown_sections(text):
    """Return (heading, body) markdown sections with headings kept in the body."""
    sections = []
    heading = ""
    current = []
    for line in text.splitlines():
        if line.startswith("#") and line.lstrip("#").strip():
            if current:
                sections.append((heading, "\n".join(current).strip()))
            heading = line.lstrip("#").strip()
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append((heading, "\n".join(current).strip()))
    return sections


def iter_doc_paths():
    seen = set()
    for rel in LOCAL_DOC_PATHS:
        path = REPO_ROOT / rel
        if path.exists() and path not in seen:
            seen.add(path)
            yield path
    for path in sorted((REPO_ROOT / "docs" / "wiki").glob("*.md")):
        if path.exists() and path not in seen:
            seen.add(path)
            yield path
    # docs/*.md grows continuously (new plans, audits, migration notes) and a
    # hardcoded LOCAL_DOC_PATHS list drifts out of date fast. Mirror the
    # docs/wiki/*.md auto-discovery above for the top-level docs/ folder only
    # (non-recursive, so docs/archive/, docs/apps/, docs/page-audits/, etc.
    # stay opt-in via LOCAL_DOC_PATHS until reviewed for inclusion here).
    for path in sorted((REPO_ROOT / "docs").glob("*.md")):
        if path.exists() and path not in seen:
            seen.add(path)
            yield path


def convert_local_docs():
    """Convert app docs, wiki articles, and design/runtime standards."""
    examples = []
    for path in iter_doc_paths():
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        if not text.strip():
            continue
        per_file = 0
        for heading, section in markdown_sections(text):
            if per_file >= 3:
                break
            section = section.strip()
            if len(section) < MIN_DOC_CHARS:
                continue
            for chunk in chunk_text(section):
                if per_file >= 3:
                    break
                title = heading or doc_title(path)
                prompt = f"What should BlackSwan know from {title}?"
                if rel.startswith("docs/wiki/"):
                    prompt = f"Teach me the useful points from the wiki note: {title}."
                elif "DESIGN" in rel or "STYLE" in rel:
                    prompt = f"What design guidance matters from {title}?"
                elif "AGENT" in rel or "SwanBot" in title or "OpenSwan" in title:
                    prompt = f"What agent-runtime guidance matters from {title}?"
                examples.append(make_example(
                    "local_docs",
                    [
                        {"from": "system", "value": BLACKSWAN_SYSTEM},
                        {"from": "human", "value": prompt},
                        {"from": "gpt", "value": chunk},
                    ],
                    path=rel,
                    heading=title,
                ))
                per_file += 1
    return examples


# Above this size, a flat `text[:24000]` window only ever samples the
# import/type preamble of files like `openswanToolRuntime.ts` (580KB; its
# first tool-dispatch `switch` starts around char 289k) and `swanbot.ts`
# (224KB; its first `switch` starts around char 51k) — the actual
# dispatch/execution logic training is meant to ground on is *never*
# sampled. For files past this threshold, spread sampling across
# start/dispatch/end windows instead of only the head.
LARGE_PRODUCT_LOGIC_THRESHOLD = 60000
PRODUCT_LOGIC_WINDOW_CHARS = 24000
DISPATCH_MARKER_RE = re.compile(r"\bswitch\s*\(")


def _product_logic_windows(text):
    """Return 1-3 char windows to sample from a product-logic source file.

    For large files, the second window is centered on the first `switch (`
    dispatch statement when one exists (found anywhere in the file, not just
    the geometric middle — dispatch logic doesn't reliably sit at the file's
    midpoint), falling back to the geometric middle otherwise. This is what
    lets the sample actually reach tool-dispatch/execution code instead of
    only import/type preambles.
    """
    n = len(text)
    if n <= LARGE_PRODUCT_LOGIC_THRESHOLD:
        return [text[:PRODUCT_LOGIC_WINDOW_CHARS]]
    marker = DISPATCH_MARKER_RE.search(text)
    if marker:
        center = marker.start()
    else:
        center = n // 2
    mid_start = max(0, min(center - 2000, n - PRODUCT_LOGIC_WINDOW_CHARS))
    return [
        text[:PRODUCT_LOGIC_WINDOW_CHARS],
        text[mid_start:mid_start + PRODUCT_LOGIC_WINDOW_CHARS],
        text[max(0, n - PRODUCT_LOGIC_WINDOW_CHARS):],
    ]


def convert_product_logic():
    """Convert selected app runtime source files into grounded reference examples."""
    examples = []
    for rel in resolved_product_logic_paths():
        path = REPO_ROOT / rel
        if not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        text = text.strip()
        if len(text) < MIN_DOC_CHARS:
            continue
        windows = _product_logic_windows(text)
        chunk_budget = 2 if len(windows) == 1 else 4
        chunks = []
        for window in windows:
            for chunk in chunk_text(window, max_chars=4800, min_chars=500):
                if chunk not in chunks:
                    chunks.append(chunk)
            if len(chunks) >= chunk_budget:
                break
        for index, chunk in enumerate(chunks[:chunk_budget]):
            examples.append(make_example(
                "product_logic",
                [
                    {"from": "system", "value": BLACKSWAN_SYSTEM},
                    {"from": "human", "value": f"What does `{rel}` control in The Underground Circle?"},
                    {"from": "gpt", "value": f"Reference from `{rel}`:\n\n```typescript\n{chunk}\n```"},
                ],
                path=rel,
                chunk_index=index,
            ))
    return examples


def main():
    all_examples = []
    source_counts = Counter()

    def add(label, source, examples):
        tagged = tag_examples(source, examples)
        print(f"{label}: {len(tagged)}")
        all_examples.extend(tagged)
        source_counts.update(ex.get("metadata", {}).get("source", "unknown") for ex in tagged)

    terminal = convert_terminal_pairs()
    add("Terminal command/response pairs", "terminal_pairs", terminal)

    activity = convert_agent_activity()
    add("Agent activity examples", "agent_activity", activity)

    tasks = convert_tasks()
    add("Task examples", "tasks", tasks)

    check_ins = convert_check_ins()
    add("Check-in examples", "check_ins", check_ins)

    messages = convert_messages()
    add("Main chat examples", "messages", messages)

    room = convert_room_messages()
    add("Room conversation examples", "room_messages", room)

    missions = convert_missions()
    add("Mission examples", "missions", missions)

    pow_examples = convert_proof_of_work()
    add("Proof-of-work examples", "proof_of_work", pow_examples)

    gh_examples = convert_github_events()
    add("GitHub event examples", "github_events", gh_examples)

    auto_examples = convert_automations()
    add("Automation examples", "automations", auto_examples)

    circle_context = convert_circle_context()
    add("Circle context examples", "circle_context", circle_context)

    local_docs = convert_local_docs()
    add("Local docs/wiki/design examples", "local_docs", local_docs)

    product_logic = convert_product_logic()
    add("Product logic examples", "product_logic", product_logic)

    print(f"\nTotal app training examples: {len(all_examples)}")
    print("Source mix:")
    for source, count in source_counts.most_common():
        print(f"  {source}: {count}")
    if not all_examples and os.environ.get("ALLOW_EMPTY_APP_DATA") != "1":
        print(
            "ERROR: No app training examples were generated. "
            "Fix the Supabase export or set ALLOW_EMPTY_APP_DATA=1 for a public-only run."
        )
        sys.exit(1)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    print(f"Saved to {OUTPUT}")


if __name__ == "__main__":
    main()
