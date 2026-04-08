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

    print(f"\nTotal app training examples: {len(all_examples)}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    print(f"Saved to {OUTPUT}")


if __name__ == "__main__":
    main()
