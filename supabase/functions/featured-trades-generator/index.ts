// Featured Trades Generator — Edge Function
// Two-pass AI pipeline: Gemini (research) → Claude (analysis with Trader spirit)
// Generates 3-5 daily trade ideas with real market data

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { getAuthenticatedUser, resolveUserModelApiKey } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Token Registry (real Solana mainnet mints) ─────────────────────────────
// Hardcoded to prevent AI from inventing fake addresses

const TOKEN_REGISTRY: Record<string, { mint: string; decimals: number; coingeckoId?: string }> = {
  SOL:   { mint: 'So11111111111111111111111111111111111111112', decimals: 9, coingeckoId: 'solana' },
  USDC:  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, coingeckoId: 'usd-coin' },
  USDT:  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, coingeckoId: 'tether' },
  JUP:   { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, coingeckoId: 'jupiter-exchange-solana' },
  BONK:  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, coingeckoId: 'bonk' },
  RAY:   { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, coingeckoId: 'raydium' },
  JTO:   { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9, coingeckoId: 'jito-governance-token' },
  PYTH:  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6, coingeckoId: 'pyth-network' },
  WIF:   { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, coingeckoId: 'dogwifcoin' },
  RNDR:  { mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', decimals: 8, coingeckoId: 'render-token' },
  HNT:   { mint: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', decimals: 8, coingeckoId: 'helium' },
  W:     { mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', decimals: 6, coingeckoId: 'wormhole' },
  ORCA:  { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, coingeckoId: 'orca' },
  MNDE:  { mint: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', decimals: 9, coingeckoId: 'marinade' },
  TENSOR:{ mint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', decimals: 9, coingeckoId: 'tensor' },
};

const VALID_SYMBOLS = Object.keys(TOKEN_REGISTRY);
const GEMINI_RESEARCH_MODEL = "gemini-3.6-flash";

// ─── Trader Spirit Knowledge (condensed for prompt) ─────────────────────────

const TRADER_SPIRIT = `You are the Apex Trader — an institutional-grade crypto trading analyst.

MARKET MICROSTRUCTURE: Analyze order flow, bid-ask spreads, TWAP/VWAP, slippage (σ×√(Q/V)). On Solana: Jupiter routes through Raydium/Orca/Phoenix, watch concentrated liquidity ranges.

QUANT STRATEGIES: Statistical arbitrage, funding rate arbitrage (Jupiter Perps vs Drift), basis trading, liquidation cascade detection, mean reversion, momentum factors.

RISK MANAGEMENT: Kelly criterion for position sizing, portfolio VaR, max drawdown limits, correlation matrices. Never suggest more than 5% of portfolio per trade.

ON-CHAIN SIGNALS: MVRV ratio, NUPL, SOPR, exchange flows, whale wallet movements, stablecoin supply changes, DEX volume trends.

MACRO AWARENESS: BTC dominance, DXY correlation, Fear & Greed index, ETF flow data, stablecoin market cap as dry powder indicator.

SOLANA ECOSYSTEM: Jupiter (DEX aggregator), Raydium (AMM), Drift (perps), Marinade (liquid staking), Jito (MEV), Tensor (NFTs), Pyth (oracles).

OUTPUT FORMAT: For each trade idea provide:
- Clear title and direction (buy/sell)
- Entry reasoning with specific data points
- Risk level (low/moderate/high)
- Expected return % and timeframe
- Stop loss level
- Exit strategy`;

// ─── Main Handler ───────────────────────────────────────────────────────────

function isAutonomousAiPaused(): boolean {
  const raw = (Deno.env.get("AUTONOMOUS_AI_PAUSED") || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Global kill switch (see _shared rationale). Trade-suggestion
  // generation is always autonomous, so the whole function is gated.
  if (isAutonomousAiPaused()) {
    console.warn("[featured-trades-generator] AUTONOMOUS_AI_PAUSED — skipping.");
    return new Response(JSON.stringify({ skipped: true, reason: "autonomous_ai_paused" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceRole = Boolean(token && token === supabaseKey);
    const authUser = isServiceRole ? null : await getAuthenticatedUser(req);
    if (!isServiceRole && authUser?.id !== userId) {
      return new Response(JSON.stringify({ error: "Valid JWT required for requested userId" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const geminiKey = (await resolveUserModelApiKey({
      supabase,
      userId,
      provider: "google_ai",
      envVarName: "GEMINI_API_KEY",
    }))?.apiKey || "";
    const anthropicKey = (await resolveUserModelApiKey({
      supabase,
      userId,
      provider: "anthropic",
      envVarName: "ANTHROPIC_API_KEY",
    }))?.apiKey || "";

    // ── Step 1: Load past learnings ──────────────────────────────────────────
    const { data: learnings } = await supabase
      .from("spirit_learnings")
      .select("title, content, confidence_score, times_correct, times_applied")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("confidence_score", { ascending: false })
      .limit(10);

    const learningContext = (learnings || []).length > 0
      ? `\n\nPAST LEARNINGS (from previous trades):\n${(learnings || []).map((l: any) =>
          `- ${l.title}: ${l.content} (confidence: ${(l.confidence_score * 100).toFixed(0)}%, ${l.times_correct}/${l.times_applied} correct)`
        ).join("\n")}`
      : "";

    // ── Step 2: Gemini Research Pass ─────────────────────────────────────────
    // Uses Google Search grounding for real-time market data
    let researchData = "";

    if (geminiKey) {
      try {
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0];
        const hourStr = now.getHours().toString().padStart(2, "0");

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_RESEARCH_MODEL}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `It is ${dateStr} ${hourStr}:00 UTC. You are a crypto market research assistant.

Search for the LATEST data on these Solana ecosystem tokens: ${VALID_SYMBOLS.join(", ")}

For each token you find notable activity on, provide:
1. Current price and 24h change %
2. Notable news or catalysts (launches, partnerships, listings, upgrades)
3. On-chain activity (volume spikes, whale movements, TVL changes)
4. Social sentiment (X/Twitter buzz, community activity)
5. Any upcoming events (token unlocks, governance votes, product launches)

Also check:
- Overall crypto market sentiment (Fear & Greed index, BTC price action)
- Solana network metrics (TPS, active addresses, DEX volume)
- Any major macro events affecting crypto today

Return a detailed market research report. Be specific with numbers and data points.`,
                }],
              }],
              tools: [{ google_search: {} }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 3000,
              },
            }),
            signal: AbortSignal.timeout(25000),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          researchData = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
      } catch (e) {
        console.error("[featured-trades] Gemini research failed:", e);
      }
    }

    // ── Step 3: Claude Analysis Pass ─────────────────────────────────────────
    // Uses Trader spirit + research data to generate trade ideas

    const analysisPrompt = `${TRADER_SPIRIT}${learningContext}

AVAILABLE TOKENS (you MUST only use these exact symbols):
${VALID_SYMBOLS.join(", ")}

MARKET RESEARCH DATA:
${researchData || "No real-time data available. Generate conservative ideas based on general Solana ecosystem knowledge."}

Based on this research, generate 3-5 featured trade ideas for today. Mix timeframes (scalp, day, swing).

For EACH trade, output a JSON object with these fields:
- title: string (catchy, max 50 chars, e.g. "SOL Momentum Breakout")
- description: string (2-3 sentence analysis)
- direction: "buy" | "sell"
- confidence: "high" | "medium" | "low"
- timeframe: "scalp" | "day" | "swing" | "position"
- input_symbol: string (must be from available tokens — what you're selling)
- output_symbol: string (must be from available tokens — what you're buying)
- suggested_amount_sol: number (0.05 to 2.0)
- risk_level: "low" | "moderate" | "high"
- expected_return_pct: number (realistic, 1-30%)
- stop_loss_pct: number (1-15%)
- entry_reasoning: string (specific data-driven reasoning)
- exit_strategy: string (when to take profit)

Return ONLY a JSON array of trade objects. No markdown, no explanation outside the JSON.`;

    let trades: any[] = [];

    if (anthropicKey) {
      try {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 2000,
            messages: [{
              role: "user",
              content: analysisPrompt,
            }],
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (claudeRes.ok) {
          const claudeData = await claudeRes.json();
          const text = claudeData?.content?.[0]?.text || "";
          const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
          trades = JSON.parse(cleaned);
        }
      } catch (e) {
        console.error("[featured-trades] Claude analysis failed:", e);
      }
    }

    // Fallback: try Gemini for analysis if Claude failed
    if (trades.length === 0 && geminiKey) {
      try {
        const fallbackRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_RESEARCH_MODEL}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: analysisPrompt }],
              }],
              generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 2000,
              },
            }),
            signal: AbortSignal.timeout(20000),
          }
        );

        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
          trades = JSON.parse(cleaned);
        }
      } catch (e) {
        console.error("[featured-trades] Gemini fallback failed:", e);
      }
    }

    if (!Array.isArray(trades) || trades.length === 0) {
      return new Response(JSON.stringify({ error: "No trades generated", trades: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Step 4: Validate & Store ─────────────────────────────────────────────

    const validTrades = trades
      .filter((t: any) => {
        const inputOk = VALID_SYMBOLS.includes(t.input_symbol);
        const outputOk = VALID_SYMBOLS.includes(t.output_symbol);
        return inputOk && outputOk && t.title && t.description;
      })
      .slice(0, 5);

    const sequenceId = crypto.randomUUID();

    const inserts = validTrades.map((t: any, i: number) => ({
      user_id: userId,
      title: t.title?.slice(0, 100) || "Trade Idea",
      description: t.description?.slice(0, 500) || "",
      trade_type: validTrades.length > 1 ? "sequence" : "swap",
      direction: t.direction === "sell" ? "sell" : "buy",
      confidence: ["high", "medium", "low"].includes(t.confidence) ? t.confidence : "medium",
      timeframe: ["scalp", "day", "swing", "position"].includes(t.timeframe) ? t.timeframe : "day",
      input_mint: TOKEN_REGISTRY[t.input_symbol]?.mint || TOKEN_REGISTRY.SOL.mint,
      output_mint: TOKEN_REGISTRY[t.output_symbol]?.mint || TOKEN_REGISTRY.USDC.mint,
      input_symbol: t.input_symbol,
      output_symbol: t.output_symbol,
      suggested_amount_sol: Math.min(Math.max(t.suggested_amount_sol || 0.1, 0.01), 5.0),
      suggested_slippage_bps: 200,
      sequence_id: validTrades.length > 1 ? sequenceId : null,
      sequence_order: i,
      entry_reasoning: t.entry_reasoning?.slice(0, 500) || null,
      exit_strategy: t.exit_strategy?.slice(0, 300) || null,
      risk_level: ["low", "moderate", "high", "extreme"].includes(t.risk_level) ? t.risk_level : "moderate",
      expected_return_pct: Math.min(t.expected_return_pct || 5, 100),
      stop_loss_pct: Math.min(t.stop_loss_pct || 5, 50),
      generated_by: anthropicKey ? "gemini+claude" : "gemini",
      research_sources: researchData ? [{ type: "gemini_search", summary: researchData.slice(0, 200) }] : [],
      spirit_learnings_used: (learnings || []).map((l: any) => l.title),
      status: "active",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("featured_trades")
      .insert(inserts)
      .select("id, title, direction, confidence, timeframe, input_symbol, output_symbol, suggested_amount_sol, risk_level, expected_return_pct");

    if (insertErr) {
      console.error("[featured-trades] Insert error:", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      trades: inserted || [],
      research_summary: researchData?.slice(0, 300) || null,
      learnings_applied: (learnings || []).length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[featured-trades] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
