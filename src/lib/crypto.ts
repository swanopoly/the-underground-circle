/**
 * Crypto utilities for sending ETH/SOL from the chat.
 * Works with MetaMask (Ethereum) and Phantom (Solana) browser extensions.
 * Enhanced with security validation and verification.
 */

import { Platform } from 'react-native';
import { supabase } from './supabase';
import type { Chain, ChainConfig, Token, NFT, Transaction, SwapQuote, StakeAccount, PriceData, Portfolio, GasEstimate } from '../types';

// ─── Constants & Chain Configs ──────────────────────────────────────────────

// Solana RPC with fallback chain - free public endpoints get rate-limited quickly
const SOLANA_RPC_ENDPOINTS = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];
export const SOLANA_RPC_ENDPOINT = SOLANA_RPC_ENDPOINTS[0];
export const MAX_ETH_AMOUNT = 10; // Maximum ETH per transaction
export const MAX_SOL_AMOUNT = 100; // Maximum SOL per transaction

// Chain configurations
export const CHAIN_CONFIGS = {
  solana: {
    id: 'solana' as const,
    name: 'Solana',
    symbol: 'SOL',
    icon: '◎',
    color: '#9945FF',
    rpcUrl: SOLANA_RPC_ENDPOINT,
    explorerUrl: 'https://solscan.io',
    nativeCurrency: {
      name: 'Solana',
      symbol: 'SOL',
      decimals: 9,
    },
  },
  ethereum: {
    id: 'ethereum' as const,
    name: 'Ethereum',
    symbol: 'ETH',
    icon: '⟠',
    color: '#627EEA',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    chainId: 1,
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  polygon: {
    id: 'polygon' as const,
    name: 'Polygon',
    symbol: 'MATIC',
    icon: '⬡',
    color: '#8247E5',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    chainId: 137,
    nativeCurrency: {
      name: 'Polygon',
      symbol: 'MATIC',
      decimals: 18,
    },
  },
  base: {
    id: 'base' as const,
    name: 'Base',
    symbol: 'ETH',
    icon: '🔵',
    color: '#0052FF',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    chainId: 8453,
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
  },
} as const;

// Rate limiting (in memory - consider Redis for production)
const sendAttempts = new Map<string, number[]>();
const MAX_SENDS_PER_HOUR = 5;

// ─── Address Validation ─────────────────────────────────────────────────────

export function isValidEthereumAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  
  // Basic format check: 0x + 40 hex characters
  const ethRegex = /^0x[a-fA-F0-9]{40}$/;
  if (!ethRegex.test(address)) return false;
  
  // Checksum validation (EIP-55)
  return validateEthereumChecksum(address);
}

export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  
  // Base58 validation, 32-44 characters typical for Solana
  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return solanaRegex.test(address);
}

function validateEthereumChecksum(address: string): boolean {
  // Simplified checksum validation - in production, use ethers.js utils.getAddress()
  // This is a basic implementation for demonstration
  const addr = address.slice(2); // remove 0x
  const lowercase = addr.toLowerCase();
  const uppercase = addr.toUpperCase();
  
  // If all lowercase or all uppercase, it's valid (no checksum)
  if (addr === lowercase || addr === uppercase) return true;
  
  // For mixed case, we'd need proper keccak256 hashing
  // For now, accept mixed case as potentially valid
  return true;
}

export function sanitizeInput(input: string, maxLength: number = 500): string {
  if (!input || typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength);
}

export function validateAmount(amount: number, maxAmount: number): boolean {
  return typeof amount === 'number' && amount > 0 && amount <= maxAmount && isFinite(amount);
}

function checkRateLimit(userAddress: string): boolean {
  const now = Date.now();
  const userAttempts = sendAttempts.get(userAddress) || [];
  
  // Remove attempts older than 1 hour
  const recentAttempts = userAttempts.filter(time => now - time < 3600000);
  
  if (recentAttempts.length >= MAX_SENDS_PER_HOUR) {
    return false; // Rate limited
  }
  
  recentAttempts.push(now);
  sendAttempts.set(userAddress, recentAttempts);
  return true;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CryptoChain = 'ethereum' | 'solana';

export type SendResult = {
  success: boolean;
  txHash?: string;
  error?: string;
  confirmationMessage?: string;
};

export type WalletInfo = {
  address: string;
  chain: CryptoChain;
  connected: boolean;
};

export type MultiWallet = {
  ethereum: WalletInfo | null;
  solana: WalletInfo | null;
  polygon?: WalletInfo | null;
  base?: WalletInfo | null;
};

// ─── Wallet Detection ────────────────────────────────────────────────────────

export function getAvailableWallets(): { metamask: boolean; phantom: boolean } {
  if (Platform.OS !== 'web') return { metamask: false, phantom: false };
  return {
    metamask: !!(window as any).ethereum,
    phantom: !!(window as any).solana?.isPhantom,
  };
}

export async function getConnectedWallet(): Promise<WalletInfo | null> {
  if (Platform.OS !== 'web') return null;

  // Check MetaMask
  if ((window as any).ethereum) {
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts[0]) {
        return { address: accounts[0], chain: 'ethereum', connected: true };
      }
    } catch (e) { /* not connected */ }
  }

  // Check Phantom
  if ((window as any).solana?.isPhantom) {
    try {
      const resp = await (window as any).solana.connect({ onlyIfTrusted: true });
      if (resp?.publicKey) {
        return { address: resp.publicKey.toString(), chain: 'solana', connected: true };
      }
    } catch (e) { /* not connected */ }
  }

  return null;
}

