import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
const BOT_WALLET_PROVIDER = "solana_bot_wallet";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_SOL_RESERVE_LAMPORTS = 15_000_000;
const MAX_WALLET_USAGE_BPS = 8500;
const CONFIDENCE_RANK = {
  low: 1,
  medium: 2,
  high: 3,
} as const;

type Action = "status" | "create_wallet" | "set_status" | "execute_swap" | "get_config" | "save_config" | "run_autopilot";
type StrategyMode = "hybrid" | "featured_only" | "queue_only";
type ConfidenceLevel = "high" | "medium" | "low";

type BotWalletRow = {
  id: string;
  user_id: string;
  circle_id: string;
  public_key: string;
  label: string;
  status: "active" | "paused" | "archived";
  last_balance_lamports: number;
  last_funded_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
};

type BotConfigRow = {
  id: string;
  user_id: string;
  circle_id: string;
  is_enabled: boolean;
  strategy_mode: StrategyMode;
  min_confidence: ConfidenceLevel;
  max_trade_sol: number | string;
  max_daily_trades: number;
  allow_featured_trades: boolean;
  allow_pending_actions: boolean;
  slippage_bps_cap: number;
  auto_pause_on_error: boolean;
  last_run_at?: string | null;
  last_trade_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

type PendingActionRow = {
  id: string;
  user_id: string;
  circle_id?: string | null;
  action_type: string;
  input_mint: string;
  output_mint: string;
  amount_lamports: number;
  slippage_bps: number;
  max_price?: number | string | null;
  reason?: string | null;
  proposed_by?: string | null;
  source?: string | null;
  expires_at: string;
  created_at: string;
};

type FeaturedTradeRow = {
  id: string;
  title: string;
  trade_type: string;
  confidence: ConfidenceLevel;
  input_mint: string;
  output_mint: string;
  input_symbol: string;
  output_symbol: string;
  suggested_amount_sol: number | string;
  suggested_slippage_bps: number;
  expected_return_pct?: number | string | null;
  risk_level?: string | null;
  generated_by?: string | null;
  expires_at: string;
  created_at: string;
};

type Candidate = {
  kind: "pending" | "featured";
  id: string;
  title: string;
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  reason?: string | null;
  actionType?: string;
  proposedBy?: string | null;
  source?: string | null;
  confidence?: ConfidenceLevel;
  expectedReturnPct?: number;
  generatedBy?: string | null;
};

type BotConfigResponse = {
  id?: string | null;
  circleId: string;
  isEnabled: boolean;
  strategyMode: StrategyMode;
  minConfidence: ConfidenceLevel;
  maxTradeSol: number;
  maxDailyTrades: number;
  allowFeaturedTrades: boolean;
  allowPendingActions: boolean;
  slippageBpsCap: number;
  autoPauseOnError: boolean;
  lastRunAt?: string | null;
  lastTradeAt?: string | null;
  lastError?: string | null;
  updatedAt: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function extractApiKey(data: any): string | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data[0]?.api_key || data[0]?.apiKey || null;
  }
  if (typeof data === "string") return data;
  return data.api_key || data.apiKey || null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function coerceNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeStrategyMode(value: any): StrategyMode {
  return value === "featured_only" || value === "queue_only" ? value : "hybrid";
}

function sanitizeConfidence(value: any): ConfidenceLevel {
  return value === "medium" || value === "low" ? value : "high";
}

function getDefaultConfig(circleId: string): BotConfigResponse {
  return {
    id: null,
    circleId,
    isEnabled: false,
    strategyMode: "hybrid",
    minConfidence: "high",
    maxTradeSol: 0.25,
    maxDailyTrades: 3,
    allowFeaturedTrades: true,
    allowPendingActions: true,
    slippageBpsCap: 150,
    autoPauseOnError: true,
    lastRunAt: null,
    lastTradeAt: null,
    lastError: null,
    updatedAt: nowIso(),
  };
}

function mapConfig(row: BotConfigRow | null, circleId: string): BotConfigResponse {
  if (!row) return getDefaultConfig(circleId);
  return {
    id: row.id,
    circleId,
    isEnabled: Boolean(row.is_enabled),
    strategyMode: sanitizeStrategyMode(row.strategy_mode),
    minConfidence: sanitizeConfidence(row.min_confidence),
    maxTradeSol: coerceNumber(row.max_trade_sol, 0.25),
    maxDailyTrades: Math.max(1, Math.floor(coerceNumber(row.max_daily_trades, 3))),
    allowFeaturedTrades: row.allow_featured_trades !== false,
    allowPendingActions: row.allow_pending_actions !== false,
    slippageBpsCap: Math.max(25, Math.floor(coerceNumber(row.slippage_bps_cap, 150))),
    autoPauseOnError: row.auto_pause_on_error !== false,
    lastRunAt: row.last_run_at || null,
    lastTradeAt: row.last_trade_at || null,
    lastError: row.last_error || null,
    updatedAt: row.updated_at || nowIso(),
  };
}

function confidenceAllowed(confidence: ConfidenceLevel | null | undefined, minConfidence: ConfidenceLevel): boolean {
  const nextConfidence = sanitizeConfidence(confidence || "low");
  return CONFIDENCE_RANK[nextConfidence] >= CONFIDENCE_RANK[minConfidence];
}

function mapActionTypeToTradeLogAction(actionType?: string): string {
  return actionType === "dca_buy" ? "dca_buy" : "swap";
}

function getSpendableLamports(balanceLamports: number): number {
  const cappedByBalance = Math.floor(balanceLamports * MAX_WALLET_USAGE_BPS / 10000);
  const cappedByReserve = Math.max(0, balanceLamports - MIN_SOL_RESERVE_LAMPORTS);
  return Math.max(0, Math.min(cappedByBalance, cappedByReserve));
}

function scoreFeaturedCandidate(candidate: Candidate, riskLevel?: string | null): number {
  const confidenceScore = CONFIDENCE_RANK[sanitizeConfidence(candidate.confidence || "medium")] * 100;
  const expectedReturnScore = (candidate.expectedReturnPct || 0) * 4;
  const riskPenalty = riskLevel === "extreme"
    ? 120
    : riskLevel === "high"
      ? 40
      : riskLevel === "moderate"
        ? 10
        : 0;
  return confidenceScore + expectedReturnScore - riskPenalty;
}

async function getBotWalletRow(serviceClient: any, userId: string, circleId: string): Promise<BotWalletRow | null> {
  const { data } = await serviceClient
    .from("trading_bot_wallets")
    .select("*")
    .eq("user_id", userId)
    .eq("circle_id", circleId)
    .maybeSingle();
  return (data || null) as BotWalletRow | null;
}

async function getBotConfigRow(serviceClient: any, userId: string, circleId: string): Promise<BotConfigRow | null> {
  const { data } = await serviceClient
    .from("trading_bot_configs")
    .select("*")
    .eq("user_id", userId)
    .eq("circle_id", circleId)
    .maybeSingle();
  return (data || null) as BotConfigRow | null;
}

async function upsertBotConfig(serviceClient: any, userId: string, circleId: string, patch: Record<string, any>): Promise<BotConfigRow> {
  const existing = await getBotConfigRow(serviceClient, userId, circleId);
  const defaults = getDefaultConfig(circleId);
  const payload = {
    user_id: userId,
    circle_id: circleId,
    is_enabled: typeof patch.isEnabled === "boolean" ? patch.isEnabled : existing?.is_enabled ?? defaults.isEnabled,
    strategy_mode: sanitizeStrategyMode(patch.strategyMode ?? existing?.strategy_mode ?? defaults.strategyMode),
    min_confidence: sanitizeConfidence(patch.minConfidence ?? existing?.min_confidence ?? defaults.minConfidence),
    max_trade_sol: Math.max(0.01, coerceNumber(patch.maxTradeSol, coerceNumber(existing?.max_trade_sol, defaults.maxTradeSol))),
    max_daily_trades: Math.max(1, Math.floor(coerceNumber(patch.maxDailyTrades, coerceNumber(existing?.max_daily_trades, defaults.maxDailyTrades)))),
    allow_featured_trades: typeof patch.allowFeaturedTrades === "boolean" ? patch.allowFeaturedTrades : existing?.allow_featured_trades ?? defaults.allowFeaturedTrades,
    allow_pending_actions: typeof patch.allowPendingActions === "boolean" ? patch.allowPendingActions : existing?.allow_pending_actions ?? defaults.allowPendingActions,
    slippage_bps_cap: Math.max(25, Math.floor(coerceNumber(patch.slippageBpsCap, coerceNumber(existing?.slippage_bps_cap, defaults.slippageBpsCap)))),
    auto_pause_on_error: typeof patch.autoPauseOnError === "boolean" ? patch.autoPauseOnError : existing?.auto_pause_on_error ?? defaults.autoPauseOnError,
    last_run_at: patch.lastRunAt !== undefined ? patch.lastRunAt : existing?.last_run_at ?? defaults.lastRunAt,
    last_trade_at: patch.lastTradeAt !== undefined ? patch.lastTradeAt : existing?.last_trade_at ?? defaults.lastTradeAt,
    last_error: patch.lastError !== undefined ? patch.lastError : existing?.last_error ?? defaults.lastError,
  };

  const { data, error } = await serviceClient
    .from("trading_bot_configs")
    .upsert(payload, { onConflict: "user_id,circle_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to save bot config");
  }

  return data as BotConfigRow;
}

async function getBotWalletSecret(serviceClient: any, userId: string, circleId: string): Promise<string | null> {
  const { data, error } = await serviceClient.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: BOT_WALLET_PROVIDER,
    p_label: `circle:${circleId}`,
  });
  if (error) return null;
  return extractApiKey(data);
}

