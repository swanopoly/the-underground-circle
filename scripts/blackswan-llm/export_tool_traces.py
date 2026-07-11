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

Data source (P63): the exporter PREFERS the privacy-safe views
`training_safe_agent_runs` / `training_safe_agent_run_events`
(migration 20260710_training_safe_agent_runs.sql — opt-out filtered,
completed runs only, `at` aliased to created_at). If the views are not
applied yet it falls back to the raw tables with a loud warning, mirroring
export_training_data.py's optional-404-skip posture. Note: via the views
only completed runs exist, so the failed-run negatives stream is empty
until/unless a negatives-safe view ships.

What each trajectory row contains (ShareGPT-adjacent, tool-trace flavored):
  {
    "run":   {surface, mode, model, status, title, goal},
    "steps": [{iteration, tool, input, ok, duration_ms, error?,
               solver_note?}, ...],
    "final": "<final response preview>",
    "solver_consultations": [{iteration, reason}, ...],   # when present
    "meta":  {circle_id, run_id, created_at}
  }

Stuck-solver recovery (P63 gold examples): `solver_consultation` events are
now exported. Each consultation is recorded trajectory-level (for
score_trajectories.py's recovery bonus) AND as a bounded `solver_note` on
the step it followed, so ShareGPT renderers can surface the recovery moment
in that step's observation turn.

Bounds (fail closed — a run that exceeds them is skipped, not truncated,
so the emitted tool-call JSON is never corrupted):
  * canonical JSON of any tool input       > 600 chars  → skip run
  * tool-call rounds (iteration groups)    > 8          → skip run
  * result/error text                      > 400 chars  → truncated
  * solver reasons                         > 200 chars  → truncated
  * final preview                          > 1500 chars → truncated

Secret scrubbing (P63, applied to every payload string):
  * key names matching (secret|token|password|private|credential|
    api[_-]?key|access[_-]?key|bearer|authorization) are DROPPED;
  * string values containing sk-/hf_/ghp_-style keys, JWTs (eyJ…) or
    xox[a-z]- Slack tokens are replaced with "[redacted]";
  * strings > 2000 chars or full-match base64 blobs → "[binary omitted]";
  * emails/phones/bearer headers/long hex get the existing substitutions;
  * runs whose title/goal/final carry a secret-shaped value are skipped
    outright, and every built trajectory is re-scanned before write —
    any remaining suspect value skips the whole run (fail closed).

Reward-design cues captured for the future RL phase (per Cursor's published
reward design): steps carry ok/duration so efficiency + evidence-before-
claims signals can be derived; runs carry status so failed trajectories can
be used as negatives; solver_consultations mark recovery behavior.

Usage:
  export SUPABASE_URL=https://your-project.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...
  python export_tool_traces.py

  # Offline fixture mode (no network, no env needed) — reads
  # <dir>/agent_runs.json + <dir>/agent_run_events.json shaped like the
  # training_safe view rows:
  python export_tool_traces.py --fixture-dir /tmp/bs-flywheel-fixture \
      --output /tmp/bs-flywheel-fixture/tool_traces.jsonl

Output: raw_data/tool_traces.jsonl (one trajectory per line).
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

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
MAX_STEP_CHARS = 2000       # residual per-string clamp after scrubbing
MAX_FINAL_CHARS = 1500
MIN_STEPS = 1               # runs with zero tool calls carry no tool signal

# ── P63 flywheel bounds (see module docstring) ───────────────────────────────
MAX_INPUT_CANONICAL_CHARS = 600
MAX_RESULT_TEXT_CHARS = 400
MAX_TOOL_ROUNDS = 8
MAX_SOLVER_REASON_CHARS = 200
MAX_BINARY_CHARS = 2000

# Event kinds this exporter consumes (a subset of what the
# training_safe_agent_run_events view exposes — turn_end is view-only).
EVENT_KINDS = (
    "tool_call_start",
    "tool_call_result",
    "final_response",
    "solver_consultation",
)

# ── Secret / PII scrubbing ───────────────────────────────────────────────────
# Key-name markers: any payload key matching this is dropped entirely
# (mirrors the app's secret-marker key patterns).
SECRET_KEY_RE = re.compile(
    r"(secret|token|password|private|credential|api[_-]?key|access[_-]?key|bearer|authorization)",
    re.I,
)

# Value-shape markers: a string containing any of these is dropped
# ("[redacted]"), and a run that still matches one after scrubbing is
# skipped entirely (fail closed).
SECRET_VALUE_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{16,}"),
    re.compile(r"hf_[A-Za-z0-9]{16,}"),
    re.compile(r"eyJ[A-Za-z0-9_-]{20,}"),      # JWTs
    re.compile(r"ghp_[A-Za-z0-9]{16,}"),
    re.compile(r"xox[a-z]-"),                   # Slack token family
]