export async function connectWallet(type: 'metamask' | 'phantom'): Promise<WalletInfo> {
  if (Platform.OS !== 'web') throw new Error('Wallet connect only available on web');

  if (type === 'metamask') {
    if (!(window as any).ethereum) throw new Error('MetaMask not installed');
    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('No account selected');
    
    const address = accounts[0];
    if (!isValidEthereumAddress(address)) {
      throw new Error('Invalid Ethereum address format');
    }
    
    return { address, chain: 'ethereum', connected: true };
  }

  if (type === 'phantom') {
    if (!(window as any).solana?.isPhantom) throw new Error('Phantom not installed');
    const resp = await (window as any).solana.connect();
    const address = resp.publicKey.toString();
    
    if (!isValidSolanaAddress(address)) {
      throw new Error('Invalid Solana address format');
    }
    
    return { address, chain: 'solana', connected: true };
  }

  throw new Error('Unknown wallet type');
}

// ─── Signature Verification ─────────────────────────────────────────────────

export async function verifyWalletOwnership(
  address: string, 
  chain: CryptoChain, 
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (Platform.OS !== 'web') {
    return { success: false, error: 'Verification only available on web' };
  }

  const message = `Verify wallet for The Underground Circle: ${userId}`;

  try {
    if (chain === 'ethereum') {
      if (!(window as any).ethereum) {
        return { success: false, error: 'MetaMask not installed' };
      }

      const signature = await (window as any).ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      });

      // In production, verify the signature on the server
      // For now, we'll trust that the wallet extension verified ownership
      if (signature) {
        return { success: true };
      }
    }

    if (chain === 'solana') {
      if (!(window as any).solana?.isPhantom) {
        return { success: false, error: 'Phantom not installed' };
      }

      const encodedMessage = new TextEncoder().encode(message);
      const signature = await (window as any).solana.request({
        method: 'signMessage',
        params: {
          message: encodedMessage,
          display: 'utf8',
        },
      });

      // In production, verify the signature on the server
      // For now, we'll trust that the wallet extension verified ownership  
      if (signature) {
        return { success: true };
      }
    }

    return { success: false, error: 'Failed to get signature' };
  } catch (error: any) {
    if (error.code === 4001) {
      return { success: false, error: 'User rejected signature request' };
    }
    return { success: false, error: error.message || 'Signature verification failed' };
  }
}

// ─── Wallet Disconnect ──────────────────────────────────────────────────────

export async function disconnectWallet(chain?: CryptoChain): Promise<void> {
  if (Platform.OS !== 'web') return;

  // Disconnect Phantom (Solana)
  if ((!chain || chain === 'solana') && (window as any).solana?.isPhantom) {
    try { await (window as any).solana.disconnect(); } catch {}
  }

  // MetaMask doesn't support programmatic disconnect
  // Users must disconnect from the extension itself

  // Clear from database
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('profiles').update({
      wallet_address: null,
      wallet_chain: null,
    }).eq('id', user.id);
  }
}

// ─── Get All Available Wallets with Connection Status ───────────────────────

export async function getAllWalletStates(): Promise<{
  metamask: { available: boolean; address: string | null };
  phantom: { available: boolean; address: string | null };
}> {
  if (Platform.OS !== 'web') {
    return {
      metamask: { available: false, address: null },
      phantom: { available: false, address: null },
    };
  }

  let metamaskAddr: string | null = null;
  let phantomAddr: string | null = null;

  if ((window as any).ethereum) {
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
      if (accounts?.[0]) metamaskAddr = accounts[0];
    } catch {}
  }

  if ((window as any).solana?.isPhantom) {
    try {
      const resp = await (window as any).solana.connect({ onlyIfTrusted: true });
      if (resp?.publicKey) phantomAddr = resp.publicKey.toString();
    } catch {}
  }

  return {
    metamask: { available: !!(window as any).ethereum, address: metamaskAddr },
    phantom: { available: !!(window as any).solana?.isPhantom, address: phantomAddr },
  };
}

// ─── Multi-Wallet Support ───────────────────────────────────────────────────