async function getRpcUrl(serviceClient: any, userId: string): Promise<string> {
  const { data } = await serviceClient.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: "helius",
    p_label: null,
  });
  const apiKey = extractApiKey(data) || Deno.env.get("HELIUS_API_KEY") || Deno.env.get("EXPO_PUBLIC_HELIUS_API_KEY") || "";
  return apiKey ? `https://mainnet.helius-rpc.com/?api-key=${apiKey}` : DEFAULT_RPC_URL;
}

async function hydrateWallet(serviceClient: any, row: BotWalletRow, userId: string) {
  const rpcUrl = await getRpcUrl(serviceClient, userId);
  const connection = new Connection(rpcUrl, "confirmed");
  let balanceLamports = row.last_balance_lamports || 0;
  try {
    balanceLamports = await connection.getBalance(new PublicKey(row.public_key), "confirmed");
  } catch {
    balanceLamports = row.last_balance_lamports || 0;
  }

  const updatePayload: Record<string, any> = {
    last_balance_lamports: balanceLamports,
    updated_at: new Date().toISOString(),
  };
  if (balanceLamports > 0 && !row.last_funded_at) {
    updatePayload.last_funded_at = new Date().toISOString();
  }

  await serviceClient
    .from("trading_bot_wallets")
    .update(updatePayload)
    .eq("id", row.id);

  return {
    id: row.id,
    address: row.public_key,
    label: row.label,
    status: row.status,
    balanceLamports,
    balanceSol: balanceLamports / 1e9,
    lastFundedAt: row.last_funded_at || updatePayload.last_funded_at || null,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
  };
}