# Full-string base64-ish blob (screenshots, file bodies).
BASE64_BLOB_RE = re.compile(r"^[A-Za-z0-9+/=]{500,}$")

# Mirrors the anonymization posture of the main exporter: emails, phones,
# bearer headers, long hex, misc key prefixes not covered above.
PII_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}", re.I), "Bearer <token>"),
    (re.compile(r"\b(sk|pk|rk|hf|ghp|gho|xox[bpas])[-_][A-Za-z0-9]{16,}", re.I), "<api_key>"),
    (re.compile(r"\b[A-Fa-f0-9]{32,}\b"), "<hex>"),
    (re.compile(r"\b(?:\+?\d[\d\s().-]{8,}\d)\b"), "<phone>"),
]


class ExportError(RuntimeError):
    pass


def scrub_string(value):
    """Scrub one string: binary blobs out, secret-shaped values dropped,
    then the residual PII substitutions and length clamp."""
    if len(value) > MAX_BINARY_CHARS or BASE64_BLOB_RE.match(value):
        return "[binary omitted]"
    for pattern in SECRET_VALUE_PATTERNS:
        if pattern.search(value):
            return "[redacted]"
    out = value
    for pattern, repl in PII_PATTERNS:
        out = pattern.sub(repl, out)
    if len(out) > MAX_STEP_CHARS:
        out = out[:MAX_STEP_CHARS] + "…"
    return out


def scrub(value):
    """Recursively scrub payloads: secret-named keys dropped, strings
    scrubbed via scrub_string, lists clamped."""
    if isinstance(value, str):
        return scrub_string(value)
    if isinstance(value, dict):
        return {
            k: scrub(v)
            for k, v in value.items()
            if not SECRET_KEY_RE.search(str(k))
        }
    if isinstance(value, list):
        return [scrub(v) for v in value[:50]]
    return value


def contains_secret(text):
    return any(p.search(text) for p in SECRET_VALUE_PATTERNS)


def canonical_json(value):
    """Deterministic compact JSON used only for the input-size bound."""
    if value is None:
        value = {}
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def count_rounds(steps):
    """Number of tool-call rounds, mirroring convert_tool_traces.py's
    group_steps_by_iteration: consecutive steps sharing an iteration are
    one round; steps without iteration info stand alone."""
    rounds = 0
    prev = None
    have_prev = False
    for step in steps:
        iteration = step.get("iteration")
        if not have_prev or iteration is None or iteration != prev:
            rounds += 1
        prev = iteration
        have_prev = iteration is not None
    return rounds


def event_time(event):
    """Timestamp for ordering. The training_safe view exposes created_at
    (aliased from the raw column `at`); the raw table exposes `at`."""
    return str(event.get("at") or event.get("created_at") or "")


def fetch_table(table_name, select="*", order=None, limit=50000, filters=None, optional=False):
    """Paginated fetch from Supabase REST API (mirrors export_training_data).

    optional=True: a 404 (relation missing — e.g. the P63 views not applied
    yet) returns None so the caller can fall back. Any other non-200 raises.
    An EXISTING-but-empty source returns [] and must NOT trigger fallback —
    an empty opt-out-filtered view is a valid result.
    """
    import requests  # local import so --fixture-dir works without the dep

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
            if optional and resp.status_code == 404:
                return None
            raise ExportError(f"{table_name} returned {resp.status_code}: {resp.text[:300]}")

        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    return all_rows


