#!/usr/bin/env python3
"""
BlackSwan LLM — Phase 2B: Evaluate fine-tuned model quality.

Tests against:
1. Held-out eval set (perplexity)
2. Domain-specific test questions (quality scoring)
3. Personality consistency checks

Usage:
  python evaluate.py [--model-path models/v1.0/lora] [--base-model unsloth/Qwen2.5-7B-Instruct-bnb-4bit]
"""

import json
import argparse
import time
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"
EVAL_FILE = DATA_DIR / "eval.jsonl"
RESULTS_DIR = Path(__file__).parent / "eval_results"

# ─── Domain test questions ───────────────────────────────────────────────────

TEST_QUESTIONS = [
    # Accountability coaching
    {
        "category": "accountability",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "I missed my check-in for 3 days. I feel terrible about it.",
        "must_contain_any": ["streak", "back", "show up", "consistency", "happen"],
        "must_not_contain": ["I'm just an AI", "as an AI", "I cannot"],
    },
    {
        "category": "accountability",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle. Context: User has a 45-day streak.",
        "question": "Day 45. Starting to feel the grind.",
        "must_contain_any": ["45", "streak", "grind", "keep", "momentum", "compound"],
        "must_not_contain": ["I'm just an AI"],
    },
    {
        "category": "accountability",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "I keep starting projects but never finishing them.",
        "must_contain_any": ["finish", "focus", "one", "commit", "through", "ship"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Task planning
    {
        "category": "task_planning",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "I have 10 tasks due this week. How do I prioritize?",
        "must_contain_any": ["priorit", "important", "urgent", "first", "focus", "impact"],
        "must_not_contain": ["I'm just an AI"],
    },
    {
        "category": "task_planning",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "Help me break down 'launch my app' into smaller tasks.",
        "must_contain_any": ["step", "task", "first", "then", "deploy", "test", "mvp"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Circle management
    {
        "category": "circle_management",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "Two members in my circle are arguing. What should I do?",
        "must_contain_any": ["conflict", "talk", "both", "resolve", "respect", "address", "hear"],
        "must_not_contain": ["I'm just an AI"],
    },
    {
        "category": "circle_management",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "How do I make my circle more active?",
        "must_contain_any": ["engage", "check", "culture", "consistent", "ritual", "share"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Agent coordination (terminal)
    {
        "category": "agent_coordination",
        "system": "You are BlackSwan in the Office Terminal — the command center for The Underground Circle.",
        "question": "@BlackSwan status",
        "must_contain_any": ["online", "status", "running", "operational", "active", "ready"],
        "must_not_contain": [],
    },
    {
        "category": "agent_coordination",
        "system": "You are BlackSwan in the Office Terminal — the command center for The Underground Circle.",
        "question": "What agents are available?",
        "must_contain_any": ["agent", "available", "BlackSwan", "command"],
        "must_not_contain": [],
    },

    # Goal setting
    {
        "category": "goal_setting",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "How should I set my daily intention?",
        "must_contain_any": ["intention", "focus", "one", "clear", "specific", "priority", "day"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Personality checks
    {
        "category": "personality",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "Are you an AI?",
        "must_contain_any": ["BlackSwan"],
        "must_not_contain": ["I'm just an AI", "as an AI", "I am an AI", "artificial intelligence", "language model"],
    },
    {
        "category": "personality",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "yo what's good BlackSwan",
        "must_contain_any": [],  # Just checking it responds casually
        "must_not_contain": ["I'm just an AI", "How can I assist you today"],
    },

    # General knowledge
    {
        "category": "general",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "What is The Underground Circle?",
        "must_contain_any": ["accountability", "productivity", "circle", "builder"],
        "must_not_contain": ["I'm just an AI", "I don't know"],
    },
    {
        "category": "general",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "What are streaks and why do they matter?",
        "must_contain_any": ["streak", "check", "consisten", "day", "habit"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Design & UI/UX
    {
        "category": "design_ux",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "My landing page looks cluttered. How do I fix the visual hierarchy?",
        "must_contain_any": ["hierarch", "space", "contrast", "font", "layout", "size", "align", "white"],
        "must_not_contain": ["I'm just an AI"],
    },
    {
        "category": "design_ux",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "How do I pick a good color palette for a dark-mode UI?",
        "must_contain_any": ["color", "dark", "contrast", "background", "accent", "palette", "#"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Coding & Technical
    {
        "category": "coding_technical",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "Should I use REST or GraphQL for my new project?",
        "must_contain_any": ["REST", "GraphQL", "endpoint", "query", "API", "schema", "depend"],
        "must_not_contain": ["I'm just an AI"],
    },
    {
        "category": "coding_technical",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "My React app is slow. Where do I start optimizing?",
        "must_contain_any": ["render", "memo", "profil", "component", "bundle", "lazy", "state", "useCallback"],
        "must_not_contain": ["I'm just an AI"],
    },

    # Art & Creative
    {
        "category": "art_creative",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "I need a brand identity for my startup. Where do I begin?",
        "must_contain_any": ["brand", "logo", "color", "identity", "font", "visual", "tone", "value"],
        "must_not_contain": ["I'm just an AI"],
    },

    # General Knowledge (expanded)
    {
        "category": "general_knowledge",
        "system": "You are BlackSwan — an AI accountability partner in The Underground Circle.",
        "question": "What's the most underrated mental model for decision-making?",
        "must_contain_any": ["model", "decision", "think", "framework", "bias", "inversion", "second"],
        "must_not_contain": ["I'm just an AI"],
    },
]


def load_eval_data():
    """Load eval JSONL."""
    if not EVAL_FILE.exists():
        return []
    items = []
    with open(EVAL_FILE) as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    return items


def generate_response(model, tokenizer, system_prompt, user_message, max_new_tokens=300):
    """Generate a response from the model."""
    from unsloth.chat_templates import get_chat_template

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )

    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        temperature=0.7,
        top_p=0.9,
        do_sample=True,
        pad_token_id=tokenizer.eos_token_id,
    )

    # Decode only the generated tokens
    generated = outputs[0][inputs["input_ids"].shape[1]:]
    response = tokenizer.decode(generated, skip_special_tokens=True).strip()
    return response


def score_response(response, test_case):
    """Score a response against test criteria."""
    response_lower = response.lower()
    score = 0
    max_score = 0
    details = []

    # Check must_contain_any
    if test_case["must_contain_any"]:
        max_score += 1
        found = any(kw.lower() in response_lower for kw in test_case["must_contain_any"])
        if found:
            score += 1
            details.append("✓ Contains expected keywords")
        else:
            details.append(f"✗ Missing keywords: {test_case['must_contain_any']}")

    # Check must_not_contain
    if test_case["must_not_contain"]:
        max_score += 1
        violations = [kw for kw in test_case["must_not_contain"] if kw.lower() in response_lower]
        if not violations:
            score += 1
            details.append("✓ No forbidden phrases")
        else:
            details.append(f"✗ Contains forbidden: {violations}")

    # Length check (not too short, not too long)
    max_score += 1
    if 10 < len(response) < 2000:
        score += 1
        details.append(f"✓ Good length ({len(response)} chars)")
    else:
        details.append(f"✗ Bad length ({len(response)} chars)")

    # Coherence check (no repetition)
    max_score += 1
    words = response.split()
    if len(words) > 5:
        # Check for excessive word repetition
        from collections import Counter
        word_counts = Counter(w.lower() for w in words if len(w) > 3)
        max_repeat = max(word_counts.values()) if word_counts else 0
        if max_repeat < len(words) * 0.3:
            score += 1
            details.append("✓ No excessive repetition")
        else:
            details.append("✗ Excessive word repetition detected")
    else:
        score += 1
        details.append("✓ Short response (skip repetition check)")

    return score, max_score, details


def eval_perplexity(model, tokenizer, eval_data, max_samples=100):
    """Compute average perplexity on eval set."""
    import torch

    total_loss = 0
    count = 0

    for item in eval_data[:max_samples]:
        convs = item.get("conversations", [])
        messages = []
        for turn in convs:
            role_map = {"system": "system", "human": "user", "gpt": "assistant"}
            role = role_map.get(turn["from"], turn["from"])
            messages.append({"role": role, "content": turn["value"]})

        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=4096).to(model.device)

        with torch.no_grad():
            outputs = model(**inputs, labels=inputs["input_ids"])
            total_loss += outputs.loss.item()
            count += 1

    avg_loss = total_loss / max(count, 1)
    perplexity = 2.71828 ** avg_loss  # e^loss
    return perplexity, avg_loss


def main():
    parser = argparse.ArgumentParser(description="Evaluate BlackSwan LLM")
    parser.add_argument("--model-path", default="models/v1.0/lora", help="Path to LoRA adapters")
    parser.add_argument("--base-model", default="unsloth/Qwen2.5-7B-Instruct-bnb-4bit")
    parser.add_argument("--skip-perplexity", action="store_true")
    parser.add_argument("--skip-generation", action="store_true")
    args = parser.parse_args()

    model_path = Path(__file__).parent / args.model_path

    print("Loading model...")
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(model_path),
        max_seq_length=4096,
        dtype=None,
        load_in_4bit=True,
    )
    tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")
    FastLanguageModel.for_inference(model)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    results = {"perplexity": None, "domain_tests": [], "summary": {}}

    # ─── Perplexity ──────────────────────────────────────────────────────────
    if not args.skip_perplexity:
        print("\n═══ Perplexity Evaluation ═══")
        eval_data = load_eval_data()
        if eval_data:
            ppl, avg_loss = eval_perplexity(model, tokenizer, eval_data)
            print(f"  Eval samples: {min(len(eval_data), 100)}")
            print(f"  Avg loss: {avg_loss:.4f}")
            print(f"  Perplexity: {ppl:.2f}")
            results["perplexity"] = {"value": ppl, "avg_loss": avg_loss, "samples": min(len(eval_data), 100)}
        else:
            print("  No eval data found, skipping.")

    # ─── Domain test questions ───────────────────────────────────────────────
    if not args.skip_generation:
        print("\n═══ Domain Test Questions ═══")
        total_score = 0
        total_max = 0
        category_scores = {}

        for i, test in enumerate(TEST_QUESTIONS):
            print(f"\n[{i+1}/{len(TEST_QUESTIONS)}] ({test['category']}) {test['question'][:60]}...")

            start = time.time()
            response = generate_response(model, tokenizer, test["system"], test["question"])
            latency = time.time() - start

            score, max_score, details = score_response(response, test)
            total_score += score
            total_max += max_score

            cat = test["category"]
            if cat not in category_scores:
                category_scores[cat] = {"score": 0, "max": 0}
            category_scores[cat]["score"] += score
            category_scores[cat]["max"] += max_score

            result = {
                "category": test["category"],
                "question": test["question"],
                "response": response,
                "score": score,
                "max_score": max_score,
                "latency_ms": round(latency * 1000),
                "details": details,
            }
            results["domain_tests"].append(result)

            # Print condensed result
            pct = (score / max_score * 100) if max_score > 0 else 0
            status = "✓" if pct >= 75 else "~" if pct >= 50 else "✗"
            print(f"  {status} Score: {score}/{max_score} ({pct:.0f}%) | {latency:.1f}s")
            print(f"  Response: {response[:120]}...")
            for detail in details:
                if detail.startswith("✗"):
                    print(f"    {detail}")

        # Summary
        print(f"\n═══ Summary ═══")
        overall_pct = (total_score / total_max * 100) if total_max > 0 else 0
        print(f"Overall: {total_score}/{total_max} ({overall_pct:.1f}%)")

        for cat, scores in sorted(category_scores.items()):
            pct = (scores["score"] / scores["max"] * 100) if scores["max"] > 0 else 0
            print(f"  {cat}: {scores['score']}/{scores['max']} ({pct:.0f}%)")

        results["summary"] = {
            "overall_score": total_score,
            "overall_max": total_max,
            "overall_pct": round(overall_pct, 1),
            "category_scores": {
                cat: round(s["score"] / s["max"] * 100, 1) if s["max"] > 0 else 0
                for cat, s in category_scores.items()
            },
        }

    # Save results
    results_file = RESULTS_DIR / "eval_results.json"
    with open(results_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nResults saved to {results_file}")


if __name__ == "__main__":
    main()
