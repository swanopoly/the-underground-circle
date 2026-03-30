/**
 * heliusTrading.ts — Helius-powered Solana trading bot
 *
 * Uses Helius RPC + DAS API for:
 *   - Token balances & portfolio tracking
 *   - Swap execution via Jupiter aggregator
 *   - Transaction history & parsing
 *   - Whale watching & token scanning
 *   - DCA (dollar-cost averaging) execution
 *   - Price alerts & watchlist monitoring
 *
 * Requires: HELIUS_API_KEY in user_api_keys or env
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// ─── Constants ───────────────────────────────────────────────────────────────

const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';
const HELIUS_API_BASE = 'https://api.helius.xyz';
const JUPITER_QUOTE_API = 'https://lite-api.jup.ag/swap/v1';
const JUPITER_SWAP_API = 'https://lite-api.jup.ag/swap/v1/swap';

// Well-known Solana token mints
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// ─── Token Registry (real mainnet mints — prevents AI from inventing fakes) ─
export const SOLANA_TOKEN_REGISTRY: Record<string, { mint: string; decimals: number; name: string }> = {
  SOL:    { mint: SOL_MINT, decimals: 9, name: 'Solana' },
  USDC:   { mint: USDC_MINT, decimals: 6, name: 'USD Coin' },
  USDT:   { mint: USDT_MINT, decimals: 6, name: 'Tether' },
  JUP:    { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, name: 'Jupiter' },
  BONK:   { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, name: 'Bonk' },
  RAY:    { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, name: 'Raydium' },
  JTO:    { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9, name: 'Jito' },
  PYTH:   { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6, name: 'Pyth Network' },
  WIF:    { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, name: 'dogwifhat' },
  RNDR:   { mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', decimals: 8, name: 'Render' },
  HNT:    { mint: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', decimals: 8, name: 'Helium' },
  W:      { mint: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', decimals: 6, name: 'Wormhole' },
  ORCA:   { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, name: 'Orca' },
  MNDE:   { mint: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', decimals: 9, name: 'Marinade' },
  TENSOR: { mint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', decimals: 9, name: 'Tensor' },
};


const DEFAULT_PAPER_STARTING_BALANCE_USD = 10000;
const PAPER_ENTRY_FEE_BPS = 10;
const PAPER_EXIT_FEE_BPS = 10;
const PAPER_SLIPPAGE_BPS = 15;
const HELIUS_KEY_CACHE_PREFIX = 'tuc:helius:key:';
let heliusReadRpcUnavailable = false;
let heliusReadRpcWarned = false;
let tradingBotSessionInvalid = false;
let tradingBotInvalidAccessToken: string | null = null;
let tradingBacktestRunsUnavailable = false;

function isMissingGetUserApiKeyRpc(error: any): boolean {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return error?.code === 'PGRST202'
    || error?.status === 404
    || message.includes('get_user_api_key')
    || message.includes('404');
}

function getHeliusKeyCacheId(userId: string): string {
  return `${HELIUS_KEY_CACHE_PREFIX}${userId}`;
}

async function readHeliusKeyFromLocalCache(userId: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(getHeliusKeyCacheId(userId));
    }
    return await AsyncStorage.getItem(getHeliusKeyCacheId(userId));
  } catch {
    return null;
  }
}

export async function cacheHeliusApiKeyLocally(userId: string, apiKey: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(getHeliusKeyCacheId(userId), apiKey);
      return;
    }
    await AsyncStorage.setItem(getHeliusKeyCacheId(userId), apiKey);
  } catch {
    // Ignore local cache failures; the backend remains the source of truth.
  }
}

export async function clearHeliusApiKeyLocalCache(userId: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(getHeliusKeyCacheId(userId));
      return;
    }
    await AsyncStorage.removeItem(getHeliusKeyCacheId(userId));
  } catch {
    // Ignore cache cleanup failures.
  }
}

// ─── Featured Trade Types ────────────────────────────────────────────────────

export interface FeaturedTrade {
  id: string;
  userId: string;
  title: string;
  description: string;
  tradeType: 'swap' | 'sequence';
  direction: 'buy' | 'sell';
  confidence: 'high' | 'medium' | 'low';
  timeframe: 'scalp' | 'day' | 'swing' | 'position';
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  suggestedAmountSol: number;
  suggestedSlippageBps: number;
  sequenceId?: string;
  sequenceOrder: number;
  entryReasoning?: string;
  exitStrategy?: string;
  riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  expectedReturnPct?: number;
  stopLossPct?: number;
  generatedBy: string;
  status: 'active' | 'executed' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
}

export type TradingAction = 'swap' | 'transfer' | 'stake' | 'dca_buy' | 'alert_check' | 'portfolio_scan';
export type TradingExecutionMode = 'live' | 'paper' | 'backtest';

export interface TradeLogEntry {
  id: string;
  userId: string;
  circleId?: string;
  walletAddress: string;
  action: TradingAction;
  inputMint?: string;
  outputMint?: string;
  inputAmount?: string;
  outputAmount?: string;
  priceUsd?: number;
  txHash?: string;
  status: 'success' | 'failed' | 'skipped';
  reason?: string;
  executionMode: TradingExecutionMode;
  strategyName?: string;
  backtestRunId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface PaperTradingAccount {
  id: string;
  userId: string;
  circleId: string;
  baseCurrencySymbol: string;
  startingBalanceUsd: number;
  cashBalanceUsd: number;
  openPositionValueUsd: number;
  currentEquityUsd: number;
  realizedPnlUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  lastResetAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradingBotWalletInfo {
  id: string;
  address: string;
  label: string;
  status: 'active' | 'paused' | 'archived';
  balanceLamports: number;
  balanceSol: number;
  lastFundedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface TradingBotAutopilotConfig {
  id?: string | null;
  circleId: string;
  isEnabled: boolean;
  strategyMode: 'hybrid' | 'featured_only' | 'queue_only' | 'momentum_rotation';
  minConfidence: 'high' | 'medium' | 'low';
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
}

export interface TradingBotAutopilotResult {
  ok: boolean;
  status: 'executed' | 'skipped' | 'disabled' | 'no_wallet' | 'paused' | 'error' | 'scanned';
  message: string;
  wallet?: TradingBotWalletInfo | null;
  config?: TradingBotAutopilotConfig | null;
  executedTrade?: {
    kind: 'featured' | 'pending';
    id: string;
    title?: string;
    txHash?: string;
    inputMint?: string;
    outputMint?: string;
    inputAmount?: string;
    outputAmount?: string;
  };
}

export interface BacktestRun {
  id: string;
  userId: string;
  circleId?: string;
  strategyKey: string;
  strategyName: string;
  tokenMint: string;
  tokenSymbol: string;
  timeframeLabel: string;
  initialCapitalUsd: number;
  finalEquityUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  feeBps: number;
  slippageBps: number;
  config: Record<string, any>;
  equityCurve: Array<{ index: number; time: string; equityUsd: number }>;
  tradeLog: Array<Record<string, any>>;
  createdAt: string;
}

export interface HeliusConfig {
  apiKey: string;
  rpcUrl?: string;
}

export interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  usdValue: number;
  priceUsd: number;
  change24h: number;
  logoUri?: string;
}

export interface SwapParams {
  inputMint: string;
  outputMint: string;
  amount: number; // in lamports or smallest unit
  slippageBps?: number; // default 50 (0.5%)
  userPublicKey: string;
}

export interface SwapQuoteResult {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: Array<{
    swapInfo: { label: string; inputMint: string; outputMint: string };
    percent: number;
  }>;
  otherAmountThreshold: string;
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  inputAmount: string;
  outputAmount: string;
  error?: string;
}

export interface TradeAlert {
  id: string;
  userId: string;
  tokenMint: string;
  tokenSymbol: string;
  alertType: 'price_above' | 'price_below' | 'volume_spike' | 'whale_move';
  targetValue: number;
  currentValue?: number;
  triggered: boolean;
  createdAt: string;
}

export interface DCAConfig {
  id: string;
  userId: string;
  inputMint: string;   // usually SOL
  outputMint: string;  // target token
  amountPerInterval: number; // in lamports
  intervalHours: number;
  maxPrice?: number;   // skip if price above this
  isActive: boolean;
  lastExecuted?: string;
  totalExecuted: number;
  totalSpent: number;
}

export interface WhaleTransaction {
  signature: string;
  wallet: string;
  action: 'buy' | 'sell' | 'transfer';
  tokenMint: string;
  tokenSymbol: string;
  amount: number;
  usdValue: number;
  timestamp: number;
}

export interface PortfolioSnapshot {
  walletAddress: string;
  totalValueUsd: number;
  tokens: TokenBalance[];
  solBalance: number;
  change24hPct: number;
  timestamp: number;
}

// ─── Helius RPC Client ───────────────────────────────────────────────────────

export class HeliusClient {
  private apiKey: string;
  private rpcUrl: string;

  constructor(config: HeliusConfig) {
    this.apiKey = config.apiKey;
    this.rpcUrl = config.rpcUrl || `${HELIUS_RPC_BASE}/?api-key=${config.apiKey}`;
  }

  // ── RPC Methods ──────────────────────────────────────────────────────────

  private async rpcCall(method: string, params: any[] = []): Promise<any> {
    const resp = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(`RPC error: ${data.error.message}`);
    return data.result;
  }

  private async heliusApi(endpoint: string, params?: any): Promise<any> {
    const url = `${HELIUS_API_BASE}${endpoint}?api-key=${this.apiKey}`;
    const resp = await fetch(url, {
      method: params ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(params ? { body: JSON.stringify(params) } : {}),
    });
    if (!resp.ok) throw new Error(`Helius API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  // ── Balance & Portfolio ──────────────────────────────────────────────────

  /** Get SOL balance in lamports */
  async getSolBalance(walletAddress: string): Promise<number> {
    const result = await this.rpcCall('getBalance', [walletAddress]);
    return result?.value || 0;
  }

  /** Get all token balances using Helius RPC/DAS paths that work on web too. */
  async getTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    const [nativeLamports, assets] = await Promise.all([
      this.getSolBalance(walletAddress).catch(() => 0),
      this.getAssetsByOwner(walletAddress, 1, 1000).catch(() => null),
    ]);

    const tokens: TokenBalance[] = [];

    if (nativeLamports > 0) {
      tokens.push({
        mint: SOL_MINT,
        symbol: 'SOL',
        name: 'Solana',
        amount: nativeLamports / 1e9,
        decimals: 9,
        usdValue: 0,
        priceUsd: 0,
        change24h: 0,
      });
    }

    const items = assets?.items || assets?.result?.items || [];
    for (const item of items) {
      const tokenInfo = item?.token_info || item?.tokenInfo || {};
      const mint = item?.id || tokenInfo?.mint || item?.mint;
      const decimals = Number(tokenInfo?.decimals ?? 0);
      const rawBalance = Number(tokenInfo?.balance ?? tokenInfo?.amount ?? tokenInfo?.token_amount ?? 0);
      const amount = Number(
        tokenInfo?.uiAmount
          ?? tokenInfo?.ui_amount
          ?? (decimals >= 0 ? rawBalance / Math.pow(10, decimals) : 0),
      );
      if (!mint || !Number.isFinite(amount) || amount <= 0) continue;
      if (mint === SOL_MINT) continue;

      const symbol = tokenInfo?.symbol || item?.content?.metadata?.symbol || String(mint).slice(0, 6);
      const name = item?.content?.metadata?.name || symbol || 'Unknown';
      const priceInfo = tokenInfo?.price_info || tokenInfo?.priceInfo || {};
      const priceUsd = Number(priceInfo?.price_per_token ?? priceInfo?.pricePerToken ?? tokenInfo?.priceUsd ?? 0) || 0;
      const usdValue = Number(priceInfo?.total_price ?? priceInfo?.totalPrice ?? tokenInfo?.usd_value ?? tokenInfo?.usdValue ?? (amount * priceUsd)) || 0;

      tokens.push({
        mint,
        symbol,
        name,
        amount,
        decimals,
        usdValue,
        priceUsd,
        change24h: 0,
        logoUri: item?.content?.links?.image || item?.content?.files?.[0]?.uri,
      });
    }

    return tokens;
  }

  /** Full portfolio snapshot with USD values */
  async getPortfolio(walletAddress: string): Promise<PortfolioSnapshot> {
    const tokens = await this.getTokenBalances(walletAddress);
    const totalValue = tokens.reduce((sum, t) => sum + t.usdValue, 0);

    return {
      walletAddress,
      totalValueUsd: totalValue,
      tokens,
      solBalance: tokens.find(t => t.mint === SOL_MINT)?.amount || 0,
      change24hPct: 0, // computed from historical snapshots
      timestamp: Date.now(),
    };
  }

  // ── Asset Lookup (DAS API) ───────────────────────────────────────────────

  /** Get detailed asset info by mint address */
  async getAsset(mintAddress: string): Promise<any> {
    return this.rpcCall('getAsset', [{ id: mintAddress }]);
  }

  /** Search assets by owner */
  async getAssetsByOwner(ownerAddress: string, page = 1, limit = 50): Promise<any> {
    return this.rpcCall('getAssetsByOwner', [{
      ownerAddress,
      page,
      limit,
      sortBy: { sortBy: 'recent_action', sortDirection: 'desc' },
      displayOptions: { showFungible: true, showNativeBalance: true },
    }]);
  }

  // ── Transaction History ──────────────────────────────────────────────────

  /** Get parsed transaction history */
  async getTransactionHistory(walletAddress: string, limit = 20): Promise<any[]> {
    const result = await this.heliusApi('/v0/addresses/' + walletAddress + '/transactions', {
      limit,
    });
    return result || [];
  }

  /** Get enhanced transaction details */
  async parseTransaction(txSignature: string): Promise<any> {
    const result = await this.heliusApi('/v0/transactions', {
      transactions: [txSignature],
    });
    return result?.[0] || null;
  }

  // ── Swap via Jupiter ─────────────────────────────────────────────────────

  /** Get a swap quote from Jupiter */
  async getSwapQuote(params: SwapParams): Promise<SwapQuoteResult> {
    const url = new URL(JUPITER_QUOTE_API + '/quote');
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount.toString());
    url.searchParams.set('slippageBps', (params.slippageBps || 200).toString());
    // Auto-adjust slippage based on real-time market conditions
    url.searchParams.set('dynamicSlippage', 'true');

    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`Jupiter quote error: ${resp.status}`);
    return resp.json();
  }

  /** Build a swap transaction (returns serialized tx for signing) */
  async buildSwapTransaction(
    quoteResponse: SwapQuoteResult,
    userPublicKey: string,
  ): Promise<string> {
    const resp = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!resp.ok) throw new Error(`Jupiter swap error: ${resp.status}`);
    const data = await resp.json();
    return data.swapTransaction; // base64 encoded transaction
  }

  /** Execute a swap — gets quote, builds tx, signs via Phantom, sends via Helius */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    try {
      // 1. Get quote
      const quote = await this.getSwapQuote(params);

      // 2. Build transaction
      const swapTxB64 = await this.buildSwapTransaction(quote, params.userPublicKey);

      // 3. Connect Phantom (reconnect if needed)
      const phantom = (window as any)?.phantom?.solana;
      if (!phantom) {
        return { success: false, inputAmount: quote.inAmount, outputAmount: quote.outAmount, error: 'Phantom wallet not found. Please install Phantom.' };
      }

      try {
        await phantom.connect();
      } catch (connectErr: any) {
        return { success: false, inputAmount: quote.inAmount, outputAmount: quote.outAmount, error: 'Phantom connection rejected: ' + (connectErr.message || 'User declined') };
      }

      // 4. Deserialize base64 tx into a proper VersionedTransaction object
      //    Jupiter returns versioned transactions — Phantom needs the actual object, not raw bytes
      const { VersionedTransaction } = await import('@solana/web3.js');
      const txBytes = Uint8Array.from(atob(swapTxB64), c => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);
      console.log('[executeSwap] Transaction deserialized, requesting Phantom signature...');

      // 5. Sign via Phantom — this triggers the wallet popup
      const signed = await phantom.signTransaction(transaction);
      console.log('[executeSwap] Phantom signed successfully');

      // 6. Send the signed transaction via Helius RPC
      const signedBytes = signed.serialize();
      let binary = '';
      for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);
      const serialized = btoa(binary);
      console.log('[executeSwap] Sending tx via Helius RPC...', this.rpcUrl.replace(/api-key=[^&]+/, 'api-key=***'));
      const sendResp = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [serialized, { encoding: 'base64', skipPreflight: true, maxRetries: 5 }],
        }),
      });
      const sendData = await sendResp.json();
      console.log('[executeSwap] RPC response:', JSON.stringify(sendData));

      if (sendData.error) {
        return { success: false, inputAmount: quote.inAmount, outputAmount: quote.outAmount, error: sendData.error.message || 'Transaction send failed' };
      }

      const signature = sendData.result;
      console.log('[executeSwap] Transaction sent! Signature:', signature);
      return {
        success: true,
        txHash: signature,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
      };
    } catch (err: any) {
      const msg = err.message || String(err);
      if (err.code === 4001 || msg.includes('User rejected')) {
        return { success: false, inputAmount: params.amount.toString(), outputAmount: '0', error: 'Transaction rejected by user' };
      }
      return {
        success: false,
        inputAmount: params.amount.toString(),
        outputAmount: '0',
        error: msg,
      };
    }
  }

  // ── Smart Transaction Sending ────────────────────────────────────────────

  /** Send a transaction with Helius priority fee optimization */
  async sendSmartTransaction(serializedTx: string): Promise<string> {
    const result = await this.rpcCall('sendTransaction', [
      serializedTx,
      { encoding: 'base64', skipPreflight: false, maxRetries: 3 },
    ]);
    return result;
  }

  /** Get priority fee estimate for optimal landing */
  async getPriorityFeeEstimate(accountKeys: string[]): Promise<{
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
  }> {
    const result = await this.rpcCall('getPriorityFeeEstimate', [{
      accountKeys,
      options: { includeAllPriorityFeeLevels: true },
    }]);
    return result?.priorityFeeLevels || { low: 0, medium: 0, high: 0, veryHigh: 0 };
  }

  // ── Token Price ──────────────────────────────────────────────────────────

  /** Get token price by quoting a small swap to USDC */
  async getTokenPrice(mintAddress: string): Promise<{ price: number; change24h: number }> {
    try {
      // Quote 1 unit of the token → USDC to derive price
      const isSol = mintAddress === SOL_MINT;
      const amount = isSol ? 1_000_000_000 : 1_000_000; // 1 SOL or 1 unit
      const decimals = isSol ? 9 : 6;

      const resp = await fetch(
        `${JUPITER_QUOTE_API}/quote?inputMint=${mintAddress}&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=100`
      );
      if (!resp.ok) return { price: 0, change24h: 0 };
      const data = await resp.json();

      // swapUsdValue gives the USD value of the input
      const usdValue = parseFloat(data?.swapUsdValue || '0');
      const price = usdValue > 0 ? usdValue : (parseInt(data?.outAmount || '0') / 1e6);

      return { price, change24h: 0 };
    } catch {
      return { price: 0, change24h: 0 };
    }
  }

  /** Get multiple token prices */
  async getTokenPrices(mintAddresses: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};
    // Fetch in parallel, max 5 concurrent
    const chunks: string[][] = [];
    for (let i = 0; i < mintAddresses.length; i += 5) {
      chunks.push(mintAddresses.slice(i, i + 5));
    }
    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map(async (mint) => {
          const { price } = await this.getTokenPrice(mint);
          return { mint, price };
        })
      );
      for (const r of results) {
        prices[r.mint] = r.price;
      }
    }
    return prices;
  }

  // ── Webhook Management ───────────────────────────────────────────────────

  /** Create a Helius webhook for wallet monitoring */
  async createWebhook(params: {
    webhookURL: string;
    accountAddresses: string[];
    transactionTypes?: string[];
    webhookType?: 'enhanced' | 'raw';
  }): Promise<any> {
    return this.heliusApi('/v0/webhooks', {
      ...params,
      webhookType: params.webhookType || 'enhanced',
    });
  }

  /** List existing webhooks */
  async listWebhooks(): Promise<any[]> {
    return this.heliusApi('/v0/webhooks');
  }

  /** Delete a webhook */
  async deleteWebhook(webhookId: string): Promise<boolean> {
    try {
      const resp = await fetch(`${HELIUS_API_BASE}/v0/webhooks/${webhookId}?api-key=${this.apiKey}`, {
        method: 'DELETE',
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

// ─── Trading Bot Manager ─────────────────────────────────────────────────────

export class TradingBot {
  private client: HeliusClient;
  private userId: string;

  constructor(client: HeliusClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }

  // ── DCA Execution ────────────────────────────────────────────────────────

  /** Execute a single DCA buy if conditions are met */
  async executeDCA(config: DCAConfig, walletAddress: string): Promise<SwapResult & { reason?: string }> {
    // Check if it's time
    if (config.lastExecuted) {
      const hoursSinceLast = (Date.now() - new Date(config.lastExecuted).getTime()) / 3_600_000;
      if (hoursSinceLast < config.intervalHours) {
        return { success: false, inputAmount: '0', outputAmount: '0', reason: 'Not time yet' };
      }
    }

    // Check price limit
    if (config.maxPrice) {
      const { price } = await this.client.getTokenPrice(config.outputMint);
      if (price > config.maxPrice) {
        return {
          success: false,
          inputAmount: '0',
          outputAmount: '0',
          reason: `Price $${price.toFixed(4)} above max $${config.maxPrice}`,
        };
      }
    }

    // Check balance
    const solBalance = await this.client.getSolBalance(walletAddress);
    const requiredLamports = config.amountPerInterval + 10_000_000; // +0.01 SOL for fees
    if (solBalance < requiredLamports) {
      return {
        success: false,
        inputAmount: '0',
        outputAmount: '0',
        reason: `Insufficient SOL balance: ${(solBalance / 1e9).toFixed(4)} SOL`,
      };
    }

    // Execute swap
    return this.client.executeSwap({
      inputMint: config.inputMint,
      outputMint: config.outputMint,
      amount: config.amountPerInterval,
      userPublicKey: walletAddress,
      slippageBps: 100, // 1% slippage for DCA
    });
  }

  // ── Alert Checking ───────────────────────────────────────────────────────

  /** Check if any alerts should trigger */
  async checkAlerts(alerts: TradeAlert[]): Promise<TradeAlert[]> {
    const triggered: TradeAlert[] = [];
    const mints = [...new Set(alerts.map(a => a.tokenMint))];
    const prices = await this.client.getTokenPrices(mints);

    for (const alert of alerts) {
      if (alert.triggered) continue;
      const currentPrice = prices[alert.tokenMint] || 0;
      alert.currentValue = currentPrice;

      let shouldTrigger = false;
      switch (alert.alertType) {
        case 'price_above':
          shouldTrigger = currentPrice >= alert.targetValue;
          break;
        case 'price_below':
          shouldTrigger = currentPrice > 0 && currentPrice <= alert.targetValue;
          break;
        case 'volume_spike':
          // Would need volume data — placeholder
          break;
        case 'whale_move':
          // Would need transaction monitoring — placeholder
          break;
      }

      if (shouldTrigger) {
        alert.triggered = true;
        triggered.push(alert);
      }
    }

    return triggered;
  }

  // ── Portfolio Analysis ───────────────────────────────────────────────────

  /** Calculate P&L from transaction history */
  async calculatePnL(walletAddress: string): Promise<{
    realizedPnl: number;
    unrealizedPnl: number;
    totalFees: number;
    bestTrade: { token: string; pnlPct: number } | null;
    worstTrade: { token: string; pnlPct: number } | null;
  }> {
    // Get recent transactions
    const txs = await this.client.getTransactionHistory(walletAddress, 50);

    let totalFees = 0;
    let realizedPnl = 0;
    const trades: Array<{ token: string; pnlPct: number }> = [];

    for (const tx of txs) {
      if (tx.fee) totalFees += tx.fee / 1e9; // lamports to SOL

      // Parse swap transactions for P&L
      if (tx.type === 'SWAP' && tx.tokenTransfers) {
        const inTransfer = tx.tokenTransfers.find((t: any) => t.fromUserAccount === walletAddress);
        const outTransfer = tx.tokenTransfers.find((t: any) => t.toUserAccount === walletAddress);

        if (inTransfer && outTransfer) {
          // Simple P&L approximation
          const pnlPct = ((outTransfer.tokenAmount - inTransfer.tokenAmount) / inTransfer.tokenAmount) * 100;
          trades.push({ token: outTransfer.mint || 'Unknown', pnlPct });
          if (inTransfer.usdAmount && outTransfer.usdAmount) {
            realizedPnl += outTransfer.usdAmount - inTransfer.usdAmount;
          }
        }
      }
    }

    const sorted = trades.sort((a, b) => b.pnlPct - a.pnlPct);

    return {
      realizedPnl,
      unrealizedPnl: 0, // would need entry prices to calculate
      totalFees,
      bestTrade: sorted[0] || null,
      worstTrade: sorted[sorted.length - 1] || null,
    };
  }
}

// ─── Supabase Integration ────────────────────────────────────────────────────

/** Get Helius API key for a user (from user_api_keys or env) */
export async function getHeliusApiKey(userId?: string): Promise<string | null> {
  const readRpcKey = async (resolvedUserId: string, label: string | null): Promise<string | null> => {
    if (heliusReadRpcUnavailable) return null;

    const { data, error } = await supabase.rpc('get_user_api_key', {
      p_user_id: resolvedUserId,
      p_provider: 'helius',
      p_label: label,
    });

    if (error) {
      if (isMissingGetUserApiKeyRpc(error)) {
        heliusReadRpcUnavailable = true;
        if (!heliusReadRpcWarned) {
          console.warn('[heliusTrading] Missing Supabase RPC get_user_api_key. Apply the latest DB migrations or re-save your Helius key after updating the app to refresh the local cache.');
          heliusReadRpcWarned = true;
        }
      }
      return null;
    }

    if (Array.isArray(data) && data[0]?.api_key) return data[0].api_key;
    if (data && typeof data === 'object' && 'api_key' in data && (data as any).api_key) return (data as any).api_key;
    return null;
  };

  // 1. Try env variable
  const envKey = typeof process !== 'undefined'
    ? (process.env?.HELIUS_API_KEY || process.env?.EXPO_PUBLIC_HELIUS_API_KEY)
    : null;
  if (envKey) return envKey;

  // 2. Resolve the current user if caller did not provide one
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      const { data: authData } = await supabase.auth.getUser();
      resolvedUserId = authData.user?.id;
    } catch {
      resolvedUserId = undefined;
    }
  }
  if (!resolvedUserId) return null;

  let activeLabels: string[] | null = null;
  try {
    const { data: allKeys } = await supabase.rpc('list_user_api_keys');
    activeLabels = (allKeys || [])
      .filter((key: any) => key?.provider === 'helius' && key?.is_active)
      .map((key: any) => key.label)
      .filter((label: any) => typeof label === 'string');
  } catch {
    activeLabels = null;
  }

  if (activeLabels && activeLabels.length === 0) {
    await clearHeliusApiKeyLocalCache(resolvedUserId);
    return null;
  }

  const cachedKey = await readHeliusKeyFromLocalCache(resolvedUserId);
  if (cachedKey && (activeLabels === null || activeLabels.length > 0)) {
    return cachedKey;
  }

  const labelsToTry = ['Helius RPC', 'default', ...(activeLabels || [])]
    .filter((label, index, values) => values.indexOf(label) === index);

  const anyActiveKey = await readRpcKey(resolvedUserId, null);
  if (anyActiveKey) {
    await cacheHeliusApiKeyLocally(resolvedUserId, anyActiveKey);
    return anyActiveKey;
  }

  for (const label of labelsToTry) {
    const apiKey = await readRpcKey(resolvedUserId, label);
    if (apiKey) {
      await cacheHeliusApiKeyLocally(resolvedUserId, apiKey);
      return apiKey;
    }
  }

  return null;
}

/** Save a Helius API key for a user */
export async function saveHeliusApiKey(userId: string, apiKey: string): Promise<boolean> {
  const { error } = await supabase.rpc('store_user_api_key', {
    p_provider: 'helius',
    p_api_key: apiKey,
    p_label: 'Helius RPC',
  });
  if (error) return false;
  await cacheHeliusApiKeyLocally(userId, apiKey);
  return true;
}

/** Create a HeliusClient for the current user */
export async function createUserHeliusClient(userId?: string): Promise<HeliusClient | null> {
  const apiKey = await getHeliusApiKey(userId);
  if (!apiKey) return null;
  return new HeliusClient({ apiKey });
}

// ??? Bot Wallet Integration ??????????????????????????????????????????????????

async function invokeTradingBotWallet<T>(body: Record<string, any>): Promise<T> {
  const invalidSessionMessage = 'Your login session is invalid. Sign out and sign back in, then try again.';

  const attempt = async (token?: string): Promise<T> => {
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const { data, error } = await supabase.functions.invoke('trading-bot-wallet', { body, headers });

    if (error) {
      let errorMessage = '';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const errorBody = await error.context.json();
          errorMessage = errorBody?.error || error.message || String(error);
        } else {
          errorMessage = error.message || String(error);
        }
      } catch {
        errorMessage = error.message || String(error);
      }
      throw new Error(errorMessage);
    }

    return data as T;
  };

  // Get a fresh token via getUser() which forces a server-side validation + refresh
  const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!userData?.user) {
    tradingBotSessionInvalid = true;
    throw new Error(invalidSessionMessage);
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  try {
    const result = await attempt(token || undefined);
    tradingBotSessionInvalid = false;
    tradingBotInvalidAccessToken = null;
    return result;
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isAuthError = msg.includes('Not authenticated') || msg.includes('Invalid JWT') || msg.includes('unauthorized');

    if (isAuthError) {
      // Refresh session and retry once
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session?.access_token) {
          const result = await attempt(refreshed.session.access_token);
          tradingBotSessionInvalid = false;
          tradingBotInvalidAccessToken = null;
          return result;
        }
      } catch { /* fall through */ }

      tradingBotSessionInvalid = true;
      tradingBotInvalidAccessToken = null;
      throw new Error(invalidSessionMessage);
    }

    throw err;
  }
}