def fetch_runs_and_events():
    """Prefer the P63 training_safe views; fall back to raw tables when the
    SQL is not applied yet (optional-404 pattern, like export_training_data)."""
    kind_filter = {"kind": f"in.({','.join(EVENT_KINDS)})"}

    print(f"Fetching runs (limit {MAX_RUNS})…")
    runs = fetch_table(
        "training_safe_agent_runs",
        select="id,circle_id,surface,mode,model,provider,status,title,goal,created_at,completed_at",
        order="created_at.desc",
        limit=MAX_RUNS,
        optional=True,
    )
    if runs is not None:
        print(f"  source: training_safe_agent_runs (opt-out filtered; completed runs only, "
              f"so the failed-run negatives stream is empty via views) — {len(runs)} runs")
        events = fetch_table(
            "training_safe_agent_run_events",
            select="run_id,kind,payload,created_at",
            order="created_at.asc",
            limit=MAX_RUNS * 20,
            filters=kind_filter,
            optional=True,
        )
        if events is None:
            raise ExportError(
                "training_safe_agent_runs exists but training_safe_agent_run_events is "
                "missing — apply 20260710_training_safe_agent_runs.sql fully."
            )
        print(f"  {len(events)} events (via training_safe_agent_run_events)")
        return runs, events

    print("  training_safe views missing (404) — falling back to RAW tables. "
          "Apply supabase/migrations/20260710_training_safe_agent_runs.sql to "
          "enable opt-out filtering.")
    runs = fetch_table(
        "agent_runs",
        select="id,circle_id,surface,mode,model,provider,status,title,goal,created_at,completed_at",
        order="created_at.desc",
        limit=MAX_RUNS,
        filters={"status": "in.(completed,failed)"},
    )
    print(f"  {len(runs)} runs (raw)")

    # Schema per docs/RUN_THIS_SQL.sql: raw columns are `kind` and `at`
    # (NOT event_type/created_at — verified against production 2026-07-02).
    events = fetch_table(
        "agent_run_events",
        select="run_id,kind,payload,at",
        order="at.asc",
        limit=MAX_RUNS * 20,
        filters=kind_filter,
    )
    print(f"  {len(events)} events (raw)")
    return runs, events


def build_trajectories(runs, events):
    by_run = {}
    for event in events:
        by_run.setdefault(event.get("run_id"), []).append(event)
    # Both sources are fetched time-ascending; the stable re-sort guards
    # fixture inputs and interleaved pagination.
    for run_events in by_run.values():
        run_events.sort(key=event_time)

    trajectories = []
    skips = Counter()

    for run in runs:
        run_events = by_run.get(run["id"]) or []
        if not run_events:
            skips["no_events"] += 1
            continue

        # Pair tool_call_start (input) with tool_call_result (outcome) by
        # tool_use_id — the persistence layer writes both for every call.
        starts = {}
        steps = []
        solver_consultations = []
        final_text = None
        for event in run_events:
            payload = event.get("payload") or {}
            etype = event.get("kind")
            if etype == "tool_call_start":
                starts[payload.get("tool_use_id")] = payload
            elif etype == "tool_call_result":
                start = starts.pop(payload.get("tool_use_id"), {})
                error_text = payload.get("error")
                if isinstance(error_text, str) and len(error_text) > MAX_RESULT_TEXT_CHARS:
                    error_text = error_text[:MAX_RESULT_TEXT_CHARS] + "…"
                steps.append(scrub({
                    "iteration": payload.get("iteration"),
                    "tool": payload.get("tool"),
                    "input": start.get("input"),
                    "ok": payload.get("ok"),
                    "duration_ms": payload.get("duration_ms"),
                    **({"error": error_text} if error_text else {}),
                }))
            elif etype == "solver_consultation":
                # P63 gold signal: stuck-solver consultation followed by
                # eventual success is recovery behavior worth training on.
                reason = scrub_string(
                    str(payload.get("reason") or "").strip()[:MAX_SOLVER_REASON_CHARS]
                )
                solver_consultations.append({
                    "iteration": payload.get("iteration"),
                    "reason": reason,
                })
                if steps:
                    note = f"stuck-solver consultation: {reason}" if reason else "stuck-solver consultation"
                    prior = steps[-1]
                    prior["solver_note"] = (
                        f"{prior['solver_note']} | {note}" if prior.get("solver_note") else note
                    )
            elif etype == "final_response":
                final_text = str(payload.get("text") or payload.get("preview") or "")[:MAX_FINAL_CHARS]

        final_text = (final_text or "").strip()
        status = (run.get("status") or "").lower()
        ok_calls = sum(1 for s in steps if s.get("ok") is True)

        if len(steps) < MIN_STEPS:
            skips["no_steps"] += 1
            continue
        # Fail closed on run-level text: title/goal/final carrying a
        # secret-shaped value poisons the human/final turns — skip, don't
        # redact into a useless example.
        run_text = " ".join(str(run.get(k) or "") for k in ("title", "goal")) + " " + final_text
        if contains_secret(run_text):
            skips["secret_in_run_text"] += 1
            continue
        if count_rounds(steps) > MAX_TOOL_ROUNDS:
            skips["too_many_rounds"] += 1
            continue
        # Inputs are never truncated (that would corrupt the JSON the
        # renderer teaches) — an oversized input skips the run instead.
        if any(len(canonical_json(s.get("input"))) > MAX_INPUT_CANONICAL_CHARS for s in steps):
            skips["oversized_input"] += 1
            continue
        # A "completed" run must actually look complete: ≥1 successful tool
        # call AND a non-empty final report. (Failed runs stay exportable as
        # negatives when reading raw tables.)
        if status == "completed" and (ok_calls < 1 or not final_text):
            skips["incomplete_completed_run"] += 1
            continue

        trajectory = {
            "run": scrub({
                "surface": run.get("surface"),
                "mode": run.get("mode"),
                "model": run.get("model"),
                "status": run.get("status"),
                "title": run.get("title"),
                "goal": run.get("goal"),
            }),
            "steps": steps,
            "final": scrub(final_text),
            "meta": {
                "run_id": run["id"],
                "circle_id": run.get("circle_id"),
                "created_at": run.get("created_at"),
            },
        }
        if solver_consultations:
            trajectory["solver_consultations"] = solver_consultations

        # Fail closed: nothing secret-shaped may survive scrubbing.
        if contains_secret(json.dumps(trajectory, ensure_ascii=False, default=str)):
            skips["secret_leak_fail_closed"] += 1
            continue

        trajectories.append(trajectory)

    return trajectories, skips