async function createWallet(serviceClient: any, userId: string, circleId: string) {
  const existing = await getBotWalletRow(serviceClient, userId, circleId);
  if (existing) {
    return hydrateWallet(serviceClient, existing, userId);
  }

  const keypair = Keypair.generate();
  const secretKeyBase64 = bytesToBase64(keypair.secretKey);

  const { error: storeError } = await serviceClient.rpc("store_user_api_key_for_user", {
    p_user_id: userId,
    p_provider: BOT_WALLET_PROVIDER,
    p_api_key: secretKeyBase64,
    p_label: `circle:${circleId}`,
    p_endpoint: JSON.stringify({ public_key: keypair.publicKey.toBase58(), circle_id: circleId }),
  });

  if (storeError) {
    throw new Error(storeError.message || "Failed to store bot wallet secret");
  }

  const { data, error } = await serviceClient
    .from("trading_bot_wallets")
    .insert({
      user_id: userId,
      circle_id: circleId,
      public_key: keypair.publicKey.toBase58(),
      label: "Autopilot Wallet",
      status: "active",
      last_balance_lamports: 0,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create bot wallet metadata");
  }

  return hydrateWallet(serviceClient, data as BotWalletRow, userId);
}

async function setWalletStatus(serviceClient: any, userId: string, circleId: string, status: "active" | "paused") {
  const { data, error } = await serviceClient
    .from("trading_bot_wallets")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("circle_id", circleId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update bot wallet status");
  }

  return hydrateWallet(serviceClient, data as BotWalletRow, userId);
}

async function executeSwap(serviceClient: any, userId: string, circleId: string, body: any) {
  const row = await getBotWalletRow(serviceClient, userId, circleId);
  if (!row) throw new Error("Bot wallet not found for this circle");
  if (row.status !== "active") throw new Error("Bot wallet is paused");

  const secretKeyBase64 = await getBotWalletSecret(serviceClient, userId, circleId);
  if (!secretKeyBase64) throw new Error("Bot wallet secret is unavailable");

  const keypair = Keypair.fromSecretKey(base64ToBytes(secretKeyBase64));
  const rpcUrl = await getRpcUrl(serviceClient, userId);
  const connection = new Connection(rpcUrl, "confirmed");

  const inputMint = String(body.inputMint || "");
  const outputMint = String(body.outputMint || "");
  const amount = Number(body.amount || 0);
  const slippageBps = Math.max(25, Number(body.slippageBps || 150));
  if (!inputMint || !outputMint || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("inputMint, outputMint, and amount are required");
  }

  const quoteUrl = new URL(JUPITER_QUOTE_URL);
  quoteUrl.searchParams.set("inputMint", inputMint);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", String(Math.floor(amount)));
  quoteUrl.searchParams.set("slippageBps", String(Math.floor(slippageBps)));
  quoteUrl.searchParams.set("dynamicSlippage", "true");

  const quoteResp = await fetch(quoteUrl.toString());
  if (!quoteResp.ok) {
    throw new Error(`Jupiter quote failed: ${quoteResp.status}`);
  }
  const quote = await quoteResp.json();

  const swapResp = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!swapResp.ok) {
    throw new Error(`Jupiter swap build failed: ${swapResp.status}`);
  }

  const swapData = await swapResp.json();
  if (!swapData?.swapTransaction) {
    throw new Error("Jupiter did not return a swap transaction");
  }

  const transaction = VersionedTransaction.deserialize(base64ToBytes(swapData.swapTransaction));
  transaction.sign([keypair]);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 5,
  });
  await connection.confirmTransaction(signature, "confirmed");

  await serviceClient
    .from("trading_bot_wallets")
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", row.id);

  return {
    success: true,
    txHash: signature,
    walletAddress: row.public_key,
    inputAmount: quote.inAmount,
    outputAmount: quote.outAmount,
    routePlan: quote.routePlan || [],
  };
}