export async function getTradingBotWallet(circleId: string): Promise<TradingBotWalletInfo | null> {
  const data = await invokeTradingBotWallet<{ wallet?: TradingBotWalletInfo | null }>({
    action: 'status',
    circleId,
  });
  return data?.wallet || null;
}

export async function createTradingBotWallet(circleId: string): Promise<TradingBotWalletInfo> {
  const data = await invokeTradingBotWallet<{ wallet?: TradingBotWalletInfo; error?: string }>({
    action: 'create_wallet',
    circleId,
  });

  if (!data?.wallet) {
    throw new Error(data?.error || 'Failed to create bot wallet');
  }

  return data.wallet as TradingBotWalletInfo;
}

export async function setTradingBotWalletStatus(circleId: string, status: 'active' | 'paused'): Promise<TradingBotWalletInfo> {
  const data = await invokeTradingBotWallet<{ wallet?: TradingBotWalletInfo; error?: string }>({
    action: 'set_status',
    circleId,
    status,
  });

  if (!data?.wallet) {
    throw new Error(data?.error || 'Failed to update bot wallet status');
  }

  return data.wallet as TradingBotWalletInfo;
}

export async function executeBotWalletSwap(params: {
  circleId: string;
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
}): Promise<SwapResult & { walletAddress?: string }> {
  let data: any;
  try {
    data = await invokeTradingBotWallet<any>({
      action: 'execute_swap',
      circleId: params.circleId,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps || 150,
    });
  } catch (error: any) {
    return {
      success: false,
      inputAmount: String(params.amount),
      outputAmount: '0',
      error: error?.message || 'Bot wallet swap failed',
    };
  }

  if (data?.error) {
    return {
      success: false,
      inputAmount: String(params.amount),
      outputAmount: '0',
      error: data.error || 'Bot wallet swap failed',
    };
  }

  return {
    success: true,
    txHash: data?.txHash,
    inputAmount: data?.inputAmount || String(params.amount),
    outputAmount: data?.outputAmount || '0',
    walletAddress: data?.walletAddress,
  };
}

