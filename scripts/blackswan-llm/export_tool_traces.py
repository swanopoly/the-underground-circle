#!/usr/bin/env python3
"""
BlackSwan LLM — Tool-trace export (Composer-pattern flywheel, phase 1: SFT).

Cursor's verified Composer recipe trains the model INSIDE the production
agent harness with the real tools users get ("seamless unification of RL
environments with production environments" — cursor.com/blog/composer;
formalized with a shadow production backend in the Composer 2 technical
report). Our analog: the SwanBot/OpenSwan typed loop already persists every
tool call to `agent_runs` + `agent_run_events`. This script exports those
trajectories as training rows so BlackSwan v6+ can learn the app's ACTUAL
tool vocabulary (tool names, input shapes, success/failure patterns,
turn structure) — the prerequisite for graduating BlackSwan from
grounding-only to a native tool-calling executor.

What each trajectory row contains (ShareGPT-adjacent, tool-trace flavored):
  {
    "run":   {surface, mode, model, status, title, goal},
    "steps": [{iteration, tool, input, ok, duration_ms, error?}, ...],
    "final": "<final response preview>",
    "meta":  {circle_id, run_id, created_at}
  }

Reward-design cues captured for the future RL phase (per Cursor's published
reward design): steps carry ok/duration so efficiency + evidence-before-
claims signals can be derived; runs carry status so failed trajectories can
be used as negatives.

Usage:
  export SUPABASE_URL=https://your-project.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...
  python export_tool_traces.py

Output: raw_data/tool_traces.jsonl (one trajectory per line).
Privacy: same posture as export_training_data.py — PII/secret patterns are
scrubbed from tool inputs/outputs before write; oversized payloads clamped.
"""

import os
import json
import re
import sys
from pathlib import Path

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OUTPUT_DIR = Path(__file__).parent / "raw_data"
OUTPUT_FILE = OUTPUT_DIR / "tool_traces.jsonl"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

MAX_RUNS = int(os.environ.get("TOOL_TRACE_MAX_RUNS", "20000"))
MAX_STEP_CHARS = 2000       # per-field clamp on tool input/error text
MAX_FINAL_CHARS = 1500
MIN_STEPS = 1               # runs with zero tool calls carry no tool signal

# Mirrors the anonymization posture of the main exporter: emails, phones,
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


def scrub(value):
    """Recursively scrub PII/secret-looking strings; clamp long text."""
    if isinstance(value, str):
        out = value
        for pattern, repl in PII_PATTERNS:
            out = pattern.sub(repl, out)
        if len(out) > MAX_STEP_CHARS:
            out = out[:MAX_STEP_CHARS] + "…"
        return out
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value[:50]]
    return value


def fetch_table(table_name, select="*", order=None, limit=50000, filters=None):
    """Paginated fetch from Supabase REST API (mirrors export_training_data)."""
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


def build_trajectories():
    print(f"Fetching agent_runs (limit {MAX_RUNS})…")
    runs = fetch_table(
        "agent_runs",
        select="id,circle_id,surface,mode,model,provider,status,title,goal,created_at,completed_at",
        order="created_at.desc",
        limit=MAX_RUNS,
        filters={"status": "in.(completed,failed)"},
    )
    print(f"  {len(runs)} runs")

    print("Fetching agent_run_events (tool calls + finals)…")
    # Schema per docs/RUN_THIS_SQL.sql: columns are `kind` and `at`
    # (NOT event_type/created_at — verified against production 2026-07-02).
    events = fetch_table(
        "agent_run_events",
        select="run_id,kind,payload,at",
        order="at.asc",
        limit=MAX_RUNS * 20,
        filters={"kind": "in.(tool_call_start,tool_call_result,final_response)"},
    )
    print(f"  {len(events)} events")

    by_run = {}
    for event in events:
        by_run.setdefault(event.get("run_id"), []).append(event)

    trajectories = []
    for run in runs:
        run_events = by_run.get(run["id"]) or []
        if not run_events:
            continue

        # Pair tool_call_start (input) with tool_call_result (outcome) by
        # tool_use_id — the persistence layer writes both for every call.
        starts = {}
        steps = []
        final_text = None
        for event in run_events:
            payload = event.get("payload") or {}
            etype = event.get("kind")
            if etype == "tool_call_start":
                starts[payload.get("tool_use_id")] = payload
            elif etype == "tool_call_result":
                start = starts.pop(payload.get("tool_use_id"), {})
                steps.append(scrub({
                    "iteration": payload.get("iteration"),
                    "tool": payload.get("tool"),
                    "input": start.get("input"),
                    "ok": payload.get("ok"),
                    "duration_ms": payload.get("duration_ms"),
                    **({"error": payload.get("error")} if payload.get("error") else {}),
                }))
            elif etype == "final_response":
                final_text = str(payload.get("text") or payload.get("preview") or "")[:MAX_FINAL_CHARS]

        if len(steps) < MIN_STEPS:
            continue

        trajectories.append({
            "run": scrub({
                "surface": run.get("surface"),
                "mode": run.get("mode"),
                "model": run.get("model"),
                "status": run.get("status"),
                "title": run.get("title"),
                "goal": run.get("goal"),
            }),
            "steps": steps,
            "final": scrub(final_text or ""),
            "meta": {
                "run_id": run["id"],
                "circle_id": run.get("circle_id"),
                "created_at": run.get("created_at"),
            },
        })

    return trajectories


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.", file=sys.stderr)
        sys.exit(1)

    # --output override (mirrors the sibling scripts' testability args; also
    # the escape hatch when the nightly root-owned launchd job has left
    # raw_data/ unwritable for the interactive user).
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(OUTPUT_FILE))
    args = parser.parse_args()
    output_file = Path(args.output)

    trajectories = build_trajectories()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w") as fh:
        for row in trajectories:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    ok = sum(1 for t in trajectories if t["run"]["status"] == "completed")
    print(f"Wrote {len(trajectories)} trajectories ({ok} completed, "
          f"{len(trajectories) - ok} failed-as-negatives) → {output_file}")


if __name__ == "__main__":
    main()
