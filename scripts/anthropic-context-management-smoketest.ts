/**
 * anthropic-context-management-smoketest — verifies the pure config builder in
 * src/lib/anthropicContextManagement.ts that feeds the swanbot-ai relay's
 * FLAG-DARK `context_management` (clear_tool_uses) passthrough.
 *
 * Invariants under test:
 *   1. buildClearToolUsesConfig() defaults match the documented
 *      clear_tool_uses_20250919 schema exactly (trigger 100K / keep 3 /
 *      clear_at_least 20K, results-only).
 *   2. Bounds: out-of-range trigger/keep/clear_at_least are CLAMPED, not
 *      thrown; degenerate inputs (NaN, strings, null, wrong types) fall back
 *      to defaults.
 *   3. clear_at_least is always kept strictly below trigger (satisfiable clear).
 *   4. clear_tool_inputs only appears when explicitly true.
 *   5. shouldAttachContextManagement gates OFF by default and ON only via the
 *      documented opt-in (mode flag OR an existing config object).
 *   6. CONTEXT_MANAGEMENT_BETA_HEADER const is present and well-formed; the
 *      strategy type and beta header are DIFFERENT tokens.
 *   7. normalizeClientContextManagement validates/normalizes a client config
 *      and rejects junk.
 *   8. appendContextManagementBeta merges without clobbering existing betas.
 *   9. resolveContextManagementConfig forwards a client config or defaults.
 *
 * Run: npx tsx scripts/anthropic-context-management-smoketest.ts
 */

import assert from "node:assert/strict";

let passCount = 0;
function pass(label: string) {
  passCount += 1;
  console.log(`PASS ${passCount}: ${label}`);
}

