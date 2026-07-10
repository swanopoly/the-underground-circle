#!/usr/bin/env python3
"""
Offline reward scorer for harness tool traces — the pre-RL Composer step
(rejection-sampling SFT today, RL reward shaping later). See
docs/BLACKSWAN_COMPOSER_PATTERN.md; the reward mirrors Cursor's published
Composer design: task completion + efficiency (concave length penalty) +
evidence-before-claims + tool-call quality.

Reads the trajectories exported by export_tool_traces.py
(raw_data/tool_traces.jsonl) and writes the same rows with two added keys:

  "reward": float
  "reward_breakdown": {base, evidence_bonus, efficiency_penalty,
                       tool_quality_penalty, parallelism_bonus,
                       efficiency_x, steps, ok_calls, failed_calls,
                       total_duration_ms}

Reward, as implemented:

  base       = +1.0 if run.status == "completed", -1.0 if "failed"
  evidence   = +0.1 if >=1 successful tool call preceded a non-empty final
               message (all recorded steps precede the final by
               construction, so: non-empty `final` AND any step ok=true)
  efficiency = EFFICIENCY_WEIGHT * C(x), subtracted from the base, where
                 C(x) = ((1 + k*x)^(1-q) - 1) / (k * (1-q))
               is Cursor's published concave length-penalty form with
               defaults k=0.1, q=1.5, and
                 x = STEP_WEIGHT*len(steps)
                     + DURATION_WEIGHT*(total_duration_ms / 10_000)
               C(0)=0 and C'(0)=1 for any k,q, so a small weight
               (default 0.03) keeps the penalty proportionate; with q>1 the
               penalty is bounded above by weight/(k*(q-1)) = 0.6 default,
               so length alone never flips a completed run negative.
  tool qual. = -0.05 per failed tool call (ok is not true), capped at -0.30
  parallel   = +0.05 if any iteration contains >=2 tool calls

  reward = base + evidence - efficiency - tool_quality + parallel

`--top-fraction 0.5` additionally writes the highest-reward COMPLETED
trajectories (deterministic: reward desc, run_id tiebreak) to
tool_traces_top.jsonl next to the output — that file is the
rejection-sampled slice to feed convert_tool_traces.py for SFT.

Pure stdlib (json/math/argparse); no network.

Usage:
  python score_trajectories.py
  python score_trajectories.py --top-fraction 0.5
  python score_trajectories.py --input /tmp/tool_traces.jsonl \
      --output /tmp/tool_traces_scored.jsonl --top-fraction 0.5
"""

import argparse
import json
import math
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DEFAULT_INPUT = SCRIPT_DIR / "raw_data" / "tool_traces.jsonl"
DEFAULT_OUTPUT = SCRIPT_DIR / "raw_data" / "tool_traces_scored.jsonl"
TOP_FILENAME = "tool_traces_top.jsonl"

# ─── Reward constants (documented defaults) ─────────────────────────────────

BASE_COMPLETED = 1.0
BASE_FAILED = -1.0

EVIDENCE_BONUS = 0.1            # claims-with-evidence: ok call before final

EFFICIENCY_WEIGHT = 0.03        # scales C(x); C'(0)=1 so raw C(x) ~ x for
                                # small x and needs a small weight
EFFICIENCY_K = 0.1              # curvature onset — larger k bends sooner
EFFICIENCY_Q = 1.5              # concavity exponent; q>1 bounds the penalty
                                # at weight/(k*(q-1)) (= 0.6 with defaults)
STEP_WEIGHT = 1.0               # x contribution per step
DURATION_WEIGHT = 1.0           # x contribution per 10s of tool time
DURATION_UNIT_MS = 10_000.0

FAILED_CALL_PENALTY = 0.05      # per tool call whose ok is not true
FAILED_CALL_PENALTY_CAP = 0.30

PARALLEL_BONUS = 0.05           # any iteration with >=2 calls


def concave_length_cost(x, k=EFFICIENCY_K, q=EFFICIENCY_Q):
    """Cursor's published concave penalty form.

    C(x) = ((1 + k*x)^(1-q) - 1) / (k * (1-q)); the q == 1 limit is
    ln(1 + k*x) / k. Monotone increasing, concave (diminishing marginal
    penalty), C(0) = 0, C'(0) = 1.
    """
    if x <= 0:
        return 0.0
    if abs(q - 1.0) < 1e-9:
        return math.log1p(k * x) / k
    return (math.pow(1.0 + k * x, 1.0 - q) - 1.0) / (k * (1.0 - q))