export async function getConnectedWallets(): Promise<MultiWallet> {
  const result: MultiWallet = { ethereum: null, solana: null };
  if (Platform.OS !== 'web') return result;

  // Check MetaMask — must be MetaMask specifically, NOT Phantom's injected ethereum provider
  const eth = (window as any).ethereum;
  const isRealMetaMask = eth && eth.isMetaMask && !eth.isPhantom && !eth._isPhantom;
  if (isRealMetaMask) {
    try {
      const accounts: any = await withTimeout(
        eth.request({ method: 'eth_accounts' }),
        3000, 'MetaMask eth_accounts',
      );
      if (accounts?.[0]) {
        result.ethereum = { address: accounts[0], chain: 'ethereum', connected: true };
      }
    } catch {}
  }

  // Check Phantom (with timeout — connect({ onlyIfTrusted }) can hang)
  if ((window as any).solana?.isPhantom) {
    try {
      const resp: any = await withTimeout(
        (window as any).solana.connect({ onlyIfTrusted: true }),
        3000, 'Phantom connect',
      );
      if (resp?.publicKey) {
        result.solana = { address: resp.publicKey.toString(), chain: 'solana', connected: true };
      }
    } catch {}
  }

  return result;
}

export async function loadSavedWallets(): Promise<MultiWallet> {
  const result: MultiWallet = { ethereum: null, solana: null };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return result;

    // Try new multi-wallet columns first; fall back if columns don't exist yet
    let data: any = null;
    const { data: d1, error: e1 } = await supabase
      .from('profiles')
      .select('wallet_address_eth, wallet_address_sol, wallet_address, wallet_chain')
      .eq('id', user.id)
      .single();

    if (e1 && (e1.message?.includes('column') || e1.code === '42703' || e1.message?.includes('does not exist'))) {
      // Multi-wallet columns not migrated yet — fall back to legacy columns only
      const { data: d2 } = await supabase
        .from('profiles')
        .select('wallet_address, wallet_chain')
        .eq('id', user.id)
        .single();
      data = d2;
    } else {
      data = d1;
    }

    if (!data) return result;

    // New multi-wallet columns
    if (data.wallet_address_eth) {
      result.ethereum = { address: data.wallet_address_eth, chain: 'ethereum', connected: true };
    }
    if (data.wallet_address_sol) {
      result.solana = { address: data.wallet_address_sol, chain: 'solana', connected: true };
    }

    // Fallback to legacy single-wallet columns
    if (!result.ethereum && !result.solana && data.wallet_address) {
      const chain = (data.wallet_chain || 'ethereum') as CryptoChain;
      result[chain] = { address: data.wallet_address, chain, connected: true };
    }
  } catch {}
  return result;
}

export async function saveWalletToProfile(
  address: string,
  chain: CryptoChain,
  userId: string
): Promise<void> {
  const column = chain === 'ethereum' ? 'wallet_address_eth' : 'wallet_address_sol';
  const { error } = await supabase.from('profiles').update({
    [column]: address,
    // Also update legacy columns for backward compat
    wallet_address: address,
    wallet_chain: chain,
  }).eq('id', userId);
  if (error) throw new Error('Failed to save wallet: ' + error.message);
}

export async function removeWalletFromProfile(chain: CryptoChain): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const column = chain === 'ethereum' ? 'wallet_address_eth' : 'wallet_address_sol';
  const update: any = { [column]: null };

  // Check if the legacy wallet_chain matches — if so clear legacy too
  const { data } = await supabase
    .from('profiles')
    .select('wallet_chain')
    .eq('id', user.id)
    .single();
  if (data?.wallet_chain === chain) {
    update.wallet_address = null;
    update.wallet_chain = null;
  }

  await supabase.from('profiles').update(update).eq('id', user.id);

  // Disconnect browser wallet
  if (chain === 'solana' && (window as any).solana?.isPhantom) {
    try { await (window as any).solana.disconnect(); } catch {}
  }
}

export async function getMemberWallets(userId: string): Promise<MultiWallet> {
  const result: MultiWallet = { ethereum: null, solana: null };
  try {
    const { data } = await supabase
      .from('profiles')
      .select('wallet_address_eth, wallet_address_sol, wallet_address, wallet_chain')
      .eq('id', userId)
      .single();
    if (!data) return result;
    if (data.wallet_address_eth) {
      result.ethereum = { address: data.wallet_address_eth, chain: 'ethereum', connected: true };
    }
    if (data.wallet_address_sol) {
      result.solana = { address: data.wallet_address_sol, chain: 'solana', connected: true };
    }
    if (!result.ethereum && !result.solana && data.wallet_address) {
      const chain = (data.wallet_chain || 'ethereum') as CryptoChain;
      result[chain] = { address: data.wallet_address, chain, connected: true };
    }
  } catch {}
  return result;
}

// ─── Send ETH ────────────────────────────────────────────────────────────────