async function getTradesExecutedToday(serviceClient: any, walletAddress: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await serviceClient
    .from("trading_log")
    .select("id", { count: "exact", head: true })
    .eq("wallet_address", walletAddress)
    .eq("status", "success")
    .gte("created_at", dayStart.toISOString());
  return count || 0;
}

async function listPendingCandidates(
  serviceClient: any,
  userId: string,
  circleId: string,
  config: BotConfigResponse,
  maxTradeLamports: number,
): Promise<Candidate[]> {
  if (!config.allowPendingActions) return [];
  const { data } = await serviceClient
    .from("trading_pending_actions")
    .select("id, user_id, circle_id, action_type, input_mint, output_mint, amount_lamports, slippage_bps, max_price, reason, proposed_by, source, expires_at, created_at")
    .eq("user_id", userId)
    .eq("circle_id", circleId)
    .eq("status", "pending")
    .gt("expires_at", nowIso())
    .order("created_at", { ascending: true })
    .limit(20);

  return ((data || []) as PendingActionRow[])
    .filter((action) => action.input_mint === SOL_MINT)
    .filter((action) => Number(action.amount_lamports || 0) > 0)
    .filter((action) => Number(action.amount_lamports || 0) <= maxTradeLamports)
    .filter((action) => Number(action.slippage_bps || 0) <= config.slippageBpsCap)
    .filter((action) => !action.max_price)
    .map((action) => ({
      kind: "pending" as const,
      id: action.id,
      title: action.reason || `${action.action_type.replace(/_/g, " ")} signal`,
      inputMint: action.input_mint,
      outputMint: action.output_mint,
      amountLamports: Number(action.amount_lamports || 0),
      slippageBps: Number(action.slippage_bps || 50),
      reason: action.reason,
      actionType: action.action_type,
      proposedBy: action.proposed_by,
      source: action.source,
    }));
}