def score_trajectory(trajectory):
    """Return (reward, breakdown) for one exported trajectory row."""
    run = trajectory.get("run") or {}
    steps = trajectory.get("steps") or []
    status = (run.get("status") or "").lower()
    completed = status == "completed"

    base = BASE_COMPLETED if completed else BASE_FAILED

    ok_calls = sum(1 for s in steps if s.get("ok") is True)
    # Fail-closed: a call not recorded as ok counts against tool quality.
    failed_calls = len(steps) - ok_calls

    # Evidence-before-claims: every recorded step precedes the final message
    # by construction, so the bonus requires a non-empty final plus >=1
    # successful call to back it.
    final_text = str(trajectory.get("final") or "").strip()
    evidence_bonus = EVIDENCE_BONUS if (final_text and ok_calls >= 1) else 0.0

    total_duration_ms = 0
    for s in steps:
        duration = s.get("duration_ms")
        if isinstance(duration, (int, float)) and duration > 0:
            total_duration_ms += duration

    x = STEP_WEIGHT * len(steps) + DURATION_WEIGHT * (total_duration_ms / DURATION_UNIT_MS)
    efficiency_penalty = EFFICIENCY_WEIGHT * concave_length_cost(x)

    tool_quality_penalty = min(FAILED_CALL_PENALTY * failed_calls, FAILED_CALL_PENALTY_CAP)

    calls_per_iteration = {}
    for s in steps:
        iteration = s.get("iteration")
        if iteration is None:
            continue
        calls_per_iteration[iteration] = calls_per_iteration.get(iteration, 0) + 1
    parallelism_bonus = PARALLEL_BONUS if any(
        count >= 2 for count in calls_per_iteration.values()
    ) else 0.0

    reward = base + evidence_bonus - efficiency_penalty - tool_quality_penalty + parallelism_bonus

    breakdown = {
        "base": base,
        "evidence_bonus": evidence_bonus,
        "efficiency_penalty": round(efficiency_penalty, 6),
        "tool_quality_penalty": round(tool_quality_penalty, 6),
        "parallelism_bonus": parallelism_bonus,
        "efficiency_x": round(x, 4),
        "steps": len(steps),
        "ok_calls": ok_calls,
        "failed_calls": failed_calls,
        "total_duration_ms": total_duration_ms,
    }
    return round(reward, 6), breakdown


def run_id_of(row):
    return str(((row.get("meta") or {}).get("run_id")) or "")


def load_rows(path):
    rows = []
    with path.open() as fh:
        for line_num, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"  WARNING: Invalid JSON at {path.name}:{line_num}")
    return rows


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Score harness tool traces with the Composer-style offline reward."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help=f"tool_traces.jsonl from export_tool_traces.py (default: {DEFAULT_INPUT})")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help=f"scored copy with reward/reward_breakdown (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--top-fraction", type=float, default=None,
                        help="also write this fraction of highest-reward COMPLETED "
                             f"trajectories to {TOP_FILENAME} next to the output "
                             "(rejection-sampled SFT slice), e.g. 0.5")
    args = parser.parse_args()

    if args.top_fraction is not None and not (0.0 < args.top_fraction <= 1.0):
        parser.error("--top-fraction must be in (0, 1]")
    if not args.input.exists():
        print(f"ERROR: input not found: {args.input} (run export_tool_traces.py first)", file=sys.stderr)
        sys.exit(1)

    rows = load_rows(args.input)
    scored = []
    for row in rows:
        out = dict(row)
        reward, breakdown = score_trajectory(row)
        out["reward"] = reward
        out["reward_breakdown"] = breakdown
        scored.append(out)

    write_jsonl(args.output, scored)

    completed = [r for r in scored if ((r.get("run") or {}).get("status") or "").lower() == "completed"]
    not_completed = [r for r in scored if ((r.get("run") or {}).get("status") or "").lower() != "completed"]

    def mean(values):
        return sum(values) / len(values) if values else 0.0

    print(f"Scored {len(scored)} trajectories → {args.output}")
    print(f"  completed: {len(completed)} (mean reward {mean([r['reward'] for r in completed]):.4f})")
    print(f"  failed:    {len(not_completed)} (mean reward {mean([r['reward'] for r in not_completed]):.4f})")

    if args.top_fraction is not None:
        top_path = args.output.parent / TOP_FILENAME
        # Deterministic: reward descending, run_id ascending as tiebreak.
        ranked = sorted(completed, key=lambda r: (-r["reward"], run_id_of(r)))
        keep = max(1, int(len(ranked) * args.top_fraction)) if ranked else 0
        top = ranked[:keep]
        write_jsonl(top_path, top)
        if top:
            print(f"  top {args.top_fraction:.0%} of completed: {len(top)} rows "
                  f"(reward {top[-1]['reward']:.4f}…{top[0]['reward']:.4f}) → {top_path}")
        else:
            print(f"  top slice empty (no completed trajectories) → {top_path}")


if __name__ == "__main__":
    main()