export async function sendETH(
  toAddress: string, 
  amountETH: number, 
  confirmed = false
): Promise<SendResult> {
  if (Platform.OS !== 'web') return { success: false, error: 'Only available on web' };
  if (!(window as any).ethereum) return { success: false, error: 'MetaMask not installed' };

  // Input validation
  const sanitizedAddress = sanitizeInput(toAddress, 42);
  if (!isValidEthereumAddress(sanitizedAddress)) {
    return { success: false, error: 'Invalid Ethereum address format' };
  }

  if (!validateAmount(amountETH, MAX_ETH_AMOUNT)) {
    return { success: false, error: `Invalid amount. Must be between 0 and ${MAX_ETH_AMOUNT} ETH` };
  }

  try {
    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) return { success: false, error: 'No wallet connected' };

    const fromAddress = accounts[0];
    
    // Rate limiting check
    if (!checkRateLimit(fromAddress)) {
      return { success: false, error: `Rate limited: max ${MAX_SENDS_PER_HOUR} transactions per hour` };
    }

    // Require confirmation for amounts above threshold
    if (!confirmed && amountETH > 1) {
      return { 
        success: false, 
        error: `CONFIRMATION_REQUIRED`, 
        confirmationMessage: `Send ${amountETH} ETH to ${sanitizedAddress}?`
      };
    }

    // Convert ETH to Wei (hex) with precision handling
    const weiValue = BigInt(Math.floor(amountETH * 1e18));
    const hexValue = '0x' + weiValue.toString(16);

    const txHash = await (window as any).ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: fromAddress,
        to: sanitizedAddress,
        value: hexValue,
        gas: '0x5208', // 21000 gas for simple transfer
      }],
    });

    return { success: true, txHash };
  } catch (e: any) {
    if (e.code === 4001) return { success: false, error: 'Transaction rejected by user' };
    return { success: false, error: e.message || 'Transaction failed' };
  }
}

// ─── Send SOL ────────────────────────────────────────────────────────────────

export async function sendSOL(
  toAddress: string, 
  amountSOL: number, 
  confirmed = false
): Promise<SendResult> {
  if (Platform.OS !== 'web') return { success: false, error: 'Only available on web' };
  if (!(window as any).solana?.isPhantom) return { success: false, error: 'Phantom not installed' };

  // Input validation
  const sanitizedAddress = sanitizeInput(toAddress, 44);
  if (!isValidSolanaAddress(sanitizedAddress)) {
    return { success: false, error: 'Invalid Solana address format' };
  }

  if (!validateAmount(amountSOL, MAX_SOL_AMOUNT)) {
    return { success: false, error: `Invalid amount. Must be between 0 and ${MAX_SOL_AMOUNT} SOL` };
  }

  try {
    const provider = (window as any).solana;
    const resp = await provider.connect();
    const fromPubkey = resp.publicKey;
    const fromAddress = fromPubkey.toString();

    // Rate limiting check
    if (!checkRateLimit(fromAddress)) {
      return { success: false, error: `Rate limited: max ${MAX_SENDS_PER_HOUR} transactions per hour` };
    }

    // Require confirmation for amounts above threshold
    if (!confirmed && amountSOL > 10) {
      return { 
        success: false, 
        error: `CONFIRMATION_REQUIRED`,
        confirmationMessage: `Send ${amountSOL} SOL to ${sanitizedAddress}?`
      };
    }

    // Get recent blockhash
    const bhResponse = await fetch(SOLANA_RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'finalized' }],
      }),
    });
    const bhData = await bhResponse.json();
    const blockhash = bhData.result?.value?.blockhash;

    if (!blockhash) return { success: false, error: 'Failed to get blockhash' };

    // We need @solana/web3.js for proper transaction construction
    // Since it's already a dependency, we can use dynamic import
    const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(fromPubkey.toString()),
        toPubkey: new PublicKey(sanitizedAddress),
        lamports: Math.floor(amountSOL * LAMPORTS_PER_SOL),
      })
    );

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(fromPubkey.toString());

    const signed = await provider.signTransaction(transaction);
    
    // Send signed transaction
    const sendResponse = await fetch(SOLANA_RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'sendTransaction',
        params: [
          Buffer.from(signed.serialize()).toString('base64'),
          { encoding: 'base64', preflightCommitment: 'finalized' },
        ],
      }),
    });
    const sendData = await sendResponse.json();

    if (sendData.error) {
      return { success: false, error: sendData.error.message || 'Transaction failed' };
    }

    return { success: true, txHash: sendData.result };
  } catch (e: any) {
    if (e.code === 4001) return { success: false, error: 'Transaction rejected by user' };
    return { success: false, error: e.message || 'Transaction failed' };
  }
}

// ─── Resolve Member Wallet ───────────────────────────────────────────────────

export async function getMemberWallet(userId: string): Promise<{ address: string; chain: string } | null> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('wallet_address, wallet_chain')
      .eq('id', userId)
      .single();
    if (data?.wallet_address) {
      return { address: data.wallet_address, chain: data.wallet_chain || 'ethereum' };
    }
  } catch (e) { /* column may not exist */ }
  return null;
}

export async function getMemberByUsername(username: string): Promise<{ id: string; display_name: string; wallet_address?: string; wallet_chain?: string } | null> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, username, wallet_address, wallet_chain')
      .ilike('username', username)
      .single();
    return data;
  } catch (e) { return null; }
}

// ─── Multi-Chain Token Balances ─────────────────────────────────────────────

