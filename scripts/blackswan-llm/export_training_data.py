#!/usr/bin/env python3
"""
BlackSwan LLM — Phase 1A: Export training data from Supabase.

Usage:
  export SUPABASE_URL=https://your-project.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...
  python export_training_data.py
"""

import os
import json
import sys
import requests
from pathlib import Path

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OUTPUT_DIR = Path(__file__).parent / "raw_data"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "count=exact",
}


def fetch_table(table_name, select="*", order=None, limit=50000):
    """Paginated fetch from Supabase REST API."""
    all_rows = []
    offset = 0
    page_size = 1000

    while len(all_rows) < limit:
        url = f"{SUPABASE_URL}/rest/v1/{table_name}"
        params = {"select": select, "limit": page_size, "offset": offset}
        if order:
            params["order"] = order

        resp = requests.get(url, headers=HEADERS, params=params)
        if resp.status_code != 200:
            print(f"  WARNING: {table_name} returned {resp.status_code}: {resp.text[:200]}")
            break

        rows = resp.json()
        if not rows:
            break

        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    return all_rows


# Tables to export with their configurations
TABLES = {
    # Tier 1: Direct conversation data
    "messages": {
        "select": "id,content,is_bot,user_id,circle_id,created_at,reply_to",
        "order": "created_at.asc",
    },
    "office_terminal_messages": {
        "select": "id,circle_id,sender_id,sender_name,target_agent_id,target_agent_name,command_text,status,created_at",
        "order": "created_at.asc",
    },
    "office_terminal_responses": {
        "select": "id,message_id,agent_id,agent_name,response_text,status,token_count,latency_ms,error_message,created_at",
        "order": "created_at.asc",
    },
    "room_messages": {
        "select": "id,room_id,user_id,agent_name,content,message_type,metadata,created_at",
        "order": "created_at.asc",
    },
    "agent_activity": {
        "select": "id,circle_id,agent_name,source,activity_type,title,body,status,metadata,created_at",
        "order": "created_at.asc",
    },
    # Tier 2: Context and knowledge
    "check_ins": {
        "select": "id,content,user_id,circle_id,created_at",
        "order": "created_at.asc",
    },
    "tasks": {
        "select": "id,title,description,status,priority,due_date,completed_at,circle_id,created_by,created_at",
        "order": "created_at.asc",
    },
    "north_star_entries": {
        "select": "id,user_id,date,intention,priority,energy,created_at",
        "order": "created_at.asc",
    },
    "prompt_versions": {
        "select": "id,prompt_id,version,content,config,variables,created_at",
        "order": "created_at.asc",
    },
    "profiles": {
        "select": "id,username,display_name,bio,current_streak,longest_streak,xp,level,title",
    },
    "circles": {
        "select": "id,name,description,vibe,rules",
    },
    "circle_memory": {
        "select": "id,circle_id,content,version,created_at",
        "order": "created_at.asc",
    },
    # Tier 3: Supplementary
    "xp_events": {
        "select": "id,user_id,event_type,xp_amount,metadata,created_at",
        "order": "created_at.asc",
    },
    "proposals": {
        "select": "id,circle_id,title,description,proposal_type,status,created_at",
        "order": "created_at.asc",
    },
}


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    total_rows = 0

    print(f"Exporting from {SUPABASE_URL}")
    print(f"Output: {OUTPUT_DIR}\n")

    for table_name, config in TABLES.items():
        print(f"  {table_name}...", end=" ", flush=True)
        rows = fetch_table(table_name, **config)
        output_path = OUTPUT_DIR / f"{table_name}.json"
        with open(output_path, "w") as f:
            json.dump(rows, f, indent=2, default=str)
        print(f"{len(rows)} rows")
        total_rows += len(rows)

    print(f"\nDone! {total_rows} total rows across {len(TABLES)} tables.")


if __name__ == "__main__":
    main()