export async function getTradingBotAutopilotConfig(circleId: string): Promise<TradingBotAutopilotConfig> {
  const data = await invokeTradingBotWallet<{ config?: TradingBotAutopilotConfig; error?: string }>({
    action: 'get_config',
    circleId,
  });

  if (!data?.config) {
    throw new Error(data?.error || 'Failed to load bot autopilot config');
  }

  return data.config as TradingBotAutopilotConfig;
}

export async function saveTradingBotAutopilotConfig(
  circleId: string,
  config: Partial<TradingBotAutopilotConfig>,
): Promise<TradingBotAutopilotConfig> {
  const data = await invokeTradingBotWallet<{ config?: TradingBotAutopilotConfig; error?: string }>({
    action: 'save_config',
    circleId,
    config,
  });

  if (!data?.config) {
    throw new Error(data?.error || 'Failed to save bot autopilot config');
  }

  return data.config as TradingBotAutopilotConfig;
}

export async function runTradingBotAutopilot(
  circleId: string,
  options?: { force?: boolean; triggerSource?: string },
): Promise<TradingBotAutopilotResult> {
  let data: any;
  try {
    data = await invokeTradingBotWallet<any>({
      action: 'run_autopilot',
      circleId,
      force: options?.force === true,
      triggerSource: options?.triggerSource || 'dashboard',
    });
  } catch (error: any) {
    return {
      ok: false,
      status: 'error',
      message: error?.message || 'Bot autopilot failed',
    };
  }

  if (data?.error) {
    return {
      ok: false,
      status: data?.status || 'error',
      message: data.error,
      wallet: data?.wallet || null,
      config: data?.config || null,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: (data?.status || 'skipped') as TradingBotAutopilotResult['status'],
    message: data?.message || 'Bot autopilot finished.',
    wallet: data?.wallet || null,
    config: data?.config || null,
    executedTrade: data?.executedTrade || undefined,
  };
}

// ─── Bot Wallet Withdraw ─────────────────────────────────────────────────────

export interface BotWalletWithdrawResult {
  success: boolean;
  txHash: string;
  walletAddress: string;
  destination: string;
  amountLamports: number;
  amountSol: number;
}

export async function withdrawFromBotWallet(params: {
  circleId: string;
  destination: string;
  amountLamports?: number;
  withdrawAll?: boolean;
}): Promise<BotWalletWithdrawResult> {
  const data = await invokeTradingBotWallet<BotWalletWithdrawResult & { error?: string }>({
    action: 'execute_transfer',
    circleId: params.circleId,
    destination: params.destination,
    amountLamports: params.amountLamports,
    withdrawAll: params.withdrawAll || false,
  });
  if (data?.error) throw new Error(data.error);
  return data;
}

// ─── Momentum Scan & Rotate ─────────────────────────────────────────────────

export interface MomentumHolding {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  price: number;
  valueUsd: number;
  signal: {
    score: number;
    action: 'exit' | 'enter' | 'hold';
    reasons: string[];
  };
}

export interface MomentumScanResult {
  holdings: MomentumHolding[];
  exitCandidates: MomentumHolding[];
  entryCandidates: MomentumHolding[];
  executedTrade: {
    action: string;
    symbol: string;
    mint: string;
    score: number;
    reasons: string[];
    txHash?: string;
    inputAmount?: string;
    outputAmount?: string;
    error?: string;
  } | null;
}

export async function scanBotWalletMomentum(
  circleId: string,
  options?: { autoExecute?: boolean },
): Promise<MomentumScanResult> {
  const data = await invokeTradingBotWallet<MomentumScanResult & { error?: string }>({
    action: 'scan_and_rotate',
    circleId,
    autoExecute: options?.autoExecute || false,
  });
  if ((data as any)?.error) throw new Error((data as any).error);
  return data;
}

// ─── DCA Config Storage ──────────────────────────────────────────────────────

/** Save a DCA config to the database */
export async function saveDCAConfig(config: Omit<DCAConfig, 'id' | 'totalExecuted' | 'totalSpent'>): Promise<string | null> {
  const { data, error } = await supabase
    .from('trading_dca_configs')
    .insert({
      user_id: config.userId,
      input_mint: config.inputMint,
      output_mint: config.outputMint,
      amount_per_interval: config.amountPerInterval,
      interval_hours: config.intervalHours,
      max_price: config.maxPrice || null,
      is_active: config.isActive,
    })
    .select('id')
    .single();

  return error ? null : data?.id;
}

/** Get active DCA configs for a user */
export async function getUserDCAConfigs(userId: string): Promise<DCAConfig[]> {
  const { data } = await supabase
    .from('trading_dca_configs')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);

  return (data || []).map((d: any) => ({
    id: d.id,
    userId: d.user_id,
    inputMint: d.input_mint,
    outputMint: d.output_mint,
    amountPerInterval: d.amount_per_interval,
    intervalHours: d.interval_hours,
    maxPrice: d.max_price,
    isActive: d.is_active,
    lastExecuted: d.last_executed,
    totalExecuted: d.total_executed || 0,
    totalSpent: d.total_spent || 0,
  }));
}

