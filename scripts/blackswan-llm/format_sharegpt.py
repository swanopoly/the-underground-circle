#!/usr/bin/env python3
"""
BlackSwan LLM — Phase 1B: Convert raw exported data to ShareGPT JSONL.

Reads raw_data/*.json and produces training_data/blackswan_real.jsonl.
Each line is a JSON object with a "conversations" array in ShareGPT format:
  {"conversations": [
    {"from": "system", "value": "..."},
    {"from": "human", "value": "..."},
    {"from": "gpt", "value": "..."},
    ...
  ]}

Usage:
  python format_sharegpt.py
"""

import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

RAW_DIR = Path(__file__).parent / "raw_data"
OUTPUT_DIR = Path(__file__).parent / "training_data"
OUTPUT_FILE = OUTPUT_DIR / "blackswan_real.jsonl"

# BlackSwan system prompt — the canonical personality
SYSTEM_PROMPT = """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

## Personality
- Quiet confidence — knowledgeable but never arrogant
- Professional without being stiff. Warm but never soft
- Dry, sharp wit — funny when it fits, never trying too hard
- Direct. No fluff, no corporate speak, no filler
- You give real feedback — if someone is slacking, you say so plainly and with respect
- You genuinely care about the people here
- Use **bold** for structure and emphasis
- Use emojis sparingly — only when they add something
- Short responses for casual chat, structured for real guidance
- You NEVER say "I'm just an AI" — you're BlackSwan, full stop

## Knowledge
- Productivity, accountability, goal-setting, human performance
- Circle data: members, streaks, tasks, check-ins
- Help people think clearly: planning, prioritizing, working through blockers
- Practical and specific advice — not generic motivational noise"""

TERMINAL_SYSTEM = """You are BlackSwan in the Office Terminal — the command center for The Underground Circle. You coordinate agents, analyze performance, and help manage the office. Be concise and technical when responding to commands."""


