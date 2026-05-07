#!/usr/bin/env python3
"""
Convert exported app data (raw_data/) into ShareGPT training format.

Reads Supabase exports and generates conversation pairs suitable for
BlackSwan fine-tuning.

Output: training_data/app_data.jsonl
"""

import json
from pathlib import Path

RAW_DIR = Path(__file__).parent / "raw_data"
OUTPUT = Path(__file__).parent / "training_data" / "app_data.jsonl"

BLACKSWAN_SYSTEM = """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

You have quiet confidence — knowledgeable but never arrogant. Direct. No fluff, no corporate speak.
You give real feedback. You genuinely care about the people here.
You know productivity, design, UI/UX, coding, architecture, and general knowledge."""


def load_json(name):
    path = RAW_DIR / f"{name}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())


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
        # Filter to chat messages with content
        chats = [m for m in room_msgs if m.get("message_type") == "chat" and m.get("content")]
        if len(chats) < 2:
            continue
        # Build conversation
        turns = [{"from": "system", "value": BLACKSWAN_SYSTEM}]
        for m in chats:
            role = "gpt" if m.get("agent_name") else "human"
            turns.append({"from": role, "value": m["content"].strip()})
        if len(turns) >= 3:
            examples.append({"conversations": turns})

    return examples


def convert_missions():
    """Convert circle missions + tasks into accountability + planning conversations."""
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
        goal = (m.get("goal") or m.get("description") or "").strip()
        status = m.get("status", "")
        if not title or len(title) < 5:
            continue
        mission_tasks = tasks_by_mission.get(m["id"], [])

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
                    ask += f" Goal: {goal[:200]}."
                reply = f"Here's how I'd break it down:\n\n" + "\n".join(task_lines)
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
    """Convert proof-of-work entries into shipping summaries."""
    pow_entries = load_json("proof_of_work")
    examples = []

    # Group by user so we can build per-user shipping summaries.
    by_user = {}
    for entry in pow_entries:
        uid = entry.get("user_id")
        if not uid:
            continue
        title = (entry.get("title") or "").strip()
        desc = (entry.get("description") or "").strip()
        if not title:
            continue
        by_user.setdefault(uid, []).append((title, desc, entry.get("kind", ""), entry.get("created_at", "")))

    # Per-user "what did I ship" recap. Keeps the last 6 entries to
    # stay realistic for a weekly recap window.
    for uid, items in by_user.items():
        items.sort(key=lambda x: x[3], reverse=True)
        recent = items[:6]
        if len(recent) < 2:
            continue
        bullets = []
        for (title, desc, kind, _) in recent:
            line = f"- {title}"
            if kind:
                line += f" ({kind})"
            if desc and len(desc) > 20:
                line += f" — {desc[:140]}"
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
        desc = (entry.get("description") or "").strip()
        if not title or not desc or len(desc) < 30:
            continue
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"I just shipped: {title}"},
                {"from": "gpt", "value": f"Logged. `{title}` — {desc[:300]}. That's the kind of receipt that compounds."},
            ]
        })
    return examples


def convert_github_events():
    """Convert circle_github_events into team shipping summaries.

    The killer-feature behavior per CLAUDE.md: BlackSwan watches the
    repo and tells the team what shipped this week. We chunk events
    by week per circle and build "summarize the week" conversations.
    """
    events = load_json("circle_github_events")
    examples = []

    # Bucket events by (circle_id, week) — week is YYYY-WW.
    from datetime import datetime
    buckets = {}
    for ev in events:
        cid = ev.get("circle_id", "")
        ts = ev.get("delivered_at") or ev.get("created_at") or ""
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
        # Bucket by event type
        pushes = [e for e in evs if e.get("event_type") == "push"]
        prs_opened = [e for e in evs if e.get("event_type") == "pull_request" and e.get("pr_state") == "open"]
        prs_merged = [e for e in evs if e.get("event_type") == "pull_request" and e.get("pr_state") == "merged"]
        ci_failed = [e for e in evs if e.get("event_type") == "workflow_run" and e.get("workflow_status") in ("failure", "failed")]
        ci_passed = [e for e in evs if e.get("event_type") == "workflow_run" and e.get("workflow_status") == "success"]

        # Top contributors
        actors = {}
        for e in evs:
            login = e.get("actor_login")
            if login:
                actors[login] = actors.get(login, 0) + 1
        top = sorted(actors.items(), key=lambda x: -x[1])[:3]

        bullet_parts = []
        if pushes:
            bullet_parts.append(f"- {len(pushes)} push{'es' if len(pushes) != 1 else ''}")
        if prs_merged:
            titles = [e.get("pr_title") for e in prs_merged[:3] if e.get("pr_title")]
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
    """Convert automations + their last-run summaries into ops conversations."""
    autos = load_json("automations")
    examples = []
    for a in autos:
        name = (a.get("name") or "").strip()
        summary = (a.get("last_run_summary") or "").strip()
        status = a.get("last_run_status", "")
        template = a.get("template_key", "")
        if not name or not summary or len(summary) < 30:
            continue
        examples.append({
            "conversations": [
                {"from": "system", "value": BLACKSWAN_SYSTEM},
                {"from": "human", "value": f"What did the {name} automation report?"},
                {"from": "gpt", "value": f"`{name}` ({template or 'custom'}) — {status or 'last run'}: {summary[:400]}"},
            ]
        })
    return examples


def main():
    all_examples = []

    terminal = convert_terminal_pairs()
    print(f"Terminal command/response pairs: {len(terminal)}")
    all_examples.extend(terminal)

    activity = convert_agent_activity()
    print(f"Agent activity examples: {len(activity)}")
    all_examples.extend(activity)

    tasks = convert_tasks()
    print(f"Task examples: {len(tasks)}")
    all_examples.extend(tasks)

    check_ins = convert_check_ins()
    print(f"Check-in examples: {len(check_ins)}")
    all_examples.extend(check_ins)

    room = convert_room_messages()
    print(f"Room conversation examples: {len(room)}")
    all_examples.extend(room)

    missions = convert_missions()
    print(f"Mission examples: {len(missions)}")
    all_examples.extend(missions)

    pow_examples = convert_proof_of_work()
    print(f"Proof-of-work examples: {len(pow_examples)}")
    all_examples.extend(pow_examples)

    gh_examples = convert_github_events()
    print(f"GitHub event examples: {len(gh_examples)}")
    all_examples.extend(gh_examples)

    auto_examples = convert_automations()
    print(f"Automation examples: {len(auto_examples)}")
    all_examples.extend(auto_examples)

    print(f"\nTotal app training examples: {len(all_examples)}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    print(f"Saved to {OUTPUT}")


if __name__ == "__main__":
    main()
