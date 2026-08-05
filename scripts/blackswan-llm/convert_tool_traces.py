#!/usr/bin/env python3
"""
Convert exported harness tool traces into ShareGPT tool-calling conversations
for BlackSwan v6 SFT (Composer-pattern phase 1 — see
docs/BLACKSWAN_COMPOSER_PATTERN.md and export_tool_traces.py).

Reads the trajectories that export_tool_traces.py pulls from
`agent_runs` + `agent_run_events`:

  {
    "run":   {surface, mode, model, status, title, goal},
    "steps": [{iteration, tool, input, ok, duration_ms, error?}, ...],
    "final": "<final response preview>",
    "meta":  {run_id, circle_id, created_at}
  }

and emits one ShareGPT conversation per trajectory teaching tool selection,
argument shapes, sequencing, and finishing:

  system : compact SwanBot/OpenSwan tool-agent preamble listing the tools
           USED in this trajectory (names only — the trace does not persist
           full schemas) + app-agent behavior rules.
  human  : the run goal/title plus a surface/mode context line.
  gpt    : Qwen-style tool calls —
             <tool_call>
             {"name": <tool>, "arguments": <input>}
             </tool_call>
           Steps that share an iteration are grouped into ONE gpt turn with
           multiple <tool_call> blocks (parallel calls — the Composer
           behavior we want to teach). One observation turn follows each
           gpt turn, so gpt/tool alternation stays strict.
  tool   : JSON observation for the preceding call(s) — {ok, duration_ms,
           error?} (a JSON array when the turn made parallel calls).
           HONEST LIMITATION: the persistence layer does not store tool
           OUTPUT text, only outcome metadata — observations teach
           success/failure/latency shape, not result content.
  gpt    : the trajectory's `final` text (the finishing report).

COMPLETED runs land in the positives file (registered as the `tool_traces`
source in prepare_dataset_v4.py). FAILED runs land in a separate negatives
file with the same shape — usable for contrastive/rejection filtering, and
deliberately NOT registered in prepare_dataset_v4.py: never mix them into
SFT positives.

Bounds: trajectories with more than --max-steps steps are skipped, oversized
conversations are skipped (stays under prepare_dataset_v4's 24k quality cap),
each output file is capped at --max-conversations rows, and ordering is
deterministic (sorted by created_at, then run_id).

Usage:
  python convert_tool_traces.py
  python convert_tool_traces.py \
      --input /tmp/tool_traces.jsonl \
      --output /tmp/tool_traces_sharegpt.jsonl \
      --negatives-output /tmp/tool_traces_negatives.jsonl

Output (mirrors convert_app_data.py's training_data/ convention):
  training_data/tool_traces_sharegpt.jsonl   — completed runs (SFT positives)
  training_data/tool_traces_negatives.jsonl  — failed runs (negatives only)
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DEFAULT_INPUT = SCRIPT_DIR / "raw_data" / "tool_traces.jsonl"
DEFAULT_OUTPUT = SCRIPT_DIR / "training_data" / "tool_traces_sharegpt.jsonl"
DEFAULT_NEGATIVES = SCRIPT_DIR / "training_data" / "tool_traces_negatives.jsonl"

# Source tags carried in metadata. The positives tag must match
# TOOL_TRACE_SOURCE in prepare_dataset_v4.py, which keys the modest 2x
# oversample (vs the 12x app oversample) off it.
POSITIVE_SOURCE = "tool_traces"
NEGATIVE_SOURCE = "tool_traces_negative"

MAX_STEPS_DEFAULT = 40          # skip runaway trajectories
MAX_CONVERSATIONS_DEFAULT = 4000  # per output file
MAX_CONVERSATION_CHARS = 20000  # under prepare_dataset_v4's 24k "too_long" cap
MIN_FINAL_CHARS = 10            # positives must end with a real report
                                # (matches prepare_dataset_v4's short-gpt floor)

TOOL_AGENT_RULES = (
    "Rules:\n"
    "- Act through tool calls. Emit each call exactly as:\n"
    "  <tool_call>\n"
    '  {"name": "<tool_name>", "arguments": <json_object>}\n'
    "  </tool_call>\n"
    "- Independent calls may be issued together in one turn (parallel tool calls).\n"
    "- Never claim an action or result without tool evidence from this run.\n"
    "- When the goal is met, stop calling tools and finish with a concise report of what was done."
)


def build_system_turn(tool_names):
    """Compact OpenSwan tool-agent preamble for one trajectory.

    Lists only the tools this trajectory actually used, by name — the trace
    does not persist full input schemas, so we do not invent them.
    """
    tool_lines = "\n".join(f"- {name}" for name in tool_names) or "- (none recorded)"
    return (
        "You are OpenSwan — SwanBot's tool-running agent inside The Underground "
        "Circle. You complete app tasks by calling tools, then report the outcome.\n\n"
        "Tools available for this task (invoke by name with JSON arguments):\n"
        f"{tool_lines}\n\n"
        f"{TOOL_AGENT_RULES}"
    )


def build_human_turn(run):
    goal = (run.get("goal") or "").strip()
    title = (run.get("title") or "").strip()
    ask = goal or title or "Complete the assigned app task."
    if goal and title and title.lower() != goal.lower():
        ask = f"{title}\n\n{goal}"
    surface = run.get("surface") or "chat"
    mode = run.get("mode") or "agent"
    return f"{ask}\n\n[surface: {surface} | mode: {mode}]"


def format_tool_call(step):
    arguments = step.get("input")
    if arguments is None:
        arguments = {}
    call = {"name": step.get("tool") or "unknown_tool", "arguments": arguments}
    return "<tool_call>\n" + json.dumps(call, ensure_ascii=False) + "\n</tool_call>"


def format_observation(group):
    """JSON observation for one gpt turn: {ok, duration_ms, error?}.

    Parallel turns get a JSON array in call order. Tool output text is not
    persisted by the harness, so this is outcome metadata only.
    """
    results = []
    for step in group:
        obs = {"ok": bool(step.get("ok"))}
        if step.get("duration_ms") is not None:
            obs["duration_ms"] = step.get("duration_ms")
        if step.get("error"):
            obs["error"] = step.get("error")
        if step.get("solver_note"):
            # P63: surface the stuck-solver consultation at the step it
            # followed, so recovery behavior is learnable in-context.
            obs["note"] = step.get("solver_note")
        results.append(obs)
    payload = results[0] if len(results) == 1 else results
    return json.dumps(payload, ensure_ascii=False)


def group_steps_by_iteration(steps):
    """Group consecutive steps that share an iteration number.

    Steps recorded in the same iteration were issued by the model in one
    turn; emitting them as one gpt turn with multiple <tool_call> blocks is
    the parallel-call behavior we want to teach. Steps without iteration
    info stay solo, and only consecutive runs are grouped so the original
    event order is preserved.
    """
    groups = []
    for step in steps:
        iteration = step.get("iteration")
        if (
            groups
            and iteration is not None
            and groups[-1][0].get("iteration") == iteration
        ):
            groups[-1].append(step)
        else:
            groups.append([step])
    return groups


def used_tool_names(steps):
    names = []
    for step in steps:
        name = step.get("tool") or "unknown_tool"
        if name not in names:
            names.append(name)
    return names


def build_conversation(trajectory):
    """Return (turns, final_text) for one trajectory."""
    run = trajectory.get("run") or {}
    steps = trajectory.get("steps") or []
    turns = [
        {"from": "system", "value": build_system_turn(used_tool_names(steps))},
        {"from": "human", "value": build_human_turn(run)},
    ]
    for group in group_steps_by_iteration(steps):
        turns.append({
            "from": "gpt",
            "value": "\n".join(format_tool_call(step) for step in group),
        })
        turns.append({"from": "tool", "value": format_observation(group)})
    final_text = (trajectory.get("final") or "").strip()
    if final_text:
        turns.append({"from": "gpt", "value": final_text})
    return turns, final_text


def make_example(source, turns, trajectory):
    """ShareGPT row shape shared with convert_app_data.py: conversations + metadata."""
    run = trajectory.get("run") or {}
    meta = trajectory.get("meta") or {}
    metadata = {
        "source": source,
        "run_id": meta.get("run_id"),
        "surface": run.get("surface"),
        "mode": run.get("mode"),
        "model": run.get("model"),
        "status": run.get("status"),
        "steps": len(trajectory.get("steps") or []),
    }
    return {
        "conversations": turns,
        "metadata": {k: v for k, v in metadata.items() if v is not None and v != ""},
    }


def load_trajectories(path):
    trajectories = []
    with path.open() as fh:
        for line_num, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                trajectories.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"  WARNING: Invalid JSON at {path.name}:{line_num}")
    return trajectories


def sort_key(trajectory):
    meta = trajectory.get("meta") or {}
    return (str(meta.get("created_at") or ""), str(meta.get("run_id") or ""))


def convert(trajectories, max_steps, max_conversations):
    positives = []
    negatives = []
    skip_reasons = Counter()

    for trajectory in sorted(trajectories, key=sort_key):
        status = ((trajectory.get("run") or {}).get("status") or "").lower()
        if status not in ("completed", "failed"):
            skip_reasons["bad_status"] += 1
            continue
        steps = trajectory.get("steps") or []
        if not steps:
            skip_reasons["no_steps"] += 1
            continue
        if len(steps) > max_steps:
            skip_reasons["too_many_steps"] += 1
            continue

        turns, final_text = build_conversation(trajectory)
        if status == "completed" and len(final_text) < MIN_FINAL_CHARS:
            # A completed run without a report cannot teach "finish with a
            # report" — the whole point of the final gpt turn.
            skip_reasons["missing_final"] += 1
            continue
        if sum(len(t["value"]) for t in turns) > MAX_CONVERSATION_CHARS:
            skip_reasons["too_long"] += 1
            continue

        if status == "completed":
            if len(positives) >= max_conversations:
                skip_reasons["over_conversation_cap"] += 1
                continue
            positives.append(make_example(POSITIVE_SOURCE, turns, trajectory))
        else:
            if len(negatives) >= max_conversations:
                skip_reasons["over_conversation_cap"] += 1
                continue
            negatives.append(make_example(NEGATIVE_SOURCE, turns, trajectory))

    return positives, negatives, skip_reasons


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Convert harness tool traces into ShareGPT tool-calling SFT rows."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help=f"tool_traces.jsonl from export_tool_traces.py (default: {DEFAULT_INPUT})")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help=f"completed-run positives (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--negatives-output", type=Path, default=DEFAULT_NEGATIVES,
                        help=f"failed-run negatives, never mixed into positives (default: {DEFAULT_NEGATIVES})")
    parser.add_argument("--max-steps", type=int, default=MAX_STEPS_DEFAULT,
                        help=f"skip trajectories with more steps than this (default: {MAX_STEPS_DEFAULT})")
    parser.add_argument("--max-conversations", type=int, default=MAX_CONVERSATIONS_DEFAULT,
                        help=f"cap per output file, deterministic order (default: {MAX_CONVERSATIONS_DEFAULT})")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERROR: input not found: {args.input} (run export_tool_traces.py first)", file=sys.stderr)
        sys.exit(1)

    trajectories = load_trajectories(args.input)
    print(f"Loaded {len(trajectories)} trajectories from {args.input}")

    positives, negatives, skip_reasons = convert(
        trajectories, args.max_steps, args.max_conversations
    )

    write_jsonl(args.output, positives)
    write_jsonl(args.negatives_output, negatives)

    print(f"Positives (completed): {len(positives)} → {args.output}")
    print(f"Negatives (failed):    {len(negatives)} → {args.negatives_output}")
    if skip_reasons:
        print("Skipped:")
        for reason, count in skip_reasons.most_common():
            print(f"  {reason}: {count}")


if __name__ == "__main__":
    main()
