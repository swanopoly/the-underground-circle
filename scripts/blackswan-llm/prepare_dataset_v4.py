#!/usr/bin/env python3
"""
BlackSwan LLM v4 — Prepare final training dataset.

Same pipeline as v3 but reads public_curated_v4.jsonl (expanded dataset).
Merges: real + synthetic + multiturn + public_v4 → train_v4.jsonl + eval_v4.jsonl
"""

import json
import re
import hashlib
from pathlib import Path
from collections import Counter

DATA_DIR = Path(__file__).parent / "training_data"
REAL_FILE = DATA_DIR / "blackswan_real.jsonl"
SYNTHETIC_FILE = DATA_DIR / "blackswan_synthetic.jsonl"
MULTITURN_FILE = DATA_DIR / "blackswan_multiturn.jsonl"
PUBLIC_FILE = DATA_DIR / "public_curated_v4.jsonl"
APP_FILE = DATA_DIR / "app_data.jsonl"
TOOL_TRACES_FILE = DATA_DIR / "tool_traces_sharegpt.jsonl"
# 2026-07-16: hand-curated, production-shaped examples (long, realistic
# multi-section system prompts paired with a correctly-terminating answer)
# generated after live testing found BlackSwan-v5 breaks down on prompts
# this complex — training data previously only ever used short
# single-paragraph system prompts. Checked into git (unlike training_data/,
# which is gitignored and rebuilt fresh each cycle) since these are
# deliberately-authored, reusable examples, not raw per-cycle exports. Each
# file's `metadata.source` is a non-empty, non-"tool_traces" string, so
# is_app_example() already treats them as app examples and applies the same
# APP_OVERSAMPLE factor below — no special-casing needed beyond loading them.
PRODUCTION_SHAPED_DIR = Path(__file__).parent / "training_data_generated"
TRAIN_FILE = DATA_DIR / "train_v4.jsonl"
EVAL_FILE = DATA_DIR / "eval_v4.jsonl"
STATS_FILE = DATA_DIR / "stats_v4.json"

# Oversample factor for app-derived examples. The app examples are
# deduped once with the full corpus, split into train/eval, and only
# then repeated in the train shard. This gives the model a real app
# signal without leaking repeated examples into eval.
APP_OVERSAMPLE = 12

# Oversample factor for harness tool-trace conversations (Composer-pattern
# v6 SFT source from convert_tool_traces.py; see
# docs/BLACKSWAN_COMPOSER_PATTERN.md). Deliberately modest — 2x, not the
# 12x app factor — because the traces are highly templated <tool_call>
# turns: they should teach the tool vocabulary as a complement to the
# conversational app voice, and heavier repetition risks format overfitting
# and letting one narrow shape dominate the mix.
TOOL_TRACE_OVERSAMPLE = 2
TOOL_TRACE_SOURCE = "tool_traces"

# ─── PII patterns ────────────────────────────────────────────────────────────

EMAIL_RE = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
PHONE_RE = re.compile(r'\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b')
WALLET_RE = re.compile(r'\b0x[a-fA-F0-9]{40}\b')
SSN_RE = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
API_KEY_RE = re.compile(r'\b(?:sk-|pk_|rk_|whsec_|xox[bpas]-)[A-Za-z0-9_-]{20,}\b')


def load_jsonl(path):
    if not path.exists():
        return []
    items = []
    with open(path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"  WARNING: Invalid JSON at {path.name}:{line_num}")
    return items


def extract_text(conv_obj):
    return " ".join(t.get("value", "") for t in conv_obj.get("conversations", []))


def clean_pii(text):
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_RE.sub("[phone]", text)
    text = WALLET_RE.sub("[wallet]", text)
    text = SSN_RE.sub("[ssn]", text)
    text = API_KEY_RE.sub("[api_key]", text)
    return text


def apply_pii_cleaning(conv_obj):
    cleaned = dict(conv_obj)
    cleaned["conversations"] = []
    for turn in conv_obj.get("conversations", []):
        cleaned_turn = dict(turn)
        cleaned_turn["value"] = clean_pii(turn.get("value", ""))
        cleaned["conversations"].append(cleaned_turn)
    return cleaned


def passes_quality(conv_obj):
    convs = conv_obj.get("conversations", [])
    if len(convs) < 3:
        return False, "too_few_turns"
    roles = [c["from"] for c in convs]
    if "human" not in roles:
        return False, "no_human"
    if "gpt" not in roles:
        return False, "no_gpt"
    for turn in convs:
        if turn["from"] == "gpt" and len(turn.get("value", "").strip()) < 10:
            return False, "short_gpt_response"
    for turn in convs:
        if turn["from"] == "human" and len(turn.get("value", "").strip()) < 2:
            return False, "short_human_message"
    total_len = sum(len(t.get("value", "")) for t in convs)
    if total_len > 24000:  # Increased for code examples
        return False, "too_long"
    if total_len < 20:
        return False, "too_short"
    return True, "ok"