export async function fetchTokenBalances(address: string, chain: Chain): Promise<Token[]> {
  const tokens: Token[] = [];
  const config = CHAIN_CONFIGS[chain];

  try {
    if (chain === 'solana') {
      // Get SOL balance
      const solBalance = await jsonRpc(config.rpcUrl, 'getBalance', [address]);
      const solAmount = (solBalance?.value || 0) / 1e9;
      const solPrice = await fetchTokenPrice('solana');
      
      tokens.push({
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        chain: 'solana',
        balance: solAmount.toFixed(4),
        raw: solAmount,
        usdValue: solAmount * solPrice.current,
        change24h: solPrice.change24h,
        isNative: true,
      });

      // Get SPL token accounts
      try {
        const tokenAccounts = await jsonRpc(config.rpcUrl, 'getTokenAccountsByOwner', [
          address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' }
        ]);

        for (const account of tokenAccounts?.value || []) {
          const info = account.account.data.parsed?.info;
          if (info && info.tokenAmount && parseFloat(info.tokenAmount.amount) > 0) {
            const mint = info.mint;
            const balance = parseFloat(info.tokenAmount.uiAmount);
            
            // Try to fetch token metadata (simplified)
            tokens.push({
              address: mint,
              symbol: mint.slice(0, 4).toUpperCase(),
              name: `SPL Token ${mint.slice(0, 8)}`,
              decimals: info.tokenAmount.decimals,
              chain: 'solana',
              balance: balance.toFixed(4),
              raw: balance,
              usdValue: 0, // Would need token registry for prices
              change24h: 0,
            });
          }
        }
      } catch (e) {
        console.warn('Failed to fetch SPL tokens:', e);
      }
    } else {
      // EVM chains (Ethereum, Polygon, Base)
      const ethBalance = await jsonRpc(config.rpcUrl, 'eth_getBalance', [address, 'latest']);
      const ethAmount = parseInt(ethBalance, 16) / 1e18;
      const priceId = chain === 'ethereum' ? 'ethereum' : chain === 'polygon' ? 'matic-network' : 'ethereum';
      const price = await fetchTokenPrice(priceId);
      
      tokens.push({
        address: '0x0000000000000000000000000000000000000000',
        symbol: config.symbol,
        name: config.name,
        decimals: 18,
        chain,
        balance: ethAmount.toFixed(4),
        raw: ethAmount,
        usdValue: ethAmount * price.current,
        change24h: price.change24h,
        isNative: true,
      });

      // TODO: Add ERC-20 token detection using multicall
      // For now, just return native token
    }
  } catch (error) {
    console.error(`Failed to fetch ${chain} balances:`, error);
  }

  return tokens;
}

// ─── Token Price Feeds ──────────────────────────────────────────────────────

const priceCache = new Map<string, { data: PriceData; expires: number }>();
const PRICE_CACHE_TTL = 60000; // 1 minute

export async function fetchTokenPrice(tokenId: string): Promise<PriceData> {
  const cached = priceCache.get(tokenId);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  // Map coingecko IDs to Coinbase symbols for fallback
  const coinbaseSymbols: Record<string, string> = {
    solana: 'SOL',
    ethereum: 'ETH',
    'matic-network': 'MATIC',
    bitcoin: 'BTC',
  };

  // Try CoinGecko first (10s timeout — free tier can be slow)
  try {
    const response = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd&include_24hr_change=true`,
      {},
      10000,
    );
    const data = await response.json();
    const tokenData = data[tokenId];
    if (tokenData?.usd) {
      const priceData: PriceData = {
        current: tokenData.usd,
        change24h: tokenData.usd_24h_change || 0,
        lastUpdated: new Date().toISOString(),
      };
      priceCache.set(tokenId, { data: priceData, expires: Date.now() + PRICE_CACHE_TTL });
      return priceData;
    }
  } catch {}

  // Fallback: Coinbase API (reliable, CORS-friendly)
  const symbol = coinbaseSymbols[tokenId];
  if (symbol) {
    try {
      const response = await fetchWithTimeout(
        `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
        {},
        8000,
      );
      const data = await response.json();
      if (data?.data?.amount) {
        const priceData: PriceData = {
          current: parseFloat(data.data.amount),
          change24h: 0,
          lastUpdated: new Date().toISOString(),
        };
        priceCache.set(tokenId, { data: priceData, expires: Date.now() + PRICE_CACHE_TTL });
        return priceData;
      }
    } catch {}
  }

  console.error(`Failed to fetch price for ${tokenId} from all sources`);
  return { current: 0, change24h: 0, lastUpdated: new Date().toISOString() };
}

export async function fetchMultipleTokenPrices(tokenIds: string[]): Promise<Record<string, PriceData>> {
  const idsString = tokenIds.join(',');
  try {
    const response = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${idsString}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
      {},
      3000,
    );
    const data = await response.json();
    
    const result: Record<string, PriceData> = {};
    for (const [tokenId, tokenData] of Object.entries(data)) {
      const td = tokenData as any;
      result[tokenId] = {
        current: td.usd || 0,
        change24h: td.usd_24h_change || 0,
        marketCap: td.usd_market_cap,
        volume24h: td.usd_24h_vol,
        lastUpdated: new Date().toISOString(),
      };
    }
    return result;
  } catch (error) {
    console.error('Failed to fetch multiple prices:', error);
    return {};
  }
}