async function main() {
  const {
    buildClearToolUsesConfig,
    shouldAttachContextManagement,
    normalizeClientContextManagement,
    resolveContextManagementConfig,
    appendContextManagementBeta,
    CONTEXT_MANAGEMENT_BETA_HEADER,
    CLEAR_TOOL_USES_STRATEGY_TYPE,
    TRIGGER_MIN,
    TRIGGER_MAX,
    TRIGGER_DEFAULT,
    KEEP_MIN,
    KEEP_MAX,
    KEEP_DEFAULT,
    CLEAR_AT_LEAST_MIN,
    CLEAR_AT_LEAST_DEFAULT,
  } = await import("../src/lib/anthropicContextManagement");

  // ── 1. Default config shape matches the documented schema exactly ─────────
  {
    const cfg = buildClearToolUsesConfig();
    assert.ok(Array.isArray(cfg.edits), "edits is an array");
    assert.equal(cfg.edits.length, 1, "exactly one edit by default");
    const e = cfg.edits[0];
    assert.equal(e.type, "clear_tool_uses_20250919", "strategy type literal");
    assert.deepEqual(
      e.trigger,
      { type: "input_tokens", value: 100_000 },
      "default trigger",
    );
    assert.deepEqual(e.keep, { type: "tool_uses", value: 3 }, "default keep");
    assert.deepEqual(
      e.clear_at_least,
      { type: "input_tokens", value: 20_000 },
      "default clear_at_least",
    );
    pass("default config matches documented clear_tool_uses schema");
  }

  // ── 1b. Defaults line up with exported constants ──────────────────────────
  {
    const e = buildClearToolUsesConfig().edits[0];
    assert.equal(e.trigger.value, TRIGGER_DEFAULT, "trigger == TRIGGER_DEFAULT");
    assert.equal(e.keep.value, KEEP_DEFAULT, "keep == KEEP_DEFAULT");
    assert.equal(
      e.clear_at_least.value,
      CLEAR_AT_LEAST_DEFAULT,
      "clear_at_least == CLEAR_AT_LEAST_DEFAULT",
    );
    pass("default values equal the exported default constants");
  }

  // ── 2. clear_tool_inputs absent unless explicitly true ────────────────────
  {
    const off = buildClearToolUsesConfig().edits[0];
    assert.equal(
      "clear_tool_inputs" in off,
      false,
      "clear_tool_inputs omitted by default",
    );
    const offExplicitFalse = buildClearToolUsesConfig({
      clearToolInputs: false,
    }).edits[0];
    assert.equal(
      "clear_tool_inputs" in offExplicitFalse,
      false,
      "clear_tool_inputs stays omitted when false",
    );
    const on = buildClearToolUsesConfig({ clearToolInputs: true }).edits[0];
    assert.equal(on.clear_tool_inputs, true, "clear_tool_inputs true when set");
    pass("clear_tool_inputs only present when explicitly true");
  }

  // ── 3. Overrides within range are honored verbatim ────────────────────────
  {
    const e = buildClearToolUsesConfig({
      triggerInputTokens: 120_000,
      keepToolUses: 5,
      clearAtLeastInputTokens: 30_000,
    }).edits[0];
    assert.equal(e.trigger.value, 120_000, "trigger override honored");
    assert.equal(e.keep.value, 5, "keep override honored");
    assert.equal(e.clear_at_least.value, 30_000, "clear_at_least override honored");
    pass("in-range overrides pass through unchanged");
  }

  // ── 4. trigger clamps low and high ────────────────────────────────────────
  {
    assert.equal(
      buildClearToolUsesConfig({ triggerInputTokens: 1 }).edits[0].trigger.value,
      TRIGGER_MIN,
      "trigger clamps up to TRIGGER_MIN",
    );
    assert.equal(
      buildClearToolUsesConfig({ triggerInputTokens: 999_999 }).edits[0].trigger
        .value,
      TRIGGER_MAX,
      "trigger clamps down to TRIGGER_MAX",
    );
    assert.equal(
      buildClearToolUsesConfig({ triggerInputTokens: -50_000 }).edits[0].trigger
        .value,
      TRIGGER_MIN,
      "negative trigger clamps to TRIGGER_MIN",
    );
    pass("trigger out-of-range values are clamped, not rejected");
  }

  // ── 5. keep clamps to [1,10] ──────────────────────────────────────────────
  {
    assert.equal(
      buildClearToolUsesConfig({ keepToolUses: 0 }).edits[0].keep.value,
      KEEP_MIN,
      "keep 0 clamps to KEEP_MIN",
    );
    assert.equal(
      buildClearToolUsesConfig({ keepToolUses: 100 }).edits[0].keep.value,
      KEEP_MAX,
      "keep 100 clamps to KEEP_MAX",
    );
    assert.equal(
      buildClearToolUsesConfig({ keepToolUses: -3 }).edits[0].keep.value,
      KEEP_MIN,
      "negative keep clamps to KEEP_MIN",
    );
    pass("keep out-of-range values clamp to [1,10]");
  }

  // ── 6. clear_at_least floor enforced ──────────────────────────────────────
  {
    assert.equal(
      buildClearToolUsesConfig({ clearAtLeastInputTokens: 100 }).edits[0]
        .clear_at_least.value,
      CLEAR_AT_LEAST_MIN,
      "clear_at_least clamps up to floor",
    );
    assert.equal(
      buildClearToolUsesConfig({ clearAtLeastInputTokens: -1 }).edits[0]
        .clear_at_least.value,
      CLEAR_AT_LEAST_MIN,
      "negative clear_at_least clamps to floor",
    );
    pass("clear_at_least is floored at CLEAR_AT_LEAST_MIN");
  }

  // ── 7. clear_at_least never meets/exceeds trigger (satisfiable clear) ─────
  {
    // Ask for a clear_at_least larger than the (clamped) trigger.
    const e = buildClearToolUsesConfig({
      triggerInputTokens: 20_000, // clamps to TRIGGER_MIN (20K)
      clearAtLeastInputTokens: 500_000,
    }).edits[0];
    assert.ok(
      e.clear_at_least.value < e.trigger.value,
      `clear_at_least (${e.clear_at_least.value}) must be < trigger (${e.trigger.value})`,
    );
    assert.ok(
      e.clear_at_least.value >= CLEAR_AT_LEAST_MIN,
      "clear_at_least stays >= floor even when pulled below trigger",
    );
    pass("clear_at_least is forced strictly below trigger when they collide");
  }

  // ── 8. Non-integer / float inputs are floored ─────────────────────────────
  {
    const e = buildClearToolUsesConfig({
      triggerInputTokens: 100_000.9,
      keepToolUses: 3.7,
      clearAtLeastInputTokens: 20_000.5,
    }).edits[0];
    assert.equal(e.trigger.value, 100_000, "float trigger floored");
    assert.equal(e.keep.value, 3, "float keep floored");
    assert.equal(e.clear_at_least.value, 20_000, "float clear_at_least floored");
    pass("non-integer numeric inputs are floored to whole token counts");
  }

  // ── 9. Numeric strings coerced ────────────────────────────────────────────
  {
    const e = buildClearToolUsesConfig({
      triggerInputTokens: "150000" as unknown as number,
      keepToolUses: "4" as unknown as number,
    }).edits[0];
    assert.equal(e.trigger.value, 150_000, "numeric string trigger coerced");
    assert.equal(e.keep.value, 4, "numeric string keep coerced");
    pass("numeric strings coerce to numbers");
  }

  // ── 10. Degenerate inputs never throw; fall back to defaults ──────────────
  {
    const degenerate: unknown[] = [
      undefined,
      null,
      {},
      { triggerInputTokens: NaN, keepToolUses: NaN, clearAtLeastInputTokens: NaN },
      { triggerInputTokens: Infinity },
      { triggerInputTokens: "abc", keepToolUses: "xyz" },
      { triggerInputTokens: {}, keepToolUses: [], clearAtLeastInputTokens: {} },
      { keepToolUses: () => 5 },
      [] as unknown,
      "not an object" as unknown,
      42 as unknown,
    ];
    for (const d of degenerate) {
      const cfg = buildClearToolUsesConfig(d as any);
      assert.equal(cfg.edits.length, 1, "always exactly one edit");
      const e = cfg.edits[0];
      assert.equal(e.type, "clear_tool_uses_20250919", "type stays correct");
      assert.ok(
        Number.isInteger(e.trigger.value) &&
          e.trigger.value >= TRIGGER_MIN &&
          e.trigger.value <= TRIGGER_MAX,
        "trigger stays a valid integer in range",
      );
      assert.ok(
        Number.isInteger(e.keep.value) &&
          e.keep.value >= KEEP_MIN &&
          e.keep.value <= KEEP_MAX,
        "keep stays a valid integer in range",
      );
      assert.ok(
        Number.isInteger(e.clear_at_least.value) &&
          e.clear_at_least.value >= CLEAR_AT_LEAST_MIN,
        "clear_at_least stays a valid integer >= floor",
      );
    }
    pass("degenerate builder inputs never throw and stay in-range");
  }

  // ── 11. shouldAttachContextManagement: OFF by default ─────────────────────
  {
    const offCases: unknown[] = [
      undefined,
      null,
      {},
      { message: "hi", tools: [] },
      { context_management_mode: undefined },
      { context_management_mode: null },
      { context_management_mode: "" },
      { context_management_mode: "compact_everything" }, // unknown mode ('compact' itself is a P49 opt-in, asserted in case 33)
      { context_management_mode: "clear_thinking" }, // different strategy
      { context_management_mode: true }, // wrong type
      { context_management: null },
      { context_management: {} }, // no edits
      { context_management: { edits: [] } }, // empty edits
      { context_management: { edits: "nope" } },
      { context_management: { edits: [{ type: "totally_unknown_edit" }] } }, // unknown strategy
      "string" as unknown,
      42 as unknown,
    ];
    for (const c of offCases) {
      assert.equal(
        shouldAttachContextManagement(c),
        false,
        `should be OFF: ${JSON.stringify(c)}`,
      );
    }
    // X3 (P49): an explicit compact_20260112 config is now a recognized
    // opt-in (it was "wrong strategy → OFF" before compaction support).
    assert.equal(
      shouldAttachContextManagement({ context_management: { edits: [{ type: "compact_20260112" }] } }),
      true,
      "explicit compaction config opts in (P49 behavior change, deliberate)",
    );
    pass("shouldAttachContextManagement defaults OFF for all non-opt-in inputs");
  }

  // ── 12. shouldAttachContextManagement: ON via mode flag ───────────────────
  {
    assert.equal(
      shouldAttachContextManagement({
        context_management_mode: "clear_tool_uses",
      }),
      true,
      "mode flag opts in",
    );
    assert.equal(
      shouldAttachContextManagement({
        message: "hello",
        tools: [{ name: "x", description: "y", input_schema: {} }],
        context_management_mode: "clear_tool_uses",
      }),
      true,
      "mode flag opts in alongside other fields",
    );
    pass("shouldAttachContextManagement ON when mode === clear_tool_uses");
  }

  // ── 13. shouldAttachContextManagement: ON via client config object ────────
  {
    assert.equal(
      shouldAttachContextManagement({
        context_management: {
          edits: [{ type: "clear_tool_uses_20250919" }],
        },
      }),
      true,
      "recognizable client config opts in",
    );
    pass("shouldAttachContextManagement ON when a valid config is provided");
  }

  // ── 14. Beta header const present, well-formed, distinct from strategy ────
  {
    assert.equal(
      typeof CONTEXT_MANAGEMENT_BETA_HEADER,
      "string",
      "beta header is a string",
    );
    assert.ok(
      CONTEXT_MANAGEMENT_BETA_HEADER.length > 0,
      "beta header is non-empty",
    );
    assert.ok(
      /^context-management-\d{4}-\d{2}-\d{2}$/.test(
        CONTEXT_MANAGEMENT_BETA_HEADER,
      ),
      `beta header looks like a dated beta token: ${CONTEXT_MANAGEMENT_BETA_HEADER}`,
    );
    // The beta header and the strategy type are DIFFERENT tokens.
    assert.notEqual(
      CONTEXT_MANAGEMENT_BETA_HEADER,
      CLEAR_TOOL_USES_STRATEGY_TYPE,
      "beta header != strategy type",
    );
    assert.equal(
      CLEAR_TOOL_USES_STRATEGY_TYPE,
      "clear_tool_uses_20250919",
      "strategy type literal is stable",
    );
    pass("beta header const present and distinct from the strategy type");
  }

  // ── 15. appendContextManagementBeta: adds when no existing header ─────────
  {
    assert.equal(
      appendContextManagementBeta(undefined),
      CONTEXT_MANAGEMENT_BETA_HEADER,
      "undefined existing -> just the beta",
    );
    assert.equal(
      appendContextManagementBeta(null),
      CONTEXT_MANAGEMENT_BETA_HEADER,
      "null existing -> just the beta",
    );
    assert.equal(
      appendContextManagementBeta(""),
      CONTEXT_MANAGEMENT_BETA_HEADER,
      "empty existing -> just the beta",
    );
    pass("appendContextManagementBeta seeds the header when none exists");
  }

  // ── 16. appendContextManagementBeta: merges without clobbering ────────────
  {
    const merged = appendContextManagementBeta("prompt-caching-2024-07-31");
    const tokens = merged.split(",").map((t) => t.trim());
    assert.ok(
      tokens.includes("prompt-caching-2024-07-31"),
      "existing beta preserved",
    );
    assert.ok(
      tokens.includes(CONTEXT_MANAGEMENT_BETA_HEADER),
      "context-management beta added",
    );
    assert.equal(tokens.length, 2, "exactly two betas, comma-joined");
    pass("appendContextManagementBeta merges without clobbering existing betas");
  }

  // ── 17. appendContextManagementBeta: idempotent (no duplicate) ────────────
  {
    const once = appendContextManagementBeta(CONTEXT_MANAGEMENT_BETA_HEADER);
    assert.equal(
      once,
      CONTEXT_MANAGEMENT_BETA_HEADER,
      "already-present beta is not duplicated",
    );
    const withOther = appendContextManagementBeta(
      `something-else, ${CONTEXT_MANAGEMENT_BETA_HEADER}`,
    );
    const count = withOther
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t === CONTEXT_MANAGEMENT_BETA_HEADER).length;
    assert.equal(count, 1, "beta appears exactly once even if already there");
    pass("appendContextManagementBeta is idempotent (de-dupes)");
  }

  // ── 18. normalizeClientContextManagement: accepts full spec form ──────────
  {
    const normalized = normalizeClientContextManagement({
      edits: [
        {
          type: "clear_tool_uses_20250919",
          trigger: { type: "input_tokens", value: 130_000 },
          keep: { type: "tool_uses", value: 4 },
          clear_at_least: { type: "input_tokens", value: 25_000 },
        },
      ],
    });
    assert.ok(normalized, "valid spec normalizes to non-null");
    const e = normalized!.edits[0];
    assert.equal(e.trigger.value, 130_000, "trigger preserved");
    assert.equal(e.keep.value, 4, "keep preserved");
    assert.equal(e.clear_at_least.value, 25_000, "clear_at_least preserved");
    pass("normalizeClientContextManagement accepts a well-formed spec");
  }

  // ── 19. normalizeClientContextManagement: clamps out-of-range client values
  {
    const normalized = normalizeClientContextManagement({
      edits: [
        {
          type: "clear_tool_uses_20250919",
          trigger: { type: "input_tokens", value: 5_000_000 }, // too high
          keep: { type: "tool_uses", value: 999 }, // too high
          clear_at_least: { type: "input_tokens", value: 1 }, // too low
        },
      ],
    });
    assert.ok(normalized, "still normalizes");
    const e = normalized!.edits[0];
    assert.equal(e.trigger.value, TRIGGER_MAX, "client trigger clamped high");
    assert.equal(e.keep.value, KEEP_MAX, "client keep clamped high");
    assert.equal(
      e.clear_at_least.value,
      CLEAR_AT_LEAST_MIN,
      "client clear_at_least clamped to floor",
    );
    pass("normalizeClientContextManagement re-clamps out-of-range client values");
  }

  // ── 20. normalizeClientContextManagement: bare-number specs accepted ──────
  {
    const normalized = normalizeClientContextManagement({
      edits: [
        {
          type: "clear_tool_uses_20250919",
          trigger: 110_000,
          keep: 2,
          clear_at_least: 15_000,
        },
      ],
    });
    assert.ok(normalized, "bare-number spec normalizes");
    const e = normalized!.edits[0];
    assert.equal(e.trigger.value, 110_000, "bare trigger read");
    assert.equal(e.keep.value, 2, "bare keep read");
    assert.equal(e.clear_at_least.value, 15_000, "bare clear_at_least read");
    pass("normalizeClientContextManagement accepts bare-number spec fields");
  }

  // ── 21. normalizeClientContextManagement: rejects junk (returns null) ─────
  {
    const junk: unknown[] = [
      null,
      undefined,
      {},
      { edits: [] },
      { edits: "x" },
      { edits: [null] },
      // (compact_20260112 is a recognized edit since P49 — asserted in case 34)
      { edits: [{ type: "clear_thinking_20251015" }] },
      { edits: [{}] },
      "string" as unknown,
      123 as unknown,
    ];
    for (const j of junk) {
      assert.equal(
        normalizeClientContextManagement(j),
        null,
        `should reject: ${JSON.stringify(j)}`,
      );
    }
    pass("normalizeClientContextManagement returns null for junk / wrong strategy");
  }

  // ── 22. normalizeClientContextManagement: partial edit fills defaults ─────
  {
    // A recognized strategy edit with NO numeric fields should still normalize
    // (missing fields fall back to builder defaults).
    const normalized = normalizeClientContextManagement({
      edits: [{ type: "clear_tool_uses_20250919" }],
    });
    assert.ok(normalized, "bare recognized edit normalizes");
    const e = normalized!.edits[0];
    assert.equal(e.trigger.value, TRIGGER_DEFAULT, "missing trigger -> default");
    assert.equal(e.keep.value, KEEP_DEFAULT, "missing keep -> default");
    assert.equal(
      e.clear_at_least.value,
      CLEAR_AT_LEAST_DEFAULT,
      "missing clear_at_least -> default",
    );
    pass("normalizeClientContextManagement fills missing fields with defaults");
  }

  // ── 23. normalizeClientContextManagement: skips unrecognized, keeps valid ─
  {
    const normalized = normalizeClientContextManagement({
      edits: [
        { type: "clear_thinking_20251015" }, // not this builder's strategy
        {
          type: "clear_tool_uses_20250919",
          keep: { type: "tool_uses", value: 6 },
        },
      ],
    });
    assert.ok(normalized, "keeps the recognized edit");
    assert.equal(normalized!.edits.length, 1, "only the clear_tool_uses edit");
    assert.equal(normalized!.edits[0].keep.value, 6, "its keep preserved");
    pass("normalizeClientContextManagement drops unrecognized edits, keeps valid");
  }

  // ── 24. resolveContextManagementConfig: forwards client config ────────────
  {
    const cfg = resolveContextManagementConfig({
      context_management: {
        edits: [
          {
            type: "clear_tool_uses_20250919",
            trigger: { type: "input_tokens", value: 140_000 },
          },
        ],
      },
    });
    assert.equal(
      cfg.edits[0].trigger.value,
      140_000,
      "client trigger forwarded",
    );
    pass("resolveContextManagementConfig forwards a valid client config");
  }

  // ── 25. resolveContextManagementConfig: defaults when no/invalid config ───
  {
    const fromNothing = resolveContextManagementConfig({
      context_management_mode: "clear_tool_uses",
    });
    assert.equal(
      fromNothing.edits[0].trigger.value,
      TRIGGER_DEFAULT,
      "no config -> default trigger",
    );
    // P49: a compact config is now RECOGNIZED — it resolves to a normalized
    // compaction edit (was "unrecognized → clear_tool_uses default" pre-P49).
    const fromCompact = resolveContextManagementConfig({
      context_management: { edits: [{ type: "compact_20260112" }] },
    });
    assert.equal(fromCompact.edits[0].type, "compact_20260112",
      "explicit compact config resolves to a compaction edit");
    const fromJunk = resolveContextManagementConfig({
      context_management: { edits: [{ type: "clear_thinking_20251015" }] },
    });
    assert.equal(
      fromJunk.edits[0].trigger.value,
      TRIGGER_DEFAULT,
      "unrecognized config -> default (never empty)",
    );
    const fromUndefined = resolveContextManagementConfig(undefined);
    assert.equal(
      fromUndefined.edits[0].type,
      "clear_tool_uses_20250919",
      "undefined body -> default config",
    );
    pass("resolveContextManagementConfig falls back to defaults, never empty");
  }

  // ── 26. resolveContextManagementConfig: honors builder default overrides ──
  {
    const cfg = resolveContextManagementConfig(
      { context_management_mode: "clear_tool_uses" },
      { keepToolUses: 7 },
    );
    assert.equal(
      cfg.edits[0].keep.value,
      7,
      "default-override applies when no client config",
    );
    pass("resolveContextManagementConfig applies caller default overrides");
  }

  // ── 27. Builder output is JSON-serializable (relay sends JSON.stringify) ──
  {
    const cfg = buildClearToolUsesConfig({ clearToolInputs: true });
    const round = JSON.parse(JSON.stringify(cfg));
    assert.deepEqual(round, cfg, "config survives JSON round-trip unchanged");
    pass("built config is JSON-serializable and stable through a round-trip");
  }

  // ── 28. No shared mutable state between builder calls ─────────────────────
  {
    const a = buildClearToolUsesConfig();
    const b = buildClearToolUsesConfig({ keepToolUses: 9 });
    assert.equal(a.edits[0].keep.value, 3, "first call unaffected by second");
    assert.equal(b.edits[0].keep.value, 9, "second call has its own value");
    assert.notEqual(a.edits, b.edits, "each call returns a fresh edits array");
    pass("builder returns independent objects (no shared mutable state)");
  }

  // ═══ X3 (P49): server-side compaction (compact_20260112) ═══════════════════
  const {
    buildCompactionConfig,
    isCompactionSupportedModel,
    stripUnsupportedCompactionEdits,
    requiredContextManagementBetas,
    appendContextManagementBetasForConfig,
    isCompactionContentBlock,
    containsCompactionBlock,
    COMPACTION_BETA_HEADER,
    COMPACTION_STRATEGY_TYPE,
    COMPACTION_STOP_REASON,
    COMPACT_TRIGGER_MIN,
    COMPACT_TRIGGER_DEFAULT,
    COMPACT_TRIGGER_MAX,
    MAX_COMPACTION_INSTRUCTIONS_CHARS,
  } = await import("../src/lib/anthropicContextManagement");

  // ── 29. Compaction wire constants match the documented tokens ─────────────
  {
    assert.equal(COMPACTION_STRATEGY_TYPE, "compact_20260112");
    assert.equal(COMPACTION_BETA_HEADER, "compact-2026-01-12");
    assert.notEqual(COMPACTION_BETA_HEADER, CONTEXT_MANAGEMENT_BETA_HEADER,
      "compaction and context-editing are DIFFERENT betas");
    assert.equal(COMPACTION_STOP_REASON, "compaction");
    assert.equal(COMPACT_TRIGGER_MIN, 50_000, "documented API floor");
    assert.equal(COMPACT_TRIGGER_DEFAULT, 150_000, "documented default");
    pass("compaction constants match the documented wire tokens");
  }

  // ── 30. buildCompactionConfig defaults + bounds ────────────────────────────
  {
    const cfg = buildCompactionConfig();
    assert.equal(cfg.edits.length, 1);
    const edit = cfg.edits[0] as any;
    assert.equal(edit.type, COMPACTION_STRATEGY_TYPE);
    assert.deepEqual(edit.trigger, { type: "input_tokens", value: COMPACT_TRIGGER_DEFAULT });
    assert.equal("pause_after_compaction" in edit, false, "pause omitted by default");
    assert.equal("instructions" in edit, false, "instructions omitted by default");

    const low = buildCompactionConfig({ triggerInputTokens: 10 }).edits[0] as any;
    assert.equal(low.trigger.value, COMPACT_TRIGGER_MIN, "trigger clamped to documented floor");
    const high = buildCompactionConfig({ triggerInputTokens: 5_000_000 }).edits[0] as any;
    assert.equal(high.trigger.value, COMPACT_TRIGGER_MAX, "trigger clamped to ceiling");
    const junk = buildCompactionConfig({ triggerInputTokens: NaN }).edits[0] as any;
    assert.equal(junk.trigger.value, COMPACT_TRIGGER_DEFAULT, "NaN falls back to default");

    const paused = buildCompactionConfig({ pauseAfterCompaction: true }).edits[0] as any;
    assert.equal(paused.pause_after_compaction, true);
    const longInstructions = buildCompactionConfig({ instructions: "x".repeat(9000) }).edits[0] as any;
    assert.equal(longInstructions.instructions.length, MAX_COMPACTION_INSTRUCTIONS_CHARS,
      "instructions bounded");
    pass("buildCompactionConfig defaults, clamps, and optional-field emission");
  }

  // ── 31. Model gate — documented list only, fail closed ───────────────────
  {
    for (const ok of ["claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-5", "claude-mythos-5"]) {
      assert.equal(isCompactionSupportedModel(ok), true, `${ok} supported`);
    }
    for (const no of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-opus-4-5-20251101", "deepseek/deepseek-chat", "auto", "", null, undefined]) {
      assert.equal(isCompactionSupportedModel(no as any), false, `${String(no)} unsupported (fail closed)`);
    }
    pass("compaction model gate matches the documented list, unknown → false");
  }

  // ── 32. stripUnsupportedCompactionEdits — the relay's fail-closed gate ────
  {
    const compactOnly = buildCompactionConfig();
    assert.equal(stripUnsupportedCompactionEdits(compactOnly, "claude-sonnet-4-6"), compactOnly,
      "supported model passes the config through untouched");
    assert.equal(stripUnsupportedCompactionEdits(compactOnly, "claude-haiku-4-5"), null,
      "unsupported model + compact-only config → null (attach nothing)");
    const mixed = normalizeClientContextManagement({
      edits: [
        { type: COMPACTION_STRATEGY_TYPE },
        { type: CLEAR_TOOL_USES_STRATEGY_TYPE, trigger: 100_000, keep: 3, clear_at_least: 20_000 },
      ],
    })!;
    const strippedMixed = stripUnsupportedCompactionEdits(mixed, "claude-haiku-4-5")!;
    assert.equal(strippedMixed.edits.length, 1, "mixed config keeps clear_tool_uses on Haiku");
    assert.equal(strippedMixed.edits[0].type, CLEAR_TOOL_USES_STRATEGY_TYPE);
    assert.equal(mixed.edits.length, 2, "input config never mutated");
    assert.equal(stripUnsupportedCompactionEdits(null, "claude-opus-4-8"), null, "null config → null");
    pass("stripUnsupportedCompactionEdits fail-closes compact edits per model");
  }

  // ── 33. Mode opt-in + resolve for 'compact' ────────────────────────────────
  {
    assert.equal(shouldAttachContextManagement({ context_management_mode: "compact" }), true);
    assert.equal(shouldAttachContextManagement({ context_management_mode: "compact_all" }), false,
      "unknown mode strings stay dark");
    const resolved = resolveContextManagementConfig({ context_management_mode: "compact" });
    assert.equal(resolved.edits.length, 1);
    assert.equal(resolved.edits[0].type, COMPACTION_STRATEGY_TYPE,
      "mode 'compact' resolves to the compaction default config");
    const legacy = resolveContextManagementConfig({ context_management_mode: "clear_tool_uses" });
    assert.equal(legacy.edits[0].type, CLEAR_TOOL_USES_STRATEGY_TYPE,
      "mode 'clear_tool_uses' unchanged (P28 behavior preserved)");
    pass("mode 'compact' opts in and resolves to the compaction default");
  }

  // ── 34. normalizeClientContextManagement accepts compact edits ────────────
  {
    const normalized = normalizeClientContextManagement({
      edits: [
        { type: CLEAR_TOOL_USES_STRATEGY_TYPE, trigger: 90_000, keep: 2, clear_at_least: 15_000 },
        { type: COMPACTION_STRATEGY_TYPE, trigger: { type: "input_tokens", value: 30_000 }, pause_after_compaction: true },
        { type: "bogus_edit_20990101" },
      ],
    })!;
    assert.equal(normalized.edits.length, 2, "bogus edit types dropped");
    assert.equal(normalized.edits[0].type, COMPACTION_STRATEGY_TYPE,
      "compaction ordered FIRST (summarize before pruning)");
    const compactEdit = normalized.edits[0] as any;
    assert.equal(compactEdit.trigger.value, COMPACT_TRIGGER_MIN,
      "client trigger below floor clamped up");
    assert.equal(compactEdit.pause_after_compaction, true, "pause carried");
    assert.equal(normalized.edits[1].type, CLEAR_TOOL_USES_STRATEGY_TYPE);
    pass("client configs with compact edits normalize, clamp, and order compaction-first");
  }

  // ── 34b. Duplicate same-type edits dedupe (first occurrence of each wins) ─
  // Neither Anthropic doc defines duplicate-type semantics; forwarding
  // duplicates could turn a sloppy opted-in client config into a 400.
  {
    const deduped = normalizeClientContextManagement({
      edits: [
        { type: COMPACTION_STRATEGY_TYPE, trigger: 200_000 },
        { type: COMPACTION_STRATEGY_TYPE, trigger: 300_000 },
        { type: CLEAR_TOOL_USES_STRATEGY_TYPE, keep: 5 },
        { type: CLEAR_TOOL_USES_STRATEGY_TYPE, keep: 9 },
      ],
    })!;
    assert.ok(deduped, "duplicate-heavy config still normalizes");
    assert.equal(deduped.edits.length, 2,
      "exactly one edit per type survives (compact,compact,clear,clear → 2)");
    assert.equal(deduped.edits[0].type, COMPACTION_STRATEGY_TYPE,
      "compaction still ordered FIRST after dedupe");
    assert.equal((deduped.edits[0] as any).trigger.value, 200_000,
      "first compaction occurrence wins");
    assert.equal(deduped.edits[1].type, CLEAR_TOOL_USES_STRATEGY_TYPE,
      "clear_tool_uses second");
    assert.equal((deduped.edits[1] as any).keep.value, 5,
      "first clear_tool_uses occurrence wins");
    pass("duplicate same-type edits dedupe to one of each, compact first");
  }

  // ── 35. Beta-token derivation per config ─────────────────────────────────
  {
    assert.deepEqual(requiredContextManagementBetas(buildCompactionConfig()), [COMPACTION_BETA_HEADER],
      "compact-only config needs ONLY the compaction beta");
    assert.deepEqual(requiredContextManagementBetas(buildClearToolUsesConfig()), [CONTEXT_MANAGEMENT_BETA_HEADER],
      "clear-only config needs ONLY the context-editing beta");
    const mixed = normalizeClientContextManagement({
      edits: [
        { type: COMPACTION_STRATEGY_TYPE },
        { type: CLEAR_TOOL_USES_STRATEGY_TYPE, trigger: 100_000, keep: 3, clear_at_least: 20_000 },
      ],
    })!;
    assert.deepEqual(requiredContextManagementBetas(mixed), [COMPACTION_BETA_HEADER, CONTEXT_MANAGEMENT_BETA_HEADER]);
    assert.equal(requiredContextManagementBetas(null).length, 0);

    const merged = appendContextManagementBetasForConfig("prompt-caching-2024", buildCompactionConfig());
    assert.equal(merged, `prompt-caching-2024, ${COMPACTION_BETA_HEADER}`,
      "existing betas preserved, compaction token appended");
    assert.equal(
      appendContextManagementBetasForConfig(COMPACTION_BETA_HEADER, buildCompactionConfig()),
      COMPACTION_BETA_HEADER,
      "already-present token not duplicated");
    pass("beta tokens derive from the config's edit types exactly");
  }

  // ── 36. Response-side compaction block helpers ────────────────────────────
  {
    const content = [
      { type: "compaction", content: "Summary of the conversation..." },
      { type: "text", text: "Based on our conversation so far..." },
    ];
    assert.equal(isCompactionContentBlock(content[0]), true);
    assert.equal(isCompactionContentBlock(content[1]), false);
    assert.equal(containsCompactionBlock(content), true);
    assert.equal(containsCompactionBlock([{ type: "text", text: "hi" }]), false);
    assert.equal(containsCompactionBlock("not an array"), false);
    assert.equal(containsCompactionBlock(null), false);
    pass("compaction content-block detection (the client preservation contract's eyes)");
  }

  console.log(`\nAll ${passCount} context-management smoke assertions passed.`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
