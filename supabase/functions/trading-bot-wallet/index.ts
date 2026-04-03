import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";

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
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MIN_SOL_RESERVE_LAMPORTS = 15_000_000;
const MAX_WALLET_USAGE_BPS = 8500;
const CONFIDENCE_RANK = {
  low: 1,
  medium: 2,
  high: 3,
} as const;

type Action = "status" | "create_wallet" | "set_status" | "execute_swap" | "execute_transfer" | "get_config" | "save_config" | "run_autopilot" | "scan_and_rotate";
type StrategyMode = "hybrid" | "featured_only" | "queue_only" | "momentum_rotation";
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
  return value === "featured_only" || value === "queue_only" || value === "momentum_rotation" ? value : "hybrid";
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

// ── Token Registry (mainnet mints) ──
const TOKEN_REGISTRY: { mint: string; symbol: string; decimals: number }[] = [
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6 },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", decimals: 6 },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", decimals: 5 },
  { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", decimals: 6 },
  { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", symbol: "JTO", decimals: 9 },
  { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", decimals: 6 },
  { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", decimals: 6 },
  { mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", symbol: "RNDR", decimals: 8 },
  { mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux", symbol: "HNT", decimals: 8 },
  { mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", symbol: "W", decimals: 6 },
  { mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", symbol: "ORCA", decimals: 6 },
  { mint: "MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey", symbol: "MNDE", decimals: 9 },
];

// ── DexScreener Integration ──
type DexScreenerData = {
  price: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
};

async function fetchDexScreenerData(mint: string): Promise<DexScreenerData | null> {
  try {
    const resp = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, {
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) return null;
    const pairs = await resp.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    // Use the highest-liquidity pair
    const best = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return {
      price: Number(best.priceUsd || 0),
      priceChange1h: Number(best.priceChange?.h1 || 0),
      priceChange6h: Number(best.priceChange?.h6 || 0),
      priceChange24h: Number(best.priceChange?.h24 || 0),
      volume24h: Number(best.volume?.h24 || 0),
      liquidity: Number(best.liquidity?.usd || 0),
    };
  } catch {
    return null;
  }
}

// ── Momentum Scorer ──
type MomentumSignal = {
  score: number; // -100 to 100
  action: "exit" | "enter" | "hold";
  reasons: string[];
};

function scoreMomentum(data: DexScreenerData): MomentumSignal {
  let score = 0;
  const reasons: string[] = [];

  // 1h momentum (heaviest weight)
  if (data.priceChange1h > 5) { score += 30; reasons.push(`1h +${data.priceChange1h.toFixed(1)}% surge`); }
  else if (data.priceChange1h > 2) { score += 15; reasons.push(`1h +${data.priceChange1h.toFixed(1)}% up`); }
  else if (data.priceChange1h < -5) { score -= 40; reasons.push(`1h ${data.priceChange1h.toFixed(1)}% drop`); }
  else if (data.priceChange1h < -2) { score -= 20; reasons.push(`1h ${data.priceChange1h.toFixed(1)}% down`); }

  // 6h trend confirmation
  if (data.priceChange6h > 8) { score += 20; reasons.push(`6h +${data.priceChange6h.toFixed(1)}% trend`); }
  else if (data.priceChange6h > 3) { score += 10; reasons.push(`6h +${data.priceChange6h.toFixed(1)}% up`); }
  else if (data.priceChange6h < -8) { score -= 25; reasons.push(`6h ${data.priceChange6h.toFixed(1)}% decline`); }
  else if (data.priceChange6h < -3) { score -= 12; reasons.push(`6h ${data.priceChange6h.toFixed(1)}% down`); }

  // 24h context (mild modifiers)
  if (data.priceChange24h > 15) { score += 10; reasons.push(`24h +${data.priceChange24h.toFixed(1)}%`); }
  else if (data.priceChange24h < -15) { score -= 10; reasons.push(`24h ${data.priceChange24h.toFixed(1)}%`); }

  // Liquidity gate
  if (data.liquidity < 50_000) { score -= 30; reasons.push(`Low liq $${(data.liquidity / 1000).toFixed(0)}K`); }

  // Volume gate
  if (data.volume24h < 10_000) { score -= 15; reasons.push(`Low vol $${(data.volume24h / 1000).toFixed(0)}K`); }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  // Determine action
  let action: "exit" | "enter" | "hold" = "hold";
  if (score <= -15) action = "exit";
  else if (score >= 30) action = "enter";

  return { score, action, reasons };
}

// ── SOL Transfer (Withdraw) ──
async function executeTransfer(serviceClient: any, userId: string, circleId: string, body: any) {
  const row = await getBotWalletRow(serviceClient, userId, circleId);
  if (!row) throw new Error("Bot wallet not found for this circle");
  if (row.status !== "active") throw new Error("Bot wallet is paused");

  const secretKeyBase64 = await getBotWalletSecret(serviceClient, userId, circleId);
  if (!secretKeyBase64) throw new Error("Bot wallet secret is unavailable");

  const destination = String(body.destination || "").trim();
  if (!destination) throw new Error("destination address is required");

  let destPubkey: PublicKey;
  try {
    destPubkey = new PublicKey(destination);
  } catch {
    throw new Error("Invalid destination address");
  }

  const keypair = Keypair.fromSecretKey(base64ToBytes(secretKeyBase64));
  if (destPubkey.equals(keypair.publicKey)) throw new Error("Cannot transfer to the same wallet");

  const rpcUrl = await getRpcUrl(serviceClient, userId);
  const connection = new Connection(rpcUrl, "confirmed");
  const balanceLamports = await connection.getBalance(keypair.publicKey, "confirmed");

  let transferLamports: number;
  if (body.withdrawAll) {
    // Leave minimum for rent
    transferLamports = Math.max(0, balanceLamports - MIN_SOL_RESERVE_LAMPORTS);
  } else {
    transferLamports = Math.floor(Number(body.amountLamports || 0));
  }

  if (!Number.isFinite(transferLamports) || transferLamports <= 0) {
    throw new Error("Nothing to withdraw — balance is too low");
  }

  const remaining = balanceLamports - transferLamports;
  if (remaining < MIN_SOL_RESERVE_LAMPORTS && !body.withdrawAll) {
    throw new Error(`Must keep at least ${(MIN_SOL_RESERVE_LAMPORTS / 1e9).toFixed(3)} SOL reserve. Max withdraw: ${((balanceLamports - MIN_SOL_RESERVE_LAMPORTS) / 1e9).toFixed(4)} SOL`);
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: destPubkey,
      lamports: transferLamports,
    })
  );
  transaction.feePayer = keypair.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  transaction.sign(keypair);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await connection.confirmTransaction(signature, "confirmed");

  // Update wallet metadata
  await serviceClient
    .from("trading_bot_wallets")
    .update({ last_used_at: nowIso(), updated_at: nowIso() })
    .eq("id", row.id);

  // Log the transfer
  await serviceClient.from("trading_log").insert({
    user_id: userId,
    circle_id: circleId,
    wallet_address: row.public_key,
    action: "transfer",
    input_mint: SOL_MINT,
    output_mint: SOL_MINT,
    input_amount: String(transferLamports),
    output_amount: String(transferLamports),
    tx_hash: signature,
    status: "success",
    reason: `Withdraw ${(transferLamports / 1e9).toFixed(4)} SOL to ${destination.slice(0, 8)}...`,
    execution_mode: "live",
    strategy_name: "manual_transfer",
    metadata: { destination, withdrawAll: body.withdrawAll || false },
    created_at: nowIso(),
  });

  return {
    success: true,
    txHash: signature,
    walletAddress: row.public_key,
    destination,
    amountLamports: transferLamports,
    amountSol: transferLamports / 1e9,
  };
}

// ── Momentum Scan & Rotate ──
type HoldingInfo = {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  price: number;
  valueUsd: number;
  signal: MomentumSignal;
};

type ScanResult = {
  holdings: HoldingInfo[];
  exitCandidates: HoldingInfo[];
  entryCandidates: (HoldingInfo & { registryEntry: typeof TOKEN_REGISTRY[number] })[];
  executedTrade: any | null;
};

async function scanAndRotate(serviceClient: any, userId: string, circleId: string, body: any): Promise<ScanResult> {
  const autoExecute = body.autoExecute === true;

  const row = await getBotWalletRow(serviceClient, userId, circleId);
  if (!row) throw new Error("Bot wallet not found for this circle");
  if (row.status !== "active") throw new Error("Bot wallet is paused");

  const rpcUrl = await getRpcUrl(serviceClient, userId);
  const connection = new Connection(rpcUrl, "confirmed");
  const walletPubkey = new PublicKey(row.public_key);

  // 1. Get all token balances
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  const heldTokens: { mint: string; balance: number; decimals: number }[] = [];
  for (const account of tokenAccounts.value) {
    const info = account.account.data.parsed?.info;
    if (!info) continue;
    const balance = Number(info.tokenAmount?.uiAmount || 0);
    if (balance <= 0) continue;
    heldTokens.push({
      mint: info.mint,
      balance,
      decimals: Number(info.tokenAmount?.decimals || 0),
    });
  }

  // 2. Collect all mints to scan (held + registry)
  const allMints = new Set<string>();
  for (const t of heldTokens) allMints.add(t.mint);
  for (const t of TOKEN_REGISTRY) allMints.add(t.mint);
  // Remove SOL and USDC from scoring (they're base assets)
  allMints.delete(SOL_MINT);
  allMints.delete(USDC_MINT);

  // 3. Fetch DexScreener data (batched, 5 at a time, 300ms between batches)
  const mintArray = Array.from(allMints);
  const dexData = new Map<string, DexScreenerData>();
  for (let i = 0; i < mintArray.length; i += 5) {
    const batch = mintArray.slice(i, i + 5);
    const results = await Promise.all(batch.map((m) => fetchDexScreenerData(m)));
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) dexData.set(batch[j], results[j]!);
    }
    if (i + 5 < mintArray.length) await new Promise((r) => setTimeout(r, 300));
  }

  // 4. Score held tokens
  const holdings: HoldingInfo[] = [];
  for (const held of heldTokens) {
    if (held.mint === SOL_MINT || held.mint === USDC_MINT) continue;
    const data = dexData.get(held.mint);
    const registryEntry = TOKEN_REGISTRY.find((t) => t.mint === held.mint);
    const symbol = registryEntry?.symbol || held.mint.slice(0, 6);
    const signal = data ? scoreMomentum(data) : { score: 0, action: "hold" as const, reasons: ["No market data"] };
    holdings.push({
      mint: held.mint,
      symbol,
      balance: held.balance,
      decimals: held.decimals,
      price: data?.price || 0,
      valueUsd: (data?.price || 0) * held.balance,
      signal,
    });
  }

  // 5. Generate EXIT candidates (held tokens with exit signal)
  const exitCandidates = holdings.filter((h) => h.signal.action === "exit");

  // 6. Generate ENTRY candidates (registry tokens with enter signal, not currently held)
  const heldMints = new Set(heldTokens.map((t) => t.mint));
  const entryCandidates: (HoldingInfo & { registryEntry: typeof TOKEN_REGISTRY[number] })[] = [];
  for (const entry of TOKEN_REGISTRY) {
    if (entry.mint === SOL_MINT || entry.mint === USDC_MINT) continue;
    if (heldMints.has(entry.mint)) continue;
    const data = dexData.get(entry.mint);
    if (!data) continue;
    const signal = scoreMomentum(data);
    if (signal.action !== "enter") continue;
    if (data.liquidity < 50_000) continue;
    entryCandidates.push({
      mint: entry.mint,
      symbol: entry.symbol,
      balance: 0,
      decimals: entry.decimals,
      price: data.price,
      valueUsd: 0,
      signal,
      registryEntry: entry,
    });
  }
  entryCandidates.sort((a, b) => b.signal.score - a.signal.score);

  // 7. Persist holdings snapshot
  for (const h of holdings) {
    await serviceClient
      .from("trading_bot_holdings")
      .upsert({
        user_id: userId,
        circle_id: circleId,
        token_mint: h.mint,
        token_symbol: h.symbol,
        balance: h.balance,
        current_price: h.price,
        signal_score: h.signal.score,
        signal_action: h.signal.action,
        last_scanned_at: nowIso(),
        updated_at: nowIso(),
      }, { onConflict: "user_id,circle_id,token_mint" });
  }

  // 8. Auto-execute if enabled
  let executedTrade: any = null;
  if (autoExecute) {
    const configRow = await getBotConfigRow(serviceClient, userId, circleId);
    const config = mapConfig(configRow, circleId);
    const tradesToday = await getTradesExecutedToday(serviceClient, row.public_key);
    if (tradesToday < config.maxDailyTrades) {
      // Priority 1: Exit losing positions → swap to USDC
      if (exitCandidates.length > 0 && !executedTrade) {
        const worst = exitCandidates.sort((a, b) => a.signal.score - b.signal.score)[0];
        const tokenAccount = tokenAccounts.value.find(
          (a) => a.account.data.parsed?.info?.mint === worst.mint
        );
        if (tokenAccount) {
          const rawBalance = Number(tokenAccount.account.data.parsed.info.tokenAmount?.amount || 0);
          if (rawBalance > 0) {
            try {
              const result = await executeSwap(serviceClient, userId, circleId, {
                inputMint: worst.mint,
                outputMint: USDC_MINT,
                amount: rawBalance,
                slippageBps: config.slippageBpsCap,
              });
              executedTrade = {
                action: "exit",
                symbol: worst.symbol,
                mint: worst.mint,
                score: worst.signal.score,
                reasons: worst.signal.reasons,
                txHash: result.txHash,
                inputAmount: result.inputAmount,
                outputAmount: result.outputAmount,
              };
              await serviceClient.from("trading_log").insert({
                user_id: userId,
                circle_id: circleId,
                wallet_address: row.public_key,
                action: "momentum_exit",
                input_mint: worst.mint,
                output_mint: USDC_MINT,
                input_amount: result.inputAmount,
                output_amount: result.outputAmount,
                tx_hash: result.txHash,
                status: "success",
                reason: `Momentum exit: ${worst.symbol} score ${worst.signal.score} — ${worst.signal.reasons.join(", ")}`,
                execution_mode: "live",
                strategy_name: "momentum_rotation",
                metadata: { signal: worst.signal },
                created_at: nowIso(),
              });
            } catch (err: any) {
              executedTrade = { action: "exit_failed", symbol: worst.symbol, error: err?.message || String(err) };
            }
          }
        }
      }

      // Priority 2: Enter gaining positions — buy with USDC
      if (!executedTrade && entryCandidates.length > 0) {
        // Check USDC balance
        const usdcAccount = tokenAccounts.value.find(
          (a) => a.account.data.parsed?.info?.mint === USDC_MINT
        );
        const usdcRawBalance = Number(usdcAccount?.account.data.parsed?.info?.tokenAmount?.amount || 0);
        if (usdcRawBalance > 1_000_000) { // At least $1 USDC
          const best = entryCandidates[0];
          const maxTradeUsdc = Math.floor(usdcRawBalance * 0.25); // 25% of USDC balance
          const tradeAmount = Math.min(maxTradeUsdc, usdcRawBalance);
          try {
            const result = await executeSwap(serviceClient, userId, circleId, {
              inputMint: USDC_MINT,
              outputMint: best.mint,
              amount: tradeAmount,
              slippageBps: config.slippageBpsCap,
            });
            executedTrade = {
              action: "enter",
              symbol: best.symbol,
              mint: best.mint,
              score: best.signal.score,
              reasons: best.signal.reasons,
              txHash: result.txHash,
              inputAmount: result.inputAmount,
              outputAmount: result.outputAmount,
            };
            await serviceClient.from("trading_log").insert({
              user_id: userId,
              circle_id: circleId,
              wallet_address: row.public_key,
              action: "momentum_enter",
              input_mint: USDC_MINT,
              output_mint: best.mint,
              input_amount: result.inputAmount,
              output_amount: result.outputAmount,
              tx_hash: result.txHash,
              status: "success",
              reason: `Momentum enter: ${best.symbol} score ${best.signal.score} — ${best.signal.reasons.join(", ")}`,
              execution_mode: "live",
              strategy_name: "momentum_rotation",
              metadata: { signal: best.signal },
              created_at: nowIso(),
            });
          } catch (err: any) {
            executedTrade = { action: "enter_failed", symbol: best.symbol, error: err?.message || String(err) };
          }
        }
      }
    }
  }

  return {
    holdings,
    exitCandidates,
    entryCandidates,
    executedTrade,
  };
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

  // Momentum rotation mode: delegate to scanAndRotate
  if (config.strategyMode === "momentum_rotation") {
    try {
      const scanResult = await scanAndRotate(serviceClient, userId, circleId, { autoExecute: true });
      const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
        lastRunAt: nowIso(),
        lastTradeAt: scanResult.executedTrade?.txHash ? nowIso() : undefined,
        lastError: null,
      });
      const refreshedRow = await getBotWalletRow(serviceClient, userId, circleId);
      const refreshedWallet = refreshedRow ? await hydrateWallet(serviceClient, refreshedRow, userId) : wallet;
      return {
        ok: true,
        status: scanResult.executedTrade ? "executed" : "scanned",
        message: scanResult.executedTrade
          ? `Momentum ${scanResult.executedTrade.action}: ${scanResult.executedTrade.symbol}`
          : `Scanned ${scanResult.holdings.length} holdings, ${scanResult.exitCandidates.length} exit / ${scanResult.entryCandidates.length} entry signals`,
        wallet: refreshedWallet,
        config: mapConfig(updatedConfig, circleId),
        scanResult,
      };
    } catch (err: any) {
      const updatedConfig = await upsertBotConfig(serviceClient, userId, circleId, {
        lastRunAt: nowIso(),
        lastError: err?.message || String(err),
      });
      return {
        ok: false,
        status: "error",
        message: err?.message || String(err),
        wallet,
        config: mapConfig(updatedConfig, circleId),
      };
    }
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

    // Verify circle membership — user must be a member of the circle
    const { data: membership, error: memberError } = await serviceClient
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Not a member of this circle" }), {
        status: 403,
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

    if (action === "execute_transfer") {
      const result = await executeTransfer(serviceClient, user.id, circleId, body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scan_and_rotate") {
      const result = await scanAndRotate(serviceClient, user.id, circleId, body);
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