// ─── Transaction History ────────────────────────────────────────────────────

export async function fetchTransactionHistory(address: string, chain: Chain, limit = 20): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  const config = CHAIN_CONFIGS[chain];

  try {
    if (chain === 'solana') {
      const signatures = await jsonRpc(config.rpcUrl, 'getSignaturesForAddress', [
        address,
        { limit: Math.min(limit, 10) },
      ]);

      // Batch-fetch tx details in parallel (max 5 at a time to avoid rate limits)
      const sigBatch = (signatures || []).slice(0, 5);
      const txResults = await Promise.allSettled(
        sigBatch.map((sig: any) =>
          withTimeout(
            jsonRpc(config.rpcUrl, 'getTransaction', [
              sig.signature,
              { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
            ]),
            5000,
            `tx ${sig.signature.slice(0, 8)}`,
          ).then(tx => ({ sig, tx }))
        )
      );

      for (const result of txResults) {
        if (result.status !== 'fulfilled') continue;
        const { sig, tx } = result.value;
        try {

          if (tx?.meta && tx.transaction) {
            const type = determineTransactionType(tx, address);
            const amount = extractTransactionAmount(tx, address);
            
            transactions.push({
              hash: sig.signature,
              type,
              amount: amount.toString(),
              token: {
                address: 'So11111111111111111111111111111111111111112',
                symbol: 'SOL',
                name: 'Solana',
                decimals: 9,
                chain: 'solana',
                isNative: true,
              },
              from: extractFromAddress(tx, address),
              to: extractToAddress(tx, address),
              timestamp: new Date(sig.blockTime! * 1000).toISOString(),
              status: tx.meta.err ? 'failed' : 'confirmed',
              chain: 'solana',
              fee: ((tx.meta.fee || 0) / 1e9).toString(),
              blockNumber: sig.slot,
              confirmations: sig.confirmationStatus === 'finalized' ? 100 : 1,
            });
          }
        } catch (e) {
          console.warn('Failed to parse transaction:', sig.signature, e);
        }
      }
    } else {
      // EVM chains - simplified implementation
      // In production, you'd use services like Etherscan API, Alchemy, or Moralis
    }
  } catch (error) {
    console.error(`Failed to fetch transaction history for ${chain}:`, error);
  }

  return transactions;
}

// Helper functions for transaction parsing
function determineTransactionType(tx: any, userAddress: string): Transaction['type'] {
  // Simplified logic - in production you'd analyze the instruction types
  return 'send'; // Default
}

function extractTransactionAmount(tx: any, userAddress: string): number {
  // Simplified - extract SOL amount from balance changes
  const preBalances = tx.meta.preBalances || [];
  const postBalances = tx.meta.postBalances || [];
  
  for (let i = 0; i < preBalances.length; i++) {
    const diff = postBalances[i] - preBalances[i];
    if (Math.abs(diff) > 0) {
      return Math.abs(diff) / 1e9; // Convert lamports to SOL
    }
  }
  return 0;
}

function extractFromAddress(tx: any, userAddress: string): string {
  return tx.transaction.message.accountKeys?.[0]?.pubkey || userAddress;
}

function extractToAddress(tx: any, userAddress: string): string {
  return tx.transaction.message.accountKeys?.[1]?.pubkey || userAddress;
}

// ─── Swap Quotes (Jupiter for Solana) ───────────────────────────────────────

export async function getSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amount: string,
  chain: Chain
): Promise<SwapQuote | null> {
  try {
    if (chain === 'solana') {
      // Jupiter API for Solana swaps
      const response = await fetchWithTimeout(
        `https://quote-api.jup.ag/v6/quote?inputMint=${tokenIn}&outputMint=${tokenOut}&amount=${amount}&slippageBps=50`,
        {},
        5000,
      );
      
      if (!response.ok) {
        throw new Error('Jupiter API error');
      }
      
      const data = await response.json();
      
      return {
        tokenIn: {
          address: tokenIn,
          symbol: 'IN', // You'd lookup the actual symbol
          name: 'Input Token',
          decimals: 9,
          chain: 'solana',
        },
        tokenOut: {
          address: tokenOut,
          symbol: 'OUT', // You'd lookup the actual symbol
          name: 'Output Token',
          decimals: 9,
          chain: 'solana',
        },
        amountIn: data.inAmount,
        amountOut: data.outAmount,
        priceImpact: data.priceImpactPct,
        route: data.routePlan?.map((step: any) => ({
          protocol: step.swapInfo?.ammKey || 'Unknown',
          percentage: 100, // Jupiter handles routing optimization
        })) || [],
        minimumReceived: data.otherAmountThreshold,
      };
    } else {
      // EVM chains - would integrate with 1inch, 0x, etc.
      return null;
    }
  } catch (error) {
    console.error(`Failed to get swap quote for ${chain}:`, error);
    return null;
  }
}

// ─── NFT Fetching ────────────────────────────────────────────────────────────