// ─── Trade Alert Storage ─────────────────────────────────────────────────────

/** Save a trade alert */
export async function saveTradeAlert(alert: Omit<TradeAlert, 'id' | 'triggered' | 'createdAt'>): Promise<string | null> {
  const { data, error } = await supabase
    .from('trading_alerts')
    .insert({
      user_id: alert.userId,
      token_mint: alert.tokenMint,
      token_symbol: alert.tokenSymbol,
      alert_type: alert.alertType,
      target_value: alert.targetValue,
    })
    .select('id')
    .single();

  return error ? null : data?.id;
}

/** Get active alerts for a user */
export async function getUserAlerts(userId: string): Promise<TradeAlert[]> {
  const { data } = await supabase
    .from('trading_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('triggered', false);

  return (data || []).map((d: any) => ({
    id: d.id,
    userId: d.user_id,
    tokenMint: d.token_mint,
    tokenSymbol: d.token_symbol,
    alertType: d.alert_type,
    targetValue: d.target_value,
    triggered: d.triggered,
    createdAt: d.created_at,
  }));
}

// ─── Tracked Wallets (Copy Trading) ──────────────────────────────────────────

/** Save a wallet to track for copy trading */
export async function trackWallet(userId: string, walletAddress: string, label?: string): Promise<boolean> {
  const { error } = await supabase
    .from('trading_tracked_wallets')
    .insert({
      user_id: userId,
      wallet_address: walletAddress,
      label: label || walletAddress.slice(0, 8),
    });
  return !error;
}

/** Get tracked wallets for a user */
export async function getTrackedWallets(userId: string): Promise<Array<{ address: string; label: string }>> {
  const { data } = await supabase
    .from('trading_tracked_wallets')
    .select('wallet_address, label')
    .eq('user_id', userId);

  return (data || []).map((d: any) => ({
    address: d.wallet_address,
    label: d.label,
  }));
}

// ─── Trading Log ─────────────────────────────────────────────────────────────

/** Log a trade execution for history/P&L tracking */
export async function logTrade(params: {
  userId: string;
  circleId?: string;
  walletAddress: string;
  action: TradingAction;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceUsd?: number;
  txHash?: string;
  status: 'success' | 'failed' | 'skipped';
  reason?: string;
  executionMode?: TradingExecutionMode;
  strategyName?: string;
  backtestRunId?: string;
  metadata?: Record<string, any>;
  createdAt?: string;
}): Promise<void> {
  await supabase.from('trading_log').insert({
    user_id: params.userId,
    circle_id: params.circleId || null,
    wallet_address: params.walletAddress,
    action: params.action,
    input_mint: params.inputMint,
    output_mint: params.outputMint,
    input_amount: params.inputAmount,
    output_amount: params.outputAmount,
    price_usd: params.priceUsd || null,
    tx_hash: params.txHash || null,
    status: params.status,
    reason: params.reason || null,
    execution_mode: params.executionMode || 'live',
    strategy_name: params.strategyName || null,
    backtest_run_id: params.backtestRunId || null,
    metadata: params.metadata || {},
    created_at: params.createdAt || new Date().toISOString(),
  });
}

export async function getTradingLog(userId: string, executionMode: TradingExecutionMode | 'all' = 'all', limit = 100): Promise<TradeLogEntry[]> {
  let query = supabase
    .from('trading_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (executionMode !== 'all') {
    query = query.eq('execution_mode', executionMode);
  }

  const { data } = await query;
  return (data || []).map(mapTradeLogEntry);
}

function mapTradeLogEntry(d: any): TradeLogEntry {
  return {
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id || undefined,
    walletAddress: d.wallet_address,
    action: d.action,
    inputMint: d.input_mint || undefined,
    outputMint: d.output_mint || undefined,
    inputAmount: d.input_amount || undefined,
    outputAmount: d.output_amount || undefined,
    priceUsd: d.price_usd ? parseFloat(d.price_usd) : undefined,
    txHash: d.tx_hash || undefined,
    status: d.status,
    reason: d.reason || undefined,
    executionMode: (d.execution_mode || 'live') as TradingExecutionMode,
    strategyName: d.strategy_name || undefined,
    backtestRunId: d.backtest_run_id || undefined,
    metadata: d.metadata || {},
    createdAt: d.created_at,
  };
}

// ─── Pending Trade Actions ────────────────────────────────────────────────────

export interface PendingTradeAction {
  id: string;
  userId: string;
  circleId?: string;
  actionType: 'swap' | 'dca_buy' | 'limit_buy' | 'limit_sell' | 'stop_loss';
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  maxPrice?: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired';
  txHash?: string;
  outputAmount?: string;
  error?: string;
  proposedBy: string;
  source: string;
  expiresAt: string;
  createdAt: string;
}

/** Get pending trade actions for a user */
export async function getPendingActions(userId: string): Promise<PendingTradeAction[]> {
  const { data } = await supabase
    .from('trading_pending_actions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(50);

  return (data || []).map((d: any) => ({
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id,
    actionType: d.action_type,
    inputMint: d.input_mint,
    outputMint: d.output_mint,
    amountLamports: d.amount_lamports,
    slippageBps: d.slippage_bps,
    maxPrice: d.max_price,
    reason: d.reason,
    status: d.status,
    txHash: d.tx_hash,
    outputAmount: d.output_amount,
    error: d.error,
    proposedBy: d.proposed_by,
    source: d.source,
    expiresAt: d.expires_at,
    createdAt: d.created_at,
  }));
}

/** Get all actions (including executed/rejected) for history */
export async function getActionHistory(userId: string): Promise<PendingTradeAction[]> {
  const { data } = await supabase
    .from('trading_pending_actions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  return (data || []).map((d: any) => ({
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id,
    actionType: d.action_type,
    inputMint: d.input_mint,
    outputMint: d.output_mint,
    amountLamports: d.amount_lamports,
    slippageBps: d.slippage_bps,
    maxPrice: d.max_price,
    reason: d.reason,
    status: d.status,
    txHash: d.tx_hash,
    outputAmount: d.output_amount,
    error: d.error,
    proposedBy: d.proposed_by,
    source: d.source,
    expiresAt: d.expires_at,
    createdAt: d.created_at,
  }));
}

