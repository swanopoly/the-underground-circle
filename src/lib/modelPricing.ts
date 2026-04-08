/**
 * modelPricing.ts — Single source of truth for AI model pricing
 *
 * Swan's directive: ALWAYS over-estimate. Includes ~25% buffer above
 * published rates to account for retries, system prompts, tool tokens.
 *
 * Pricing per 1M tokens (input / output / cached-input).
 * Cached input tokens are billed at 10% of full input rate.
 *
 * Updated: Feb 2026
 */

export interface ModelRate {
  inPer1M:        number;  // $/1M full input tokens
  outPer1M:       number;  // $/1M output tokens
  cachedInPer1M:  number;  // $/1M cached input tokens (typically 10% of inPer1M)
  label:          string;
}

export const MODEL_PRICING: Record<string, ModelRate> = {
  // ── Claude Opus ───────────────────────────────────────────────────────────
  'claude-opus-4-6':  { inPer1M: 20,    outPer1M: 100,   cachedInPer1M: 2.0,   label: 'Claude Opus 4.6'  },
  'claude-opus-4-5':  { inPer1M: 18,    outPer1M: 90,    cachedInPer1M: 1.8,   label: 'Claude Opus 4.5'  },
  'claude-opus-4':    { inPer1M: 18,    outPer1M: 90,    cachedInPer1M: 1.8,   label: 'Claude Opus 4'    },
  'claude-opus-3-7':  { inPer1M: 18,    outPer1M: 90,    cachedInPer1M: 1.8,   label: 'Claude Opus 3.7'  },
  'claude-opus-3-5':  { inPer1M: 18,    outPer1M: 90,    cachedInPer1M: 1.8,   label: 'Claude Opus 3.5'  },
  'claude-opus':      { inPer1M: 18,    outPer1M: 90,    cachedInPer1M: 1.8,   label: 'Claude Opus'      },
  // ── Claude Sonnet ─────────────────────────────────────────────────────────
  'claude-sonnet-4-6':{ inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Claude Sonnet 4.6'},
  'claude-sonnet-4-5':{ inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Claude Sonnet 4.5'},
  'claude-sonnet-4':  { inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Claude Sonnet 4'  },
  'claude-sonnet-3-7':{ inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Claude Sonnet 3.7'},
  'claude-sonnet-3-5':{ inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Claude Sonnet 3.5'},
  'claude-sonnet':    { inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Claude Sonnet'    },
  // ── Claude Haiku ──────────────────────────────────────────────────────────
  'claude-haiku-4-5': { inPer1M: 1.25,  outPer1M: 6.25,  cachedInPer1M: 0.125, label: 'Claude Haiku 4.5' },
  'claude-haiku-3-5': { inPer1M: 1.00,  outPer1M: 5.00,  cachedInPer1M: 0.10,  label: 'Claude Haiku 3.5' },
  'claude-haiku':     { inPer1M: 0.30,  outPer1M: 1.50,  cachedInPer1M: 0.03,  label: 'Claude Haiku'     },
  // ── Gemini ────────────────────────────────────────────────────────────────
  'gemini-2-5-pro':   { inPer1M: 1.25,  outPer1M: 10.0,  cachedInPer1M: 0.31,  label: 'Gemini 2.5 Pro'   },
  'gemini-2-5-flash': { inPer1M: 0.15,  outPer1M: 0.60,  cachedInPer1M: 0.02,  label: 'Gemini 2.5 Flash' },
  'gemini-2-5-flash-lite': { inPer1M: 0.04, outPer1M: 0.15, cachedInPer1M: 0.01, label: 'Gemini 2.5 Flash Lite' },
  'gemini-2-flash':   { inPer1M: 0.10,  outPer1M: 0.40,  cachedInPer1M: 0.01,  label: 'Gemini 2 Flash'   },
  'gemini-flash':     { inPer1M: 0.10,  outPer1M: 0.40,  cachedInPer1M: 0.01,  label: 'Gemini Flash'     },
  'gemini-pro':       { inPer1M: 1.25,  outPer1M: 10.0,  cachedInPer1M: 0.31,  label: 'Gemini Pro'       },
  'gemini':           { inPer1M: 1.25,  outPer1M: 10.0,  cachedInPer1M: 0.31,  label: 'Gemini'           },
  // ── OpenAI ────────────────────────────────────────────────────────────────
  'gpt-4-1':          { inPer1M: 2.00,  outPer1M: 8.00,  cachedInPer1M: 0.50,  label: 'GPT-4.1'          },
  'gpt-4-1-mini':     { inPer1M: 0.40,  outPer1M: 1.60,  cachedInPer1M: 0.10,  label: 'GPT-4.1 Mini'     },
  'gpt-4-1-nano':     { inPer1M: 0.10,  outPer1M: 0.40,  cachedInPer1M: 0.025, label: 'GPT-4.1 Nano'     },
  'gpt-4o-mini':      { inPer1M: 0.15,  outPer1M: 0.60,  cachedInPer1M: 0.075, label: 'GPT-4o Mini'      },
  'gpt-4o':           { inPer1M: 2.50,  outPer1M: 10.0,  cachedInPer1M: 1.25,  label: 'GPT-4o'           },
  'gpt-4':            { inPer1M: 3.00,  outPer1M: 12.0,  cachedInPer1M: 0.30,  label: 'GPT-4'            },
  'o3':               { inPer1M: 10.0,  outPer1M: 40.0,  cachedInPer1M: 2.50,  label: 'OpenAI o3'        },
  'o4-mini':          { inPer1M: 1.10,  outPer1M: 4.40,  cachedInPer1M: 0.28,  label: 'O4 Mini'          },
  'o1':               { inPer1M: 15.0,  outPer1M: 60.0,  cachedInPer1M: 7.50,  label: 'OpenAI o1'        },
  'o3-mini':          { inPer1M: 1.10,  outPer1M: 4.40,  cachedInPer1M: 0.55,  label: 'o3 Mini'          },
  // ── Groq ─────────────────────────────────────────────────────────────────
  'llama-3.3-70b':    { inPer1M: 0.59,  outPer1M: 0.79,  cachedInPer1M: 0.06,  label: 'Llama 3.3 70B'    },
  'mixtral-8x7b':     { inPer1M: 0.24,  outPer1M: 0.24,  cachedInPer1M: 0.02,  label: 'Mixtral 8x7B'     },
  // ── Ollama (self-hosted) ─────────────────────────────────────────────────
  'ollama':           { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'Ollama (Local)'    },
  // ── Replicate ────────────────────────────────────────────────────────────
  'flux-schnell':     { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'Flux Schnell'      },
  'flux-dev':         { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'Flux Dev'          },
  'stable-diffusion-xl': { inPer1M: 0,  outPer1M: 0,     cachedInPer1M: 0,     label: 'Stable Diffusion XL' },
  'stable-diffusion': { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'Stable Diffusion'  },
  // ── BlackSwan (self-hosted, zero cost) ────────────────────────────────────
  'blackswan-7b':     { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'BlackSwan 7B'     },
  'blackswan-4b':     { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'BlackSwan 4B'     },
  'blackswan':        { inPer1M: 0,     outPer1M: 0,     cachedInPer1M: 0,     label: 'BlackSwan'        },
  // ── Default fallback ──────────────────────────────────────────────────────
  'default':          { inPer1M: 4,     outPer1M: 20,    cachedInPer1M: 0.4,   label: 'Unknown Model'    },
};

/** Resolve a model string to its rate entry (longest-key match wins) */
export function resolveModelRate(model: string | undefined): ModelRate {
  if (!model) return MODEL_PRICING['default'];
  const m = model
    .toLowerCase()
    .replace(/\./g, '-')          // normalize 4.6 → 4-6
    .replace(/^[a-z]+\//, '');    // strip provider prefix

  let bestKey = 'default';
  let bestLen = 0;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key === 'default') continue;
    if (m.includes(key) && key.length > bestLen) {
      bestKey = key;
      bestLen = key.length;
    }
  }
  return MODEL_PRICING[bestKey];
}

/**
 * Estimate cost for a session given cumulative cache-aware token counts.
 *   cachedTokens — prompt-cache hits (billed at cachedInPer1M)
 *   newTokens    — non-cached input tokens (billed at inPer1M)
 *   outputTokens — output tokens (billed at outPer1M)
 */
export function estimateCostWithCache(
  model: string | undefined,
  cachedTokens: number,
  newTokens:    number,
  outputTokens: number,
): number {
  const rate = resolveModelRate(model);
  return (
    cachedTokens * rate.cachedInPer1M +
    newTokens    * rate.inPer1M +
    outputTokens * rate.outPer1M
  ) / 1_000_000;
}

/**
 * Simple estimate when only total input/output counts are known (no cache split).
 * Assumes 80% cache hit rate as a conservative estimate (lowers cost estimate).
 * We intentionally use full input price for ALL tokens to over-estimate safely.
 */
export function estimateCost(
  model: string | undefined,
  inputTokens:  number,
  outputTokens: number,
): number {
  const rate = resolveModelRate(model);
  return (inputTokens * rate.inPer1M + outputTokens * rate.outPer1M) / 1_000_000;
}