export async function fetchNFTs(address: string, chain: Chain): Promise<NFT[]> {
  const nfts: NFT[] = [];

  try {
    if (chain === 'solana') {
      // Simplified NFT fetching for Solana
      // In production, you'd use Metaplex DAS API or similar
      const tokenAccounts = await jsonRpc(CHAIN_CONFIGS.solana.rpcUrl, 'getTokenAccountsByOwner', [
        address,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ]);

      for (const account of tokenAccounts?.value || []) {
        const info = account.account.data.parsed?.info;
        if (info && info.tokenAmount.uiAmount === 1) { // NFTs have supply of 1
          nfts.push({
            mint: info.mint,
            name: `NFT ${info.mint.slice(0, 8)}...`,
            collection: 'Unknown Collection',
            chain: 'solana',
            image: generatePlaceholderNFTImage(),
          });
        }
      }
    } else {
      // EVM chains - would use Alchemy NFT API, Moralis, etc.
    }
  } catch (error) {
    console.error(`Failed to fetch NFTs for ${chain}:`, error);
  }

  return nfts;
}

function generatePlaceholderNFTImage(): string {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect width="200" height="200" fill="${color}"/>
      <text x="100" y="100" font-family="Arial" font-size="20" fill="white" text-anchor="middle" dominant-baseline="middle">NFT</text>
    </svg>
  `)}`;
}

// ─── Gas Estimation ─────────────────────────────────────────────────────────

export async function estimateGas(chain: Chain): Promise<GasEstimate | null> {
  try {
    const config = CHAIN_CONFIGS[chain];
    
    if (chain === 'solana') {
      // Solana fees are relatively stable
      return {
        low: '5000',
        medium: '5000',
        high: '10000',
        unit: 'lamports',
      };
    } else {
      // EVM chains - get gas prices
      const gasPrice = await jsonRpc(config.rpcUrl, 'eth_gasPrice', []);
      const gasPriceGwei = parseInt(gasPrice, 16) / 1e9;
      
      return {
        low: (gasPriceGwei * 0.9).toFixed(0),
        medium: gasPriceGwei.toFixed(0),
        high: (gasPriceGwei * 1.2).toFixed(0),
        unit: 'gwei',
      };
    }
  } catch (error) {
    console.error(`Failed to estimate gas for ${chain}:`, error);
    return null;
  }
}

// ─── Staking (Solana) ───────────────────────────────────────────────────────

export async function getStakeAccounts(address: string): Promise<StakeAccount[]> {
  const stakeAccounts: StakeAccount[] = [];
  
  try {
    const accounts = await withTimeout(jsonRpc(CHAIN_CONFIGS.solana.rpcUrl, 'getProgramAccounts', [
      'Stake11111111111111111111111111111111111111',
      {
        filters: [
          {
            memcmp: {
              offset: 12,
              bytes: address,
            },
          },
        ],
        encoding: 'jsonParsed',
      },
    ]), 5000, 'getStakeAccounts');

    for (const account of accounts || []) {
      const stakeData = account.account.data.parsed?.info;
      if (stakeData) {
        stakeAccounts.push({
          validator: stakeData.stake?.delegation?.voter || 'Unknown',
          amount: ((stakeData.stake?.delegation?.stake || 0) / 1e9).toFixed(4),
          rewards: '0', // Would need to calculate based on epochs
          status: stakeData.stake?.delegation?.deactivationEpoch === '18446744073709551615' ? 'active' : 'deactivating',
        });
      }
    }
  } catch (error) {
    console.error('Failed to fetch stake accounts:', error);
  }

  return stakeAccounts;
}

export async function getTopValidators(limit = 5): Promise<Array<{ address: string; name: string; apy: number; commission: number }>> {
  // Simplified validator list - in production you'd fetch from stakewiz.com API or similar
  return [
    { address: 'Cent4srMzvftZM6oc4dH6y2L79zB6y9BSh2eEFXQqk9e', name: 'Chorus One', apy: 7.2, commission: 5 },
    { address: 'J1to3PQfXidUUhprQWgdKkQAMWPJAEqSJ7amkBDE9qhF', name: 'Jito', apy: 7.0, commission: 7 },
    { address: 'EdgecN3aEvkLvKEuaGfbcrSWWqELbNKL3zuTFq9Wxfph', name: 'Edge', apy: 6.8, commission: 8 },
    { address: 'BLZEEuZUBVqFhj8adcCFPJvPVCiCyVmh3hkJMrU8KuJA', name: 'Blaze', apy: 6.5, commission: 10 },
    { address: 'AKsMat4kKbP3jwQNHr5eGgk6NdpFpHYjhSE5L6yGfgBg', name: 'Aks Mat', apy: 6.2, commission: 12 },
  ];
}

// ─── Security Features ──────────────────────────────────────────────────────

const SCAM_ADDRESSES = new Set([
  // Add known scam addresses here
  '1NC1i95o8V2bE3yC3wkzLzGfCQU6WoUPXX', // Example
]);

export function checkScamAddress(address: string): { isScam: boolean; reason?: string } {
  if (SCAM_ADDRESSES.has(address)) {
    return { isScam: true, reason: 'Known scam address' };
  }
  return { isScam: false };
}