/** Approve a pending action (user confirms they want to execute) */
export async function approveAction(actionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('trading_pending_actions')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'pending');
  return !error;
}

/** Reject a pending action */
export async function rejectAction(actionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('trading_pending_actions')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'pending');
  return !error;
}

/** Mark an action as executed after Phantom signs the tx */
export async function markActionExecuted(actionId: string, txHash: string, outputAmount: string): Promise<boolean> {
  const { error } = await supabase
    .from('trading_pending_actions')
    .update({
      status: 'executed',
      tx_hash: txHash,
      output_amount: outputAmount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId);
  return !error;
}

/** Mark an action as failed */
export async function markActionFailed(actionId: string, errorMsg: string): Promise<boolean> {
  const { error } = await supabase
    .from('trading_pending_actions')
    .update({
      status: 'failed',
      error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId);
  return !error;
}

// ─── Featured Trades ──────────────────────────────────────────────────────────

/** Get active featured trades for a user */
export async function getFeaturedTrades(userId: string): Promise<FeaturedTrade[]> {
  const { data } = await supabase
    .from('featured_trades')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  return (data || []).map(mapFeaturedTrade);
}

/** Get featured trade history (all statuses) */
export async function getFeaturedTradeHistory(userId: string): Promise<FeaturedTrade[]> {
  const { data } = await supabase
    .from('featured_trades')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);

  return (data || []).map(mapFeaturedTrade);
}

/** Generate new featured trades via edge function */
export async function generateFeaturedTrades(userId: string): Promise<{ trades: any[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke('featured-trades-generator', {
    body: { userId },
  });

  if (error) return { trades: [], error: error.message };
  return { trades: data?.trades || [], error: data?.error };
}

/** Mark a featured trade as executed */
export async function executeFeaturedTrade(tradeId: string, txHash: string, inputAmount: string, outputAmount: string): Promise<boolean> {
  const { error: updateErr } = await supabase
    .from('featured_trades')
    .update({ status: 'executed', updated_at: new Date().toISOString() })
    .eq('id', tradeId);

  const { error: insertErr } = await supabase
    .from('featured_trade_executions')
    .insert({
      featured_trade_id: tradeId,
      user_id: (await supabase.auth.getUser()).data.user?.id,
      tx_hash: txHash,
      input_amount: inputAmount,
      output_amount: outputAmount,
      outcome: 'open',
    });

  return !updateErr && !insertErr;
}

/** Get featured trade performance stats */
export async function getFeaturedTradeStats(userId: string): Promise<{
  totalGenerated: number;
  totalExecuted: number;
  wins: number;
  losses: number;
  avgReturnPct: number;
}> {
  const { count: totalGenerated } = await supabase
    .from('featured_trades')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: executions } = await supabase
    .from('featured_trade_executions')
    .select('outcome, pnl_pct')
    .eq('user_id', userId);

  const execs = executions || [];
  const wins = execs.filter(e => e.outcome === 'win').length;
  const losses = execs.filter(e => e.outcome === 'loss').length;
  const avgReturn = execs.length > 0
    ? execs.reduce((sum, e) => sum + (e.pnl_pct || 0), 0) / execs.length
    : 0;

  return {
    totalGenerated: totalGenerated || 0,
    totalExecuted: execs.length,
    wins,
    losses,
    avgReturnPct: avgReturn,
  };
}

// ─── Position Tracking ────────────────────────────────────────────────────────

export interface Position {
  id: string;
  userId: string;
  circleId?: string;
  tokenMint: string;
  tokenSymbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryValueUsd: number;
  currentValueUsd: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
  entryTxHash?: string;
  executionMode: TradingExecutionMode;
  strategyName?: string;
  backtestRunId?: string;
  status: 'open' | 'closed' | 'stopped_out' | 'take_profit';
  openedAt: string;
  closedAt?: string;
}

/** Save an open position */
export async function savePosition(params: {
  userId: string;
  circleId?: string;
  tokenMint: string;
  tokenSymbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
  entryTxHash?: string;
  executionMode?: TradingExecutionMode;
  strategyName?: string;
  backtestRunId?: string;
}): Promise<string | null> {
  const entryValue = params.entryPrice * params.quantity;
  const { data, error } = await supabase
    .from('trading_positions')
    .insert({
      user_id: params.userId,
      circle_id: params.circleId || null,
      token_mint: params.tokenMint,
      token_symbol: params.tokenSymbol,
      side: params.side,
      entry_price: params.entryPrice,
      current_price: params.entryPrice,
      quantity: params.quantity,
      entry_value_usd: entryValue,
      current_value_usd: entryValue,
      unrealized_pnl: 0,
      unrealized_pnl_pct: 0,
      stop_loss_price: params.stopLossPrice || null,
      take_profit_price: params.takeProfitPrice || null,
      trailing_stop_pct: params.trailingStopPct || null,
      entry_tx_hash: params.entryTxHash || null,
      execution_mode: params.executionMode || 'live',
      strategy_name: params.strategyName || null,
      backtest_run_id: params.backtestRunId || null,
      status: 'open',
    })
    .select('id')
    .single();

  return error ? null : data?.id;
}

/** Get open positions for a user */
export async function getOpenPositions(userId: string, executionMode: TradingExecutionMode | 'all' = 'all'): Promise<Position[]> {
  let query = supabase
    .from('trading_positions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (executionMode !== 'all') {
    query = query.eq('execution_mode', executionMode);
  }

  const { data } = await query;
  return (data || []).map(mapPosition);
}

/** Get all positions (including closed) for history */
export async function getAllPositions(userId: string, executionMode: TradingExecutionMode | 'all' = 'all'): Promise<Position[]> {
  let query = supabase
    .from('trading_positions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (executionMode !== 'all') {
    query = query.eq('execution_mode', executionMode);
  }

  const { data } = await query;
  return (data || []).map(mapPosition);
}

/** Update position with current price */
export async function updatePositionPrice(positionId: string, currentPrice: number): Promise<boolean> {
  // First get the position to calculate P&L
  const { data: pos } = await supabase
    .from('trading_positions')
    .select('entry_price, quantity, side')
    .eq('id', positionId)
    .single();

  if (!pos) return false;

  const currentValue = currentPrice * pos.quantity;
  const entryValue = pos.entry_price * pos.quantity;
  const pnl = pos.side === 'long' ? currentValue - entryValue : entryValue - currentValue;
  const pnlPct = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

  const { error } = await supabase
    .from('trading_positions')
    .update({
      current_price: currentPrice,
      current_value_usd: currentValue,
      unrealized_pnl: pnl,
      unrealized_pnl_pct: pnlPct,
      updated_at: new Date().toISOString(),
    })
    .eq('id', positionId);

  return !error;
}

/** Close a position */
export async function closePosition(positionId: string, exitPrice: number, reason: 'manual' | 'stop_loss' | 'take_profit' | 'trailing_stop'): Promise<boolean> {
  const statusMap: Record<string, string> = {
    manual: 'closed',
    stop_loss: 'stopped_out',
    take_profit: 'take_profit',
    trailing_stop: 'stopped_out',
  };

  const { error } = await supabase
    .from('trading_positions')
    .update({
      status: statusMap[reason] || 'closed',
      current_price: exitPrice,
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', positionId);

  return !error;
}

function mapPosition(d: any): Position {
  return {
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id || undefined,
    tokenMint: d.token_mint,
    tokenSymbol: d.token_symbol,
    side: d.side || 'long',
    entryPrice: parseFloat(d.entry_price) || 0,
    currentPrice: parseFloat(d.current_price) || 0,
    quantity: parseFloat(d.quantity) || 0,
    entryValueUsd: parseFloat(d.entry_value_usd) || 0,
    currentValueUsd: parseFloat(d.current_value_usd) || 0,
    unrealizedPnl: parseFloat(d.unrealized_pnl) || 0,
    unrealizedPnlPct: parseFloat(d.unrealized_pnl_pct) || 0,
    stopLossPrice: d.stop_loss_price ? parseFloat(d.stop_loss_price) : undefined,
    takeProfitPrice: d.take_profit_price ? parseFloat(d.take_profit_price) : undefined,
    trailingStopPct: d.trailing_stop_pct ? parseFloat(d.trailing_stop_pct) : undefined,
    entryTxHash: d.entry_tx_hash,
    executionMode: (d.execution_mode || 'live') as TradingExecutionMode,
    strategyName: d.strategy_name || undefined,
    backtestRunId: d.backtest_run_id || undefined,
    status: d.status,
    openedAt: d.created_at,
    closedAt: d.closed_at,
  };
}

function mapPaperTradingAccount(d: any, openPositionValueUsd: number): PaperTradingAccount {
  const cashBalanceUsd = parseFloat(d.cash_balance_usd) || 0;
  return {
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id,
    baseCurrencySymbol: d.base_currency_symbol || 'USD',
    startingBalanceUsd: parseFloat(d.starting_balance_usd) || DEFAULT_PAPER_STARTING_BALANCE_USD,
    cashBalanceUsd,
    openPositionValueUsd,
    currentEquityUsd: cashBalanceUsd + openPositionValueUsd,
    realizedPnlUsd: parseFloat(d.realized_pnl_usd) || 0,
    totalTrades: d.total_trades || 0,
    wins: d.wins || 0,
    losses: d.losses || 0,
    lastResetAt: d.last_reset_at,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

function mapBacktestRun(d: any): BacktestRun {
  return {
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id || undefined,
    strategyKey: d.strategy_key,
    strategyName: d.strategy_name,
    tokenMint: d.token_mint,
    tokenSymbol: d.token_symbol,
    timeframeLabel: d.timeframe_label,
    initialCapitalUsd: parseFloat(d.initial_capital_usd) || 0,
    finalEquityUsd: parseFloat(d.final_equity_usd) || 0,
    netPnlUsd: parseFloat(d.net_pnl_usd) || 0,
    netPnlPct: parseFloat(d.net_pnl_pct) || 0,
    buyHoldReturnPct: parseFloat(d.buy_hold_return_pct) || 0,
    maxDrawdownPct: parseFloat(d.max_drawdown_pct) || 0,
    totalTrades: d.total_trades || 0,
    wins: d.wins || 0,
    losses: d.losses || 0,
    winRatePct: parseFloat(d.win_rate_pct) || 0,
    feeBps: d.fee_bps || 0,
    slippageBps: d.slippage_bps || 0,
    config: d.config || {},
    equityCurve: d.equity_curve || [],
    tradeLog: d.trade_log || [],
    createdAt: d.created_at,
  };
}

export async function getPaperTradingAccount(userId: string, circleId: string): Promise<PaperTradingAccount | null> {
  let { data: row } = await supabase
    .from('trading_paper_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('circle_id', circleId)
    .maybeSingle();

  if (!row) {
    const { data: inserted } = await supabase
      .from('trading_paper_accounts')
      .insert({
        user_id: userId,
        circle_id: circleId,
        base_currency_symbol: 'USD',
        starting_balance_usd: DEFAULT_PAPER_STARTING_BALANCE_USD,
        cash_balance_usd: DEFAULT_PAPER_STARTING_BALANCE_USD,
      })
      .select('*')
      .single();
    row = inserted || null;
  }

  if (!row) return null;

  const { data: positions } = await supabase
    .from('trading_positions')
    .select('current_value_usd')
    .eq('user_id', userId)
    .eq('circle_id', circleId)
    .eq('execution_mode', 'paper')
    .eq('status', 'open');

  const openPositionValueUsd = (positions || []).reduce((sum: number, position: any) => sum + (parseFloat(position.current_value_usd) || 0), 0);
  return mapPaperTradingAccount(row, openPositionValueUsd);
}

export async function resetPaperTradingAccount(userId: string, circleId: string, startingBalanceUsd = DEFAULT_PAPER_STARTING_BALANCE_USD): Promise<PaperTradingAccount | null> {
  const now = new Date().toISOString();
  await supabase
    .from('trading_positions')
    .update({
      status: 'closed',
      current_price: 0,
      current_value_usd: 0,
      unrealized_pnl: 0,
      unrealized_pnl_pct: 0,
      closed_at: now,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('circle_id', circleId)
    .eq('execution_mode', 'paper')
    .eq('status', 'open');

  await supabase
    .from('trading_paper_accounts')
    .upsert({
      user_id: userId,
      circle_id: circleId,
      base_currency_symbol: 'USD',
      starting_balance_usd: startingBalanceUsd,
      cash_balance_usd: startingBalanceUsd,
      realized_pnl_usd: 0,
      total_trades: 0,
      wins: 0,
      losses: 0,
      last_reset_at: now,
      updated_at: now,
    }, { onConflict: 'user_id,circle_id' });

  return getPaperTradingAccount(userId, circleId);
}

export async function openPaperPosition(params: {
  userId: string;
  circleId: string;
  tokenMint: string;
  tokenSymbol: string;
  entryPrice: number;
  notionalUsd: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPct?: number;
  strategyName?: string;
  reason?: string;
}): Promise<{ positionId: string | null; account: PaperTradingAccount | null; error?: string }> {
  const account = await getPaperTradingAccount(params.userId, params.circleId);
  if (!account) {
    return { positionId: null, account: null, error: 'Paper account is unavailable.' };
  }

  const sanitizedPrice = Math.max(params.entryPrice, 0.0000001);
  const notionalUsd = Math.max(0, params.notionalUsd);
  if (notionalUsd < 25) {
    return { positionId: null, account, error: 'Paper trades must be at least $25.' };
  }

  const entryFillPrice = sanitizedPrice * (1 + (PAPER_SLIPPAGE_BPS / 10000));
  const entryFeeUsd = notionalUsd * (PAPER_ENTRY_FEE_BPS / 10000);
  const totalDebitUsd = notionalUsd + entryFeeUsd;
  if (account.cashBalanceUsd < totalDebitUsd) {
    return { positionId: null, account, error: 'Not enough paper cash to open this trade.' };
  }

  const quantity = notionalUsd / entryFillPrice;
  const positionId = await savePosition({
    userId: params.userId,
    circleId: params.circleId,
    tokenMint: params.tokenMint,
    tokenSymbol: params.tokenSymbol,
    side: 'long',
    entryPrice: entryFillPrice,
    quantity,
    stopLossPrice: params.stopLossPrice,
    takeProfitPrice: params.takeProfitPrice,
    trailingStopPct: params.trailingStopPct,
    executionMode: 'paper',
    strategyName: params.strategyName,
  });

  if (!positionId) {
    return { positionId: null, account, error: 'Could not save the paper position.' };
  }

  await supabase
    .from('trading_paper_accounts')
    .update({
      cash_balance_usd: account.cashBalanceUsd - totalDebitUsd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id);

  await logTrade({
    userId: params.userId,
    circleId: params.circleId,
    walletAddress: `paper:${params.circleId}`,
    action: 'swap',
    inputMint: USDC_MINT,
    outputMint: params.tokenMint,
    inputAmount: totalDebitUsd.toFixed(2),
    outputAmount: quantity.toFixed(6),
    priceUsd: entryFillPrice,
    status: 'success',
    reason: params.reason || `Paper entry: ${params.tokenSymbol}`,
    executionMode: 'paper',
    strategyName: params.strategyName,
    metadata: {
      entryFeeUsd,
      notionalUsd,
      positionId,
    },
  });

  return {
    positionId,
    account: await getPaperTradingAccount(params.userId, params.circleId),
  };
}

export async function closePaperPosition(positionId: string, exitPrice: number, reason: 'manual' | 'stop_loss' | 'take_profit' | 'trailing_stop'): Promise<boolean> {
  const { data } = await supabase
    .from('trading_positions')
    .select('*')
    .eq('id', positionId)
    .single();

  if (!data) return false;
  const position = mapPosition(data);
  if (position.executionMode !== 'paper') {
    return closePosition(positionId, exitPrice, reason);
  }

  const effectiveExitPrice = Math.max(exitPrice, 0.0000001) * (1 - (PAPER_SLIPPAGE_BPS / 10000));
  const grossValueUsd = position.quantity * effectiveExitPrice;
  const exitFeeUsd = grossValueUsd * (PAPER_EXIT_FEE_BPS / 10000);
  const realizedUsd = grossValueUsd - exitFeeUsd;
  const pnlUsd = realizedUsd - position.entryValueUsd;
  const pnlPct = position.entryValueUsd > 0 ? (pnlUsd / position.entryValueUsd) * 100 : 0;
  const now = new Date().toISOString();
  const statusMap: Record<string, string> = {
    manual: 'closed',
    stop_loss: 'stopped_out',
    take_profit: 'take_profit',
    trailing_stop: 'stopped_out',
  };

  const { error: positionError } = await supabase
    .from('trading_positions')
    .update({
      status: statusMap[reason] || 'closed',
      current_price: effectiveExitPrice,
      current_value_usd: grossValueUsd,
      unrealized_pnl: pnlUsd,
      unrealized_pnl_pct: pnlPct,
      closed_at: now,
      updated_at: now,
    })
    .eq('id', positionId);

  if (positionError) return false;

  const account = position.circleId ? await getPaperTradingAccount(position.userId, position.circleId) : null;
  if (account) {
    await supabase
      .from('trading_paper_accounts')
      .update({
        cash_balance_usd: account.cashBalanceUsd + realizedUsd,
        realized_pnl_usd: account.realizedPnlUsd + pnlUsd,
        total_trades: account.totalTrades + 1,
        wins: account.wins + (pnlUsd > 0 ? 1 : 0),
        losses: account.losses + (pnlUsd <= 0 ? 1 : 0),
        updated_at: now,
      })
      .eq('id', account.id);
  }

  await logTrade({
    userId: position.userId,
    circleId: position.circleId,
    walletAddress: `paper:${position.circleId || 'default'}`,
    action: 'swap',
    inputMint: position.tokenMint,
    outputMint: USDC_MINT,
    inputAmount: position.quantity.toFixed(6),
    outputAmount: realizedUsd.toFixed(2),
    priceUsd: effectiveExitPrice,
    status: 'success',
    reason: `Paper exit: ${reason}`,
    executionMode: 'paper',
    strategyName: position.strategyName,
    metadata: {
      positionId,
      pnlUsd,
      exitFeeUsd,
    },
  });

  return true;
}

function isMissingTradingBacktestRunsTable(error: any): boolean {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return error?.code === 'PGRST205'
    || error?.status === 404
    || message.includes('trading_backtest_runs');
}

export async function saveBacktestRun(params: {
  userId: string;
  circleId?: string;
  strategyKey: string;
  strategyName: string;
  tokenMint: string;
  tokenSymbol: string;
  timeframeLabel?: string;
  initialCapitalUsd: number;
  finalEquityUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  feeBps: number;
  slippageBps: number;
  config: Record<string, any>;
  equityCurve: Array<{ index: number; time: string; equityUsd: number }>;
  tradeLog: Array<Record<string, any>>;
}): Promise<BacktestRun | null> {
  const { data, error } = await supabase
    .from('trading_backtest_runs')
    .insert({
      user_id: params.userId,
      circle_id: params.circleId || null,
      strategy_key: params.strategyKey,
      strategy_name: params.strategyName,
      token_mint: params.tokenMint,
      token_symbol: params.tokenSymbol,
      timeframe_label: params.timeframeLabel || '24h snapshot',
      initial_capital_usd: params.initialCapitalUsd,
      final_equity_usd: params.finalEquityUsd,
      net_pnl_usd: params.netPnlUsd,
      net_pnl_pct: params.netPnlPct,
      buy_hold_return_pct: params.buyHoldReturnPct,
      max_drawdown_pct: params.maxDrawdownPct,
      total_trades: params.totalTrades,
      wins: params.wins,
      losses: params.losses,
      win_rate_pct: params.winRatePct,
      fee_bps: params.feeBps,
      slippage_bps: params.slippageBps,
      config: params.config,
      equity_curve: params.equityCurve,
      trade_log: params.tradeLog,
    })
    .select('*')
    .single();

  if (error) {
    if (isMissingTradingBacktestRunsTable(error)) {
      tradingBacktestRunsUnavailable = true;
      return null;
    }
    return null;
  }

  return !data ? null : mapBacktestRun(data);
}

export async function getBacktestRuns(userId: string, circleId?: string, limit = 12): Promise<BacktestRun[]> {
  let query = supabase
    .from('trading_backtest_runs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (circleId) {
    query = query.eq('circle_id', circleId);
  }

  const { data } = await query;
  return (data || []).map(mapBacktestRun);
}

// ─── Token Risk Scoring ───────────────────────────────────────────────────────

export interface TokenRiskScore {
  mint: string;
  symbol: string;
  overallScore: number; // 0-100 (100 = safest)
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: {
    liquidity: number;       // 0-20
    holderDistribution: number; // 0-20
    contractSecurity: number;   // 0-20
    volumeHealth: number;       // 0-20
    priceStability: number;     // 0-20
  };
  warnings: string[];
  checkedAt: string;
}

// ─── Technical Indicators ─────────────────────────────────────────────────────

export interface TechnicalSignal {
  indicator: string;
  value: number;
  signal: 'buy' | 'sell' | 'neutral';
  strength: number; // 0-1
}

export interface TechnicalAnalysis {
  mint: string;
  symbol: string;
  currentPrice: number;
  signals: TechnicalSignal[];
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  overallScore: number; // -100 to 100
  support: number;
  resistance: number;
  analyzedAt: string;
}

// ─── Portfolio Rebalancing ────────────────────────────────────────────────────

export interface RebalanceTarget {
  tokenMint: string;
  tokenSymbol: string;
  targetPct: number;
  currentPct: number;
  diffPct: number;
  action: 'buy' | 'sell' | 'hold';
  amountUsd: number;
}

export interface RebalancePlan {
  totalPortfolioValue: number;
  targets: RebalanceTarget[];
  estimatedSwaps: number;
  estimatedFeesUsd: number;
}

// ─── Extended TradingBot Methods ──────────────────────────────────────────────

/** Check all open positions against stop-loss and take-profit levels */
export async function checkPositionStops(client: HeliusClient, userId: string): Promise<{
  stoppedOut: Position[];
  tookProfit: Position[];
}> {
  const positions = await getOpenPositions(userId, 'all');
  const stoppedOut: Position[] = [];
  const tookProfit: Position[] = [];

  // Get current prices for all position tokens
  const mints = [...new Set(positions.map(p => p.tokenMint))];
  const prices = await client.getTokenPrices(mints);

  for (const pos of positions) {
    const currentPrice = prices[pos.tokenMint];
    if (!currentPrice) continue;

    // Update price
    await updatePositionPrice(pos.id, currentPrice);

    // Check stop-loss
    if (pos.stopLossPrice) {
      const hitStop = pos.side === 'long'
        ? currentPrice <= pos.stopLossPrice
        : currentPrice >= pos.stopLossPrice;
      if (hitStop) {
        if (pos.executionMode === 'paper') {
          await closePaperPosition(pos.id, currentPrice, 'stop_loss');
        } else {
          await closePosition(pos.id, currentPrice, 'stop_loss');
        }
        stoppedOut.push({ ...pos, currentPrice });
      }
    }

    // Check take-profit
    if (pos.takeProfitPrice) {
      const hitTP = pos.side === 'long'
        ? currentPrice >= pos.takeProfitPrice
        : currentPrice <= pos.takeProfitPrice;
      if (hitTP) {
        if (pos.executionMode === 'paper') {
          await closePaperPosition(pos.id, currentPrice, 'take_profit');
        } else {
          await closePosition(pos.id, currentPrice, 'take_profit');
        }
        tookProfit.push({ ...pos, currentPrice });
      }
    }

    // Check trailing stop
    if (pos.trailingStopPct && pos.trailingStopPct > 0) {
      const highWaterMark = Math.max(pos.currentPrice, currentPrice);
      const trailingStopPrice = highWaterMark * (1 - pos.trailingStopPct / 100);
      if (pos.side === 'long' && currentPrice <= trailingStopPrice) {
        if (pos.executionMode === 'paper') {
          await closePaperPosition(pos.id, currentPrice, 'trailing_stop');
        } else {
          await closePosition(pos.id, currentPrice, 'trailing_stop');
        }
        stoppedOut.push({ ...pos, currentPrice });
      }
    }
  }

  return { stoppedOut, tookProfit };
}

/** Score a token's risk level using on-chain data */
export async function scoreTokenRisk(client: HeliusClient, mint: string, symbol: string): Promise<TokenRiskScore> {
  const warnings: string[] = [];
  let liquidity = 10;
  let holderDistribution = 10;
  let contractSecurity = 10;
  let volumeHealth = 10;
  let priceStability = 10;

  try {
    // 1. Get asset info for contract security checks
    const asset = await client.getAsset(mint);
    if (asset) {
      // Check mint authority
      if (asset.authorities?.some((a: any) => a.scopes?.includes('full'))) {
        warnings.push('Mint authority not revoked — supply can increase');
        contractSecurity -= 8;
      } else {
        contractSecurity += 5;
      }
      // Check freeze authority
      if (asset.ownership?.frozen) {
        warnings.push('Token has active freeze authority');
        contractSecurity -= 5;
      } else {
        contractSecurity += 3;
      }
      // Check if verified
      if (asset.content?.metadata?.name) {
        contractSecurity += 2;
      }
    }
  } catch {
    warnings.push('Could not verify contract details');
    contractSecurity = 5;
  }

  try {
    // 2. Check liquidity via Jupiter quote (how much to move price 2%)
    const testAmount = 1_000_000_000; // 1 SOL worth
    const quote = await client.getSwapQuote({
      inputMint: SOL_MINT,
      outputMint: mint,
      amount: testAmount,
      userPublicKey: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', // dummy key for quote
      slippageBps: 500,
    });
    if (quote) {
      const impact = quote.priceImpactPct || 0;
      if (impact < 0.5) { liquidity = 20; }
      else if (impact < 2) { liquidity = 15; }
      else if (impact < 5) { liquidity = 10; warnings.push(`${impact.toFixed(1)}% price impact for 1 SOL trade`); }
      else { liquidity = 5; warnings.push(`High price impact: ${impact.toFixed(1)}% — thin liquidity`); }
    }
  } catch {
    liquidity = 5;
    warnings.push('Could not assess liquidity');
  }

  try {
    // 3. Price stability — get price and estimate volatility from recent trades
    const { price } = await client.getTokenPrice(mint);
    if (price > 0) {
      // Known tokens get stability bonus
      const isKnown = Object.values(SOLANA_TOKEN_REGISTRY).some(t => t.mint === mint);
      if (isKnown) {
        priceStability = 18;
      } else if (price > 1) {
        priceStability = 14;
      } else if (price > 0.01) {
        priceStability = 10;
      } else {
        priceStability = 6;
        warnings.push('Micro-cap token — high volatility expected');
      }
    }
  } catch {
    priceStability = 5;
  }

  // Known tokens get holder distribution bonus
  const isRegistered = Object.values(SOLANA_TOKEN_REGISTRY).some(t => t.mint === mint);
  if (isRegistered) {
    holderDistribution = 17;
    volumeHealth = 16;
  } else {
    holderDistribution = 8;
    volumeHealth = 8;
    warnings.push('Unverified token — verify holder concentration manually');
  }

  // Clamp all factors to 0-20
  const clamp = (v: number) => Math.max(0, Math.min(20, v));
  const factors = {
    liquidity: clamp(liquidity),
    holderDistribution: clamp(holderDistribution),
    contractSecurity: clamp(contractSecurity),
    volumeHealth: clamp(volumeHealth),
    priceStability: clamp(priceStability),
  };

  const overallScore = factors.liquidity + factors.holderDistribution + factors.contractSecurity + factors.volumeHealth + factors.priceStability;

  let grade: TokenRiskScore['grade'];
  if (overallScore >= 80) grade = 'A';
  else if (overallScore >= 65) grade = 'B';
  else if (overallScore >= 50) grade = 'C';
  else if (overallScore >= 35) grade = 'D';
  else grade = 'F';

  return {
    mint,
    symbol,
    overallScore,
    grade,
    factors,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

/** Generate a portfolio rebalance plan */
export async function generateRebalancePlan(
  client: HeliusClient,
  walletAddress: string,
  targets: Array<{ mint: string; symbol: string; targetPct: number }>,
): Promise<RebalancePlan> {
  const portfolio = await client.getPortfolio(walletAddress);
  const totalValue = portfolio.totalValueUsd;

  const rebalanceTargets: RebalanceTarget[] = targets.map(target => {
    const currentToken = portfolio.tokens.find(t => t.mint === target.mint);
    const currentValue = currentToken?.usdValue || 0;
    const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const diffPct = target.targetPct - currentPct;
    const amountUsd = Math.abs(diffPct / 100) * totalValue;

    let action: 'buy' | 'sell' | 'hold' = 'hold';
    if (diffPct > 2) action = 'buy';  // only rebalance if >2% off target
    else if (diffPct < -2) action = 'sell';

    return {
      tokenMint: target.mint,
      tokenSymbol: target.symbol,
      targetPct: target.targetPct,
      currentPct: Math.round(currentPct * 100) / 100,
      diffPct: Math.round(diffPct * 100) / 100,
      action,
      amountUsd: Math.round(amountUsd * 100) / 100,
    };
  });

  const swapsNeeded = rebalanceTargets.filter(t => t.action !== 'hold').length;

  return {
    totalPortfolioValue: totalValue,
    targets: rebalanceTargets,
    estimatedSwaps: swapsNeeded,
    estimatedFeesUsd: swapsNeeded * 0.02, // ~$0.02 per swap on Solana
  };
}

/** Calculate simple technical signals for a token */
export function calculateTechnicalSignals(
  prices: number[],
  symbol: string,
  mint: string,
): TechnicalAnalysis {
  const currentPrice = prices[prices.length - 1] || 0;
  const signals: TechnicalSignal[] = [];

  // RSI (14-period)
  if (prices.length >= 15) {
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = prices.length - 14; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) { gains.push(change); losses.push(0); }
      else { gains.push(0); losses.push(Math.abs(change)); }
    }
    const avgGain = gains.reduce((s, g) => s + g, 0) / 14;
    const avgLoss = losses.reduce((s, l) => s + l, 0) / 14;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = 100 - (100 / (1 + rs));

    let rsiSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    let rsiStrength = 0;
    if (rsi < 30) { rsiSignal = 'buy'; rsiStrength = (30 - rsi) / 30; }
    else if (rsi > 70) { rsiSignal = 'sell'; rsiStrength = (rsi - 70) / 30; }
    else { rsiStrength = 0.3; }

    signals.push({ indicator: 'RSI(14)', value: Math.round(rsi * 10) / 10, signal: rsiSignal, strength: Math.min(1, rsiStrength) });
  }

  // EMA Crossover (9/21)
  if (prices.length >= 22) {
    const ema9 = calculateEMA(prices, 9);
    const ema21 = calculateEMA(prices, 21);
    const crossoverSignal: 'buy' | 'sell' | 'neutral' = ema9 > ema21 ? 'buy' : ema9 < ema21 ? 'sell' : 'neutral';
    const crossoverDiff = ema21 > 0 ? Math.abs(ema9 - ema21) / ema21 : 0;

    signals.push({ indicator: 'EMA(9/21)', value: Math.round((ema9 / ema21) * 1000) / 1000, signal: crossoverSignal, strength: Math.min(1, crossoverDiff * 20) });
  }

  // Bollinger Bands (20-period, 2σ)
  if (prices.length >= 20) {
    const last20 = prices.slice(-20);
    const sma20 = last20.reduce((s, p) => s + p, 0) / 20;
    const variance = last20.reduce((s, p) => s + Math.pow(p - sma20, 2), 0) / 20;
    const stdDev = Math.sqrt(variance);
    const upper = sma20 + 2 * stdDev;
    const lower = sma20 - 2 * stdDev;
    const pctB = stdDev > 0 ? (currentPrice - lower) / (upper - lower) : 0.5;

    let bbSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    let bbStrength = 0;
    if (pctB < 0.05) { bbSignal = 'buy'; bbStrength = 0.9; }
    else if (pctB < 0.2) { bbSignal = 'buy'; bbStrength = 0.5; }
    else if (pctB > 0.95) { bbSignal = 'sell'; bbStrength = 0.9; }
    else if (pctB > 0.8) { bbSignal = 'sell'; bbStrength = 0.5; }
    else { bbStrength = 0.2; }

    signals.push({ indicator: 'BB(%B)', value: Math.round(pctB * 1000) / 1000, signal: bbSignal, strength: bbStrength });
  }

  // MACD (12/26/9)
  if (prices.length >= 27) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macdLine = ema12 - ema26;
    // Simplified signal line using recent MACD trend
    const prevEma12 = calculateEMA(prices.slice(0, -1), 12);
    const prevEma26 = calculateEMA(prices.slice(0, -1), 26);
    const prevMacd = prevEma12 - prevEma26;
    const macdCrossUp = macdLine > 0 && prevMacd <= 0;
    const macdCrossDown = macdLine < 0 && prevMacd >= 0;

    let macdSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    let macdStrength = 0;
    if (macdCrossUp) { macdSignal = 'buy'; macdStrength = 0.8; }
    else if (macdCrossDown) { macdSignal = 'sell'; macdStrength = 0.8; }
    else if (macdLine > 0) { macdSignal = 'buy'; macdStrength = 0.3; }
    else if (macdLine < 0) { macdSignal = 'sell'; macdStrength = 0.3; }

    signals.push({ indicator: 'MACD', value: Math.round(macdLine * 10000) / 10000, signal: macdSignal, strength: macdStrength });
  }

  // Momentum (10-period rate of change)
  if (prices.length >= 11) {
    const momentum = ((currentPrice - prices[prices.length - 11]) / prices[prices.length - 11]) * 100;
    let momSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    let momStrength = Math.min(1, Math.abs(momentum) / 20);
    if (momentum > 5) { momSignal = 'buy'; }
    else if (momentum < -5) { momSignal = 'sell'; }

    signals.push({ indicator: 'MOM(10)', value: Math.round(momentum * 100) / 100, signal: momSignal, strength: momStrength });
  }

  // Volume-weighted price trend (simple approximation)
  if (prices.length >= 5) {
    const recent5 = prices.slice(-5);
    const isUptrend = recent5[4] > recent5[0] && recent5[3] > recent5[1];
    const isDowntrend = recent5[4] < recent5[0] && recent5[3] < recent5[1];
    const trendPct = ((recent5[4] - recent5[0]) / recent5[0]) * 100;

    signals.push({
      indicator: 'Trend(5)',
      value: Math.round(trendPct * 100) / 100,
      signal: isUptrend ? 'buy' : isDowntrend ? 'sell' : 'neutral',
      strength: Math.min(1, Math.abs(trendPct) / 10),
    });
  }

  // Calculate overall score (-100 to 100)
  let totalScore = 0;
  let totalWeight = 0;
  for (const sig of signals) {
    const directionMultiplier = sig.signal === 'buy' ? 1 : sig.signal === 'sell' ? -1 : 0;
    totalScore += directionMultiplier * sig.strength * 100;
    totalWeight += 1;
  }
  const overallScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

  let overallSignal: TechnicalAnalysis['overallSignal'];
  if (overallScore >= 40) overallSignal = 'strong_buy';
  else if (overallScore >= 15) overallSignal = 'buy';
  else if (overallScore <= -40) overallSignal = 'strong_sell';
  else if (overallScore <= -15) overallSignal = 'sell';
  else overallSignal = 'neutral';

  // Support and resistance from recent prices
  const recentPrices = prices.slice(-20);
  const support = Math.min(...recentPrices);
  const resistance = Math.max(...recentPrices);

  return {
    mint,
    symbol,
    currentPrice,
    signals,
    overallSignal,
    overallScore,
    support: Math.round(support * 10000) / 10000,
    resistance: Math.round(resistance * 10000) / 10000,
    analyzedAt: new Date().toISOString(),
  };
}

/** Calculate Exponential Moving Average */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period; // SMA as seed
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

/** Expire stale pending actions (older than their expiry time) */
export async function expirePendingActions(userId: string): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('trading_pending_actions')
    .update({ status: 'expired', updated_at: now })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lt('expires_at', now)
    .select('id');

  return data?.length || 0;
}

/** Get portfolio allocation percentages */
export async function getPortfolioAllocation(client: HeliusClient, walletAddress: string): Promise<Array<{
  mint: string;
  symbol: string;
  valuePct: number;
  valueUsd: number;
}>> {
  const portfolio = await client.getPortfolio(walletAddress);
  const total = portfolio.totalValueUsd;
  if (total <= 0) return [];

  return portfolio.tokens
    .filter(t => t.usdValue > 0)
    .map(t => ({
      mint: t.mint,
      symbol: t.symbol,
      valuePct: Math.round((t.usdValue / total) * 10000) / 100,
      valueUsd: Math.round(t.usdValue * 100) / 100,
    }))
    .sort((a, b) => b.valuePct - a.valuePct);
}

function mapFeaturedTrade(d: any): FeaturedTrade {
  return {
    id: d.id,
    userId: d.user_id,
    title: d.title,
    description: d.description,
    tradeType: d.trade_type,
    direction: d.direction,
    confidence: d.confidence,
    timeframe: d.timeframe,
    inputMint: d.input_mint,
    outputMint: d.output_mint,
    inputSymbol: d.input_symbol,
    outputSymbol: d.output_symbol,
    suggestedAmountSol: parseFloat(d.suggested_amount_sol) || 0.1,
    suggestedSlippageBps: d.suggested_slippage_bps || 50,
    sequenceId: d.sequence_id,
    sequenceOrder: d.sequence_order || 0,
    entryReasoning: d.entry_reasoning,
    exitStrategy: d.exit_strategy,
    riskLevel: d.risk_level,
    expectedReturnPct: d.expected_return_pct ? parseFloat(d.expected_return_pct) : undefined,
    stopLossPct: d.stop_loss_pct ? parseFloat(d.stop_loss_pct) : undefined,
    generatedBy: d.generated_by,
    status: d.status,
    expiresAt: d.expires_at,
    createdAt: d.created_at,
  };
}