async function listFeaturedCandidates(
  serviceClient: any,
  userId: string,
  config: BotConfigResponse,
  maxTradeLamports: number,
): Promise<Candidate[]> {
  if (!config.allowFeaturedTrades) return [];
  const { data } = await serviceClient
    .from("featured_trades")
    .select("id, title, trade_type, confidence, input_mint, output_mint, input_symbol, output_symbol, suggested_amount_sol, suggested_slippage_bps, expected_return_pct, risk_level, generated_by, expires_at, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", nowIso())
    .order("created_at", { ascending: false })
    .limit(12);

  const candidates = ((data || []) as FeaturedTradeRow[])
    .filter((trade) => trade.trade_type === "swap")
    .filter((trade) => trade.input_mint === SOL_MINT)
    .filter((trade) => confidenceAllowed(trade.confidence, config.minConfidence))
    .filter((trade) => (trade.risk_level || "moderate") !== "extreme")
    .map((trade) => {
      const amountLamports = Math.floor(coerceNumber(trade.suggested_amount_sol, 0) * 1e9);
      return {
        trade,
        candidate: {
          kind: "featured" as const,
          id: trade.id,
          title: trade.title,
          inputMint: trade.input_mint,
          outputMint: trade.output_mint,
          amountLamports,
          slippageBps: Number(trade.suggested_slippage_bps || 50),
          reason: trade.title,
          confidence: sanitizeConfidence(trade.confidence),
          expectedReturnPct: coerceNumber(trade.expected_return_pct, 0),
          generatedBy: trade.generated_by,
        },
      };
    })
    .filter(({ candidate }) => candidate.amountLamports > 0)
    .filter(({ candidate }) => candidate.amountLamports <= maxTradeLamports)
    .filter(({ candidate }) => candidate.slippageBps <= config.slippageBpsCap)
    .sort((a, b) => scoreFeaturedCandidate(b.candidate, b.trade.risk_level) - scoreFeaturedCandidate(a.candidate, a.trade.risk_level))
    .map(({ candidate }) => candidate);

  return candidates;
}

function selectCandidate(config: BotConfigResponse, pending: Candidate[], featured: Candidate[]): Candidate | null {
  if (config.strategyMode === "queue_only") {
    return pending[0] || null;
  }
  if (config.strategyMode === "featured_only") {
    return featured[0] || null;
  }
  return pending[0] || featured[0] || null;
}