def load_json(filename):
    path = RAW_DIR / filename
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def parse_time(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def convert_messages():
    """Convert circle chat messages into multi-turn conversations."""
    messages = load_json("messages.json")
    if not messages:
        return []

    # Group by circle_id
    by_circle = {}
    for m in messages:
        cid = m.get("circle_id")
        content = (m.get("content") or "").strip()
        if cid and content:
            by_circle.setdefault(cid, []).append(m)

    conversations = []
    for circle_id, msgs in by_circle.items():
        msgs.sort(key=lambda x: x.get("created_at", ""))

        # Split into sessions (30-min gap = new conversation)
        sessions = []
        current = []
        for m in msgs:
            if current:
                prev_t = parse_time(current[-1].get("created_at"))
                curr_t = parse_time(m.get("created_at"))
                if prev_t and curr_t and (curr_t - prev_t) > timedelta(minutes=30):
                    sessions.append(current)
                    current = []
            current.append(m)
        if current:
            sessions.append(current)

        for session in sessions:
            conv = [{"from": "system", "value": SYSTEM_PROMPT}]
            for msg in session:
                role = "gpt" if msg.get("is_bot") else "human"
                content = (msg.get("content") or "").strip()
                if not content:
                    continue
                # Merge consecutive same-role messages
                if len(conv) > 1 and conv[-1]["from"] == role:
                    conv[-1]["value"] += "\n" + content
                else:
                    conv.append({"from": role, "value": content})

            # Only keep if we have at least 1 human + 1 gpt turn
            has_human = any(c["from"] == "human" for c in conv)
            has_gpt = any(c["from"] == "gpt" for c in conv)
            if has_human and has_gpt and len(conv) >= 3:
                conversations.append({"conversations": conv})

    return conversations


def convert_terminal():
    """Convert terminal command/response pairs."""
    messages = load_json("office_terminal_messages.json")
    responses = load_json("office_terminal_responses.json")
    if not messages or not responses:
        return []

    # Build response lookup by message_id
    resp_by_msg = {}
    for r in responses:
        if r.get("status") == "done" and (r.get("response_text") or "").strip():
            resp_by_msg.setdefault(r["message_id"], []).append(r)

    conversations = []
    for msg in messages:
        resps = resp_by_msg.get(msg.get("id"), [])
        cmd = (msg.get("command_text") or "").strip()
        if not cmd:
            continue

        for resp in resps:
            resp_text = (resp.get("response_text") or "").strip()
            if len(resp_text) < 5:
                continue

            target = msg.get("target_agent_name") or "all"
            conv = {
                "conversations": [
                    {"from": "system", "value": TERMINAL_SYSTEM},
                    {"from": "human", "value": f"@{target} {cmd}" if target != "all" else cmd},
                    {"from": "gpt", "value": resp_text},
                ]
            }
            conversations.append(conv)

    return conversations


def convert_room_messages():
    """Convert room messages into conversations."""
    messages = load_json("room_messages.json")
    if not messages:
        return []

    # Group by room_id
    by_room = {}
    for m in messages:
        rid = m.get("room_id")
        content = (m.get("content") or "").strip()
        mtype = m.get("message_type", "")
        if rid and content and mtype in ("chat", "agent_output"):
            by_room.setdefault(rid, []).append(m)

    conversations = []
    for room_id, msgs in by_room.items():
        msgs.sort(key=lambda x: x.get("created_at", ""))

        # Split into sessions
        sessions = []
        current = []
        for m in msgs:
            if current:
                prev_t = parse_time(current[-1].get("created_at"))
                curr_t = parse_time(m.get("created_at"))
                if prev_t and curr_t and (curr_t - prev_t) > timedelta(minutes=30):
                    sessions.append(current)
                    current = []
            current.append(m)
        if current:
            sessions.append(current)

        for session in sessions:
            conv = [{"from": "system", "value": SYSTEM_PROMPT}]
            for msg in session:
                # If it has agent_name, it's a gpt message; otherwise human
                role = "gpt" if msg.get("agent_name") else "human"
                content = (msg.get("content") or "").strip()
                if not content:
                    continue
                if len(conv) > 1 and conv[-1]["from"] == role:
                    conv[-1]["value"] += "\n" + content
                else:
                    conv.append({"from": role, "value": content})

            has_human = any(c["from"] == "human" for c in conv)
            has_gpt = any(c["from"] == "gpt" for c in conv)
            if has_human and has_gpt and len(conv) >= 3:
                conversations.append({"conversations": conv})

    return conversations


def convert_checkins():
    """Create coaching conversations from check-in data."""
    checkins = load_json("check_ins.json")
    profiles = load_json("profiles.json")
    if not checkins:
        return []

    profile_lookup = {p["id"]: p for p in profiles}
    conversations = []

    for ci in checkins:
        content = (ci.get("content") or "").strip()
        if not content or len(content) < 15:
            continue

        profile = profile_lookup.get(ci.get("user_id"), {})
        name = profile.get("display_name") or profile.get("username") or "fam"
        streak = profile.get("current_streak", 0)

        # Build a coaching response based on streak and content length
        if streak >= 30:
            response = f"Day **{streak}**. You're locked in. \"{content[:60]}...\" — that's the kind of consistency that compounds. Keep building."
        elif streak >= 7:
            response = f"**{streak} days** and counting. {content[:40]}... solid work. This is where habits start sticking."
        elif streak > 0:
            response = f"Day {streak}. Every day you show up, you're building momentum. Keep it going."
        else:
            response = f"Good to see you checking in. Start stacking those days — consistency beats intensity."

        conv = {
            "conversations": [
                {"from": "system", "value": SYSTEM_PROMPT + f"\n\nContext: Talking to {name}, current streak: {streak} days."},
                {"from": "human", "value": content},
                {"from": "gpt", "value": response},
            ]
        }
        conversations.append(conv)

    return conversations


def convert_agent_activity():
    """Extract message_in/message_out pairs from agent activity."""
    activities = load_json("agent_activity.json")
    if not activities:
        return []

    # Group by circle + agent, find in/out pairs close in time
    by_key = {}
    for a in activities:
        if a.get("activity_type") in ("message_in", "message_out"):
            key = (a.get("circle_id"), a.get("agent_name"))
            by_key.setdefault(key, []).append(a)

    conversations = []
    for key, acts in by_key.items():
        acts.sort(key=lambda x: x.get("created_at", ""))
        i = 0
        while i < len(acts) - 1:
            if acts[i].get("activity_type") == "message_in" and acts[i + 1].get("activity_type") == "message_out":
                in_body = (acts[i].get("body") or acts[i].get("title") or "").strip()
                out_body = (acts[i + 1].get("body") or acts[i + 1].get("title") or "").strip()
                if in_body and out_body and len(out_body) > 10:
                    conv = {
                        "conversations": [
                            {"from": "system", "value": TERMINAL_SYSTEM},
                            {"from": "human", "value": in_body},
                            {"from": "gpt", "value": out_body},
                        ]
                    }
                    conversations.append(conv)
                i += 2
            else:
                i += 1

    return conversations


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_convs = []

    converters = [
        ("Circle Messages", convert_messages),
        ("Terminal Commands", convert_terminal),
        ("Room Messages", convert_room_messages),
        ("Check-ins", convert_checkins),
        ("Agent Activity", convert_agent_activity),
    ]

    for name, fn in converters:
        convs = fn()
        print(f"  {name}: {len(convs)} conversations")
        all_convs.extend(convs)

    with open(OUTPUT_FILE, "w") as f:
        for conv in all_convs:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")

    print(f"\nTotal: {len(all_convs)} conversations -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