def text_fingerprint(text):
    normalized = re.sub(r'[^\w\s]', '', text.lower())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return hashlib.md5(normalized.encode()).hexdigest()


def deduplicate(conversations, threshold=0.9):
    seen_fingerprints = set()
    seen_items = []
    unique = []
    for conv in conversations:
        text = extract_text(conv)
        fp = text_fingerprint(text)
        if fp in seen_fingerprints:
            continue
        words_a = set(text.lower().split())
        is_dup = False
        check_against = seen_items[-200:] if len(seen_items) > 200 else seen_items
        for _prev_text, words_b in check_against:
            if words_a and words_b:
                jaccard = len(words_a & words_b) / len(words_a | words_b)
                if jaccard > threshold:
                    is_dup = True
                    break
        if not is_dup:
            seen_fingerprints.add(fp)
            seen_items.append((text, words_a))
            unique.append(conv)
    return unique


def split_dataset(conversations, eval_ratio=0.05):
    """Split into train/eval. Using 5% for eval (vs 10% in v3) since dataset is much larger."""
    import random
    random.seed(42)
    shuffled = list(conversations)
    random.shuffle(shuffled)
    eval_count = max(1, int(len(shuffled) * eval_ratio))
    return shuffled[eval_count:], shuffled[:eval_count]


def is_tool_trace_example(conv_obj):
    return (conv_obj.get("metadata") or {}).get("source") == TOOL_TRACE_SOURCE


def is_app_example(conv_obj):
    # Tool traces carry their own, smaller oversample factor below — keep
    # them out of the 12x app bucket.
    source = (conv_obj.get("metadata") or {}).get("source")
    return bool(source) and source != TOOL_TRACE_SOURCE


def source_counts(dataset):
    return dict(Counter(
        (item.get("metadata") or {}).get("source", "public_or_unlabeled")
        for item in dataset
    ))


def oversample_train_app(train):
    import random
    app_examples = [item for item in train if is_app_example(item)]
    if not app_examples or APP_OVERSAMPLE <= 1:
        return train, {"app_train_unique": len(app_examples), "app_train_after_oversample": len(app_examples)}
    expanded = list(train) + (app_examples * (APP_OVERSAMPLE - 1))
    random.seed(42)
    random.shuffle(expanded)
    return expanded, {
        "app_train_unique": len(app_examples),
        "app_train_after_oversample": len(app_examples) * APP_OVERSAMPLE,
        "app_train_extra_repeats": len(app_examples) * (APP_OVERSAMPLE - 1),
    }


def oversample_train_tool_traces(train):
    """Same train-shard-only repeat as oversample_train_app, at the modest
    TOOL_TRACE_OVERSAMPLE factor (see the constant's comment for why 2x)."""
    import random
    trace_examples = [item for item in train if is_tool_trace_example(item)]
    if not trace_examples or TOOL_TRACE_OVERSAMPLE <= 1:
        return train, {
            "tool_trace_train_unique": len(trace_examples),
            "tool_trace_train_after_oversample": len(trace_examples),
        }
    expanded = list(train) + (trace_examples * (TOOL_TRACE_OVERSAMPLE - 1))
    random.seed(42)
    random.shuffle(expanded)
    return expanded, {
        "tool_trace_train_unique": len(trace_examples),
        "tool_trace_train_after_oversample": len(trace_examples) * TOOL_TRACE_OVERSAMPLE,
        "tool_trace_train_extra_repeats": len(trace_examples) * (TOOL_TRACE_OVERSAMPLE - 1),
    }