async function logAutopilotTrade(serviceClient: any, userId: string, circleId: string, result: any, candidate: Candidate, triggerSource: string) {
  await serviceClient.from("trading_log").insert({
    user_id: userId,
    circle_id: circleId,
    wallet_address: result.walletAddress,
    action: mapActionTypeToTradeLogAction(candidate.actionType),
    input_mint: candidate.inputMint,
    output_mint: candidate.outputMint,
    input_amount: result.inputAmount,
    output_amount: result.outputAmount,
    tx_hash: result.txHash,
    status: "success",
    reason: candidate.kind === "featured" ? `Autopilot featured trade: ${candidate.title}` : candidate.reason || `Autopilot ${candidate.actionType || "swap"}`,
    execution_mode: "live",
    strategy_name: candidate.kind === "featured" ? "featured_autopilot" : "pending_action_autopilot",
    metadata: {
      source: candidate.kind,
      trigger_source: triggerSource,
      candidate_id: candidate.id,
      proposed_by: candidate.proposedBy || candidate.generatedBy || null,
    },
    created_at: nowIso(),
  });
}
async function runAutopilot(serviceClient: any, userId: string, circleId: string, body: any) {
  const triggerSource = String(body.triggerSource || "dashboard");
  const force = body.force === true;
  const walletRow = await getBotWalletRow(serviceClient, userId, circleId);
  const configRow = await getBotConfigRow(serviceClient, userId, circleId);
  const config = mapConfig(configRow, circleId);

  if (!walletRow) {
    return {
      ok: false,
      status: "no_wallet",
      message: "Create the bot wallet before enabling autopilot.",
      wallet: null,
      config,
    };
  }

  if (walletRow.status !== "active") {
    const wallet = await hydrateWallet(serviceClient, walletRow, userId);
    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastError: null,
    });
    return {
      ok: false,
      status: "paused",
      message: "Bot wallet is paused. Resume it before running autopilot.",
      wallet,
      config: mapConfig(updatedConfig, circleId),
    };
  }

  const wallet = await hydrateWallet(serviceClient, walletRow, userId);

  if (!config.isEnabled && !force) {
    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastError: null,
    });
    return {
      ok: true,
      status: "disabled",
      message: "Autopilot is disabled.",
      wallet,
      config: mapConfig(updatedConfig, circleId),
    };
  }

  const spendableLamports = getSpendableLamports(wallet.balanceLamports);
  const maxTradeLamports = Math.min(spendableLamports, Math.floor(config.maxTradeSol * 1e9));
  if (maxTradeLamports <= 0) {
    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastError: null,
    });
    return {
      ok: true,
      status: "skipped",
      message: "Bot wallet needs more SOL before autopilot can trade.",
      wallet,
      config: mapConfig(updatedConfig, circleId),
    };
  }

  const tradesToday = await getTradesExecutedToday(serviceClient, wallet.address);
  if (tradesToday >= config.maxDailyTrades) {
    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastError: null,
    });
    return {
      ok: true,
      status: "skipped",
      message: `Daily trade limit reached (${config.maxDailyTrades}).`,
      wallet,
      config: mapConfig(updatedConfig, circleId),
    };
  }

  const [pendingCandidates, featuredCandidates] = await Promise.all([
    listPendingCandidates(serviceClient, userId, circleId, config, maxTradeLamports),
    listFeaturedCandidates(serviceClient, userId, config, maxTradeLamports),
  ]);
  const candidate = selectCandidate(config, pendingCandidates, featuredCandidates);

  if (!candidate) {
    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastError: null,
    });
    return {
      ok: true,
      status: "skipped",
      message: "No eligible trades matched the current autopilot rules.",
      wallet,
      config: mapConfig(updatedConfig, circleId),
    };
  }

  try {
    if (candidate.kind === "pending") {
      await serviceClient
        .from("trading_pending_actions")
        .update({ status: "approved", updated_at: nowIso() })
        .eq("id", candidate.id)
        .eq("status", "pending");
    }

    const result = await executeSwap(serviceClient, userId, circleId, {
      inputMint: candidate.inputMint,
      outputMint: candidate.outputMint,
      amount: candidate.amountLamports,
      slippageBps: candidate.slippageBps,
    });

    if (candidate.kind === "pending") {
      await serviceClient
        .from("trading_pending_actions")
        .update({
          status: "executed",
          tx_hash: result.txHash,
          output_amount: result.outputAmount,
          updated_at: nowIso(),
        })
        .eq("id", candidate.id);
    } else {
      await serviceClient
        .from("featured_trades")
        .update({ status: "executed", updated_at: nowIso() })
        .eq("id", candidate.id);
      await serviceClient
        .from("featured_trade_executions")
        .insert({
          featured_trade_id: candidate.id,
          user_id: userId,
          tx_hash: result.txHash,
          input_amount: result.inputAmount,
          output_amount: result.outputAmount,
          outcome: "open",
        });
    }

    await logAutopilotTrade(serviceClient, userId, circleId, result, candidate, triggerSource);

    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastTradeAt: nowIso(),
      lastError: null,
    });
    const refreshedRow = await getBotWalletRow(serviceClient, userId, circleId);
    const refreshedWallet = refreshedRow ? await hydrateWallet(serviceClient, refreshedRow, userId) : wallet;

    return {
      ok: true,
      status: "executed",
      message: `Autopilot executed ${candidate.kind === "featured" ? "a featured trade" : "a queued action"}: ${candidate.title}`,
      wallet: refreshedWallet,
      config: mapConfig(updatedConfig, circleId),
      executedTrade: {
        kind: candidate.kind,
        id: candidate.id,
        title: candidate.title,
        txHash: result.txHash,
        inputMint: candidate.inputMint,
        outputMint: candidate.outputMint,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
      },
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    if (candidate.kind === "pending") {
      await serviceClient
        .from("trading_pending_actions")
        .update({
          status: "failed",
          error: message,
          updated_at: nowIso(),
        })
        .eq("id", candidate.id);
    }

    const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
      lastRunAt: nowIso(),
      lastError: message,
    });

    let nextWallet = wallet;
    if (config.autoPauseOnError) {
      await serviceClient
        .from("trading_bot_wallets")
        .update({ status: "paused", updated_at: nowIso() })
        .eq("id", walletRow.id);
      const pausedRow = await getBotWalletRow(serviceClient, userId, circleId);
      if (pausedRow) {
        nextWallet = await hydrateWallet(serviceClient, pausedRow, userId);
      }
    }

    return {
      ok: false,
      status: "error",
      message: config.autoPauseOnError ? `${message} Bot wallet paused for safety.` : message,
      wallet: nextWallet,
      config: mapConfig(updatedConfig, circleId),
    };
  }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth } = await userClient.auth.getUser();
    const user = auth.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    const action = (body.action || "status") as Action;
    const circleId = String(body.circleId || "");
    if (!circleId) {
      return new Response(JSON.stringify({ error: "circleId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "status") {
      const row = await getBotWalletRow(serviceClient, user.id, circleId);
      const wallet = row ? await hydrateWallet(serviceClient, row, user.id) : null;
      return new Response(JSON.stringify({ wallet }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create_wallet") {
      const wallet = await createWallet(serviceClient, user.id, circleId);
      return new Response(JSON.stringify({ wallet }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_status") {
      const nextStatus = body.status === "paused" ? "paused" : "active";
      const wallet = await setWalletStatus(serviceClient, user.id, circleId, nextStatus);
      return new Response(JSON.stringify({ wallet }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "execute_swap") {
      const result = await executeSwap(serviceClient, user.id, circleId, body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_config") {
      const config = mapConfig(await getBotConfigRow(serviceClient, user.id, circleId), circleId);
      return new Response(JSON.stringify({ config }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "save_config") {
      const configRow = await upsertBotConfig(serviceClient, user.id, circleId, body.config || {});
      return new Response(JSON.stringify({ config: mapConfig(configRow, circleId) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "run_autopilot") {
      const result = await runAutopilot(serviceClient, user.id, circleId, body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unsupported action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