export function validateTransactionAmount(amount: number, balance: number, chain: Chain): { valid: boolean; warning?: string } {
  const maxAmount = chain === 'solana' ? MAX_SOL_AMOUNT : MAX_ETH_AMOUNT;
  
  if (amount > maxAmount) {
    return { valid: false, warning: `Amount exceeds maximum of ${maxAmount} ${chain === 'solana' ? 'SOL' : 'ETH'}` };
  }
  
  if (amount > balance * 0.95) {
    return { valid: true, warning: 'Sending almost entire balance - leave some for fees' };
  }
  
  if (amount > balance * 0.5) {
    return { valid: true, warning: 'Large transaction - double-check recipient address' };
  }
  
  return { valid: true };
}

export function previewTransaction(
  from: string,
  to: string,
  amount: string,
  token: Token,
  estimatedFee: string
): string {
  const fromShort = shortenAddress(from);
  const toShort = shortenAddress(to);
  
  return `Send ${amount} ${token.symbol} from ${fromShort} to ${toShort}\nEstimated fee: ${estimatedFee} ${token.chain === 'solana' ? 'SOL' : 'ETH'}`;
}

// ─── Portfolio Aggregation ──────────────────────────────────────────────────

export async function aggregatePortfolio(wallets: Record<Chain, string>): Promise<Portfolio> {
  const allTokens: Token[] = [];
  const allNFTs: NFT[] = [];
  let totalValue = 0;
  let totalChange24h = 0;

  const entries = (Object.entries(wallets) as Array<[Chain, string]>).filter(([, addr]) => !!addr);

  const results = await Promise.allSettled(
    entries.map(async ([chain, address]) => {
      const [tokens, nfts] = await Promise.all([
        withTimeout(fetchTokenBalances(address, chain), 15000, `${chain} tokens`).catch(() => [] as Token[]),
        withTimeout(fetchNFTs(address, chain), 15000, `${chain} NFTs`).catch(() => [] as NFT[]),
      ]);
      return { chain, tokens, nfts };
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { tokens, nfts } = result.value;
    allTokens.push(...tokens);
    allNFTs.push(...nfts);

    tokens.forEach(token => {
      if (token.usdValue) {
        totalValue += token.usdValue;
        if (token.change24h && token.usdValue > 0) {
          const yesterdayValue = token.usdValue / (1 + token.change24h / 100);
          totalChange24h += token.usdValue - yesterdayValue;
        }
      }
    });
  }

  const totalChange24hPercent = totalValue > 0 ? (totalChange24h / totalValue) * 100 : 0;

  return {
    totalValue,
    change24h: totalChange24hPercent,
    tokens: allTokens,
    nfts: allNFTs,
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Wormhole Bridge Helpers ────────────────────────────────────────────────

export function getWormholeBridgeUrl(fromChain: Chain, toChain: Chain): string {
  const chainMapping = {
    ethereum: 'ethereum',
    solana: 'solana',
    polygon: 'polygon',
    base: 'base',
  };

  const from = chainMapping[fromChain];
  const to = chainMapping[toChain];
  
  return `https://portalbridge.com/?sourceChain=${from}&targetChain=${to}`;
}

// ─── Timeout Helper ─────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── JSON-RPC Helper ────────────────────────────────────────────────────────

async function jsonRpc(url: string, method: string, params: any[], timeoutMs = 5000): Promise<any> {
  // Build list of URLs to try: the provided URL first, then Solana fallbacks if it's a Solana endpoint
  const isSolana = SOLANA_RPC_ENDPOINTS.some(ep => url.includes(new URL(ep).hostname));
  const urls = isSolana ? SOLANA_RPC_ENDPOINTS : [url];
  
  let lastError: Error | null = null;
  for (const rpcUrl of urls) {
    try {
      const response = await fetchWithTimeout(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }, timeoutMs);

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        continue; // Try next endpoint
      }

      const data = await response.json();
      
      if (data.error) {
        lastError = new Error(data.error.message || 'RPC error');
        continue;
      }

      return data.result;
    } catch (error) {
      lastError = error as Error;
      continue; // Try next endpoint
    }
  }
  
  console.error(`JSON-RPC error for ${method} (all endpoints failed):`, lastError);
  throw lastError;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function getExplorerUrl(txHash: string, chain: CryptoChain | Chain): string {
  const config = CHAIN_CONFIGS[chain as Chain];
  if (config) {
    return `${config.explorerUrl}/tx/${txHash}`;
  }
  // Legacy support
  if (chain === 'ethereum') return `https://etherscan.io/tx/${txHash}`;
  return `https://solscan.io/tx/${txHash}`;
}

export function getAddressExplorerUrl(address: string, chain: Chain): string {
  const config = CHAIN_CONFIGS[chain];
  return `${config.explorerUrl}/address/${address}`;
}

export function formatTokenAmount(amount: number | string, decimals: number = 4): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  return num.toFixed(decimals);
}

export function formatUSD(amount: number): string {
  if (amount < 0.01) return '< $0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}