def load_fixture(fixture_dir):
    """Offline source for dry runs: <dir>/agent_runs.json +
    <dir>/agent_run_events.json, shaped like the training_safe view rows
    (arrays of row dicts; events may use created_at or at)."""
    runs_path = fixture_dir / "agent_runs.json"
    events_path = fixture_dir / "agent_run_events.json"
    for path in (runs_path, events_path):
        if not path.exists():
            raise ExportError(f"fixture file missing: {path}")
    runs = json.loads(runs_path.read_text())
    events = json.loads(events_path.read_text())
    print(f"Fixture mode: {len(runs)} runs, {len(events)} events from {fixture_dir} (no network)")
    return runs, events


def main():
    parser = argparse.ArgumentParser(
        description="Export agent tool-call trajectories for BlackSwan SFT."
    )
    # --output mirrors the sibling scripts' testability args; also the
    # escape hatch when the nightly root-owned launchd job has left
    # raw_data/ unwritable for the interactive user.
    parser.add_argument("--output", default=str(OUTPUT_FILE))
    parser.add_argument(
        "--fixture-dir",
        default=None,
        help="read agent_runs.json/agent_run_events.json from this directory "
             "instead of Supabase (offline dry runs; no env vars needed)",
    )
    args = parser.parse_args()
    output_file = Path(args.output)

    if args.fixture_dir:
        runs, events = load_fixture(Path(args.fixture_dir))
    else:
        if not SUPABASE_URL or not SUPABASE_KEY:
            print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.", file=sys.stderr)
            sys.exit(1)
        runs, events = fetch_runs_and_events()

    trajectories, skips = build_trajectories(runs, events)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w") as fh:
        for row in trajectories:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    ok = sum(1 for t in trajectories if t["run"]["status"] == "completed")
    solver = sum(1 for t in trajectories if t.get("solver_consultations"))
    print(f"Wrote {len(trajectories)} trajectories ({ok} completed, "
          f"{len(trajectories) - ok} failed-as-negatives, "
          f"{solver} with stuck-solver recovery) → {output_file}")
    if skips:
        print("Skipped runs:")
        for reason, count in skips.most_common():
            print(f"  {reason}: {count}")


if __name__ == "__main__":
    main()