def load_production_shaped_examples():
    """Load every hand-curated production_shaped_*.jsonl file from
    training_data_generated/ (checked into git; see PRODUCTION_SHAPED_DIR's
    comment above). Missing directory/files are fine — returns []."""
    if not PRODUCTION_SHAPED_DIR.exists():
        return []
    examples = []
    for path in sorted(PRODUCTION_SHAPED_DIR.glob("production_shaped_*.jsonl")):
        examples.extend(load_jsonl(path))
    return examples


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stats = {"sources": {}, "quality_filters": Counter(), "dedup": {}, "final": {}}

    real = load_jsonl(REAL_FILE)
    synthetic = load_jsonl(SYNTHETIC_FILE)
    multiturn = load_jsonl(MULTITURN_FILE)
    public = load_jsonl(PUBLIC_FILE)
    app = load_jsonl(APP_FILE) + load_production_shaped_examples()
    tool_traces = load_jsonl(TOOL_TRACES_FILE)
    print(
        f"Loaded: {len(real)} real, {len(synthetic)} synthetic, "
        f"{len(multiturn)} multiturn, {len(public)} public_v4, "
        f"{len(app)} app incl. production-shaped (train oversample factor {APP_OVERSAMPLE}x after dedup), "
        f"{len(tool_traces)} tool_traces (train oversample factor {TOOL_TRACE_OVERSAMPLE}x after dedup)"
    )
    stats["sources"] = {
        "real": len(real), "synthetic": len(synthetic),
        "multiturn": len(multiturn), "public_v4": len(public),
        "app_unique": len(app), "app_oversample": APP_OVERSAMPLE,
        "tool_traces_unique": len(tool_traces),
        "tool_trace_oversample": TOOL_TRACE_OVERSAMPLE,
    }

    all_convs = real + synthetic + multiturn + public + app + tool_traces
    print(f"Total raw: {len(all_convs)}")

    # Step 1: PII cleaning
    print("\nStep 1: PII cleaning...")
    all_convs = [apply_pii_cleaning(c) for c in all_convs]

    # Step 2: Quality filtering
    print("Step 2: Quality filtering...")
    filtered = []
    filter_reasons = Counter()
    for conv in all_convs:
        passes, reason = passes_quality(conv)
        if passes:
            filtered.append(conv)
        else:
            filter_reasons[reason] += 1
    print(f"  Passed: {len(filtered)}, Removed: {len(all_convs) - len(filtered)}")
    for reason, count in filter_reasons.most_common():
        print(f"    {reason}: {count}")
    stats["quality_filters"] = dict(filter_reasons)

    # Step 3: Deduplication
    print("Step 3: Deduplication...")
    unique = deduplicate(filtered)
    print(f"  Unique: {len(unique)}, Duplicates removed: {len(filtered) - len(unique)}")
    stats["dedup"] = {"before": len(filtered), "after": len(unique), "removed": len(filtered) - len(unique)}

    # Step 4: Train/eval split
    print("Step 4: Train/eval split (95/5)...")
    train, eval_set = split_dataset(unique)
    app_eval_unique = sum(1 for item in eval_set if is_app_example(item))
    tool_trace_eval_unique = sum(1 for item in eval_set if is_tool_trace_example(item))
    train, oversample_stats = oversample_train_app(train)
    train, tool_trace_oversample_stats = oversample_train_tool_traces(train)
    print(f"  Train: {len(train)}, Eval: {len(eval_set)}")
    print(
        f"  App train examples: {oversample_stats.get('app_train_unique', 0)} unique "
        f"→ {oversample_stats.get('app_train_after_oversample', 0)} after oversample; "
        f"eval app unique: {app_eval_unique}"
    )
    print(
        f"  Tool-trace train examples: {tool_trace_oversample_stats.get('tool_trace_train_unique', 0)} unique "
        f"→ {tool_trace_oversample_stats.get('tool_trace_train_after_oversample', 0)} after oversample; "
        f"eval tool-trace unique: {tool_trace_eval_unique}"
    )

    # Write outputs
    with open(TRAIN_FILE, "w") as f:
        for conv in train:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")
    with open(EVAL_FILE, "w") as f:
        for conv in eval_set:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")

    def avg_turns(dataset):
        return sum(len(c["conversations"]) for c in dataset) / len(dataset) if dataset else 0

    def avg_length(dataset):
        return sum(sum(len(t["value"]) for t in c["conversations"]) for c in dataset) / len(dataset) if dataset else 0

    stats["final"] = {
        "train_count": len(train), "eval_count": len(eval_set),
        "unique_total": len(unique),
        "written_total": len(train) + len(eval_set),
        "avg_turns_train": round(avg_turns(train), 1),
        "avg_chars_train": round(avg_length(train), 0),
        **oversample_stats,
        **tool_trace_oversample_stats,
        "app_eval_unique": app_eval_unique,
        "tool_trace_eval_unique": tool_trace_eval_unique,
        "train_source_counts": source_counts(train),
        "eval_source_counts": source_counts(eval_set),
    }
    with open(STATS_FILE, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"\nOutputs:")
    print(f"  {TRAIN_FILE} ({len(train)} examples)")
    print(f"  {EVAL_FILE} ({len(eval_set)} examples)")
    print(f"\nDone! {len(train) + len(eval_set)} written examples ready for v4 training ({len(unique)} unique before train oversample).")


if __name__ == "__main__":
    main()
