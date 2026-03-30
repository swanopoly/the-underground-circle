import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import {
  type HeliusClient,
  type SwapQuoteResult,
  type TradingBotWalletInfo,
  executeBotWalletSwap,
  logTrade,
  savePosition,
  SOLANA_TOKEN_REGISTRY,
  SOL_MINT,
  USDC_MINT,
} from '../../lib/heliusTrading';
import { fetchTokenMarketSnapshot, parsePositiveNumber } from '../../lib/tradingMarket';

interface Props {
  client: HeliusClient;
  walletAddress: string | null;
  userId: string;
  circleId: string;
  botWallet: TradingBotWalletInfo | null;
  onBotWalletRefresh: () => Promise<void>;
  selectedMint: string;
  isDesktop: boolean;
}

function getTokenMeta(mint: string): { symbol: string; name: string; decimals: number } {
  const entry = Object.entries(SOLANA_TOKEN_REGISTRY).find(([, t]) => t.mint === mint);
  if (entry) return { symbol: entry[0], name: entry[1].name, decimals: entry[1].decimals };
  return {
    symbol: mint === SOL_MINT ? 'SOL' : mint === USDC_MINT ? 'USDC' : mint.slice(0, 6),
    name: mint === SOL_MINT ? 'Solana' : mint === USDC_MINT ? 'USD Coin' : 'Token',
    decimals: mint === SOL_MINT ? 9 : 6,
  };
}

function convertFromSmallest(amount: string | number, mint: string): number {
  const value = typeof amount === 'string' ? parseFloat(amount || '0') : amount;
  if (!Number.isFinite(value)) return 0;
  return value / Math.pow(10, getTokenMeta(mint).decimals);
}

export default function CompactTradeForm({ client, walletAddress, userId, circleId, botWallet, onBotWalletRefresh, selectedMint, isDesktop }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippagePct, setSlippagePct] = useState('1.0');
  const [stopLossPct, setStopLossPct] = useState('');
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [trailingStopPct, setTrailingStopPct] = useState('');
  const [showProtection, setShowProtection] = useState(false);
  const [quote, setQuote] = useState<SwapQuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const activeBotWallet = botWallet?.status === 'active' ? botWallet : null;
  const executionAddress = activeBotWallet?.address || walletAddress;

  // Buy: SOL → selectedMint, Sell: selectedMint → SOL
  const inputMint = side === 'buy' ? SOL_MINT : selectedMint;
  const outputMint = side === 'buy' ? selectedMint : SOL_MINT;
  const inputMeta = getTokenMeta(inputMint);
  const outputMeta = getTokenMeta(outputMint);

  const handleQuote = async () => {
    if (!executionAddress) return;
    const parsedAmount = parseFloat(amount);
    const parsedSlippage = parseFloat(slippagePct);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setResult({ ok: false, msg: 'Enter a valid amount.' });
      return;
    }
    if (inputMint === outputMint) {
      setResult({ ok: false, msg: 'Same token on both sides.' });
      return;
    }

    setQuoting(true);
    setQuote(null);
    setResult(null);
    try {
      const q = await client.getSwapQuote({
        inputMint,
        outputMint,
        amount: Math.floor(parsedAmount * Math.pow(10, inputMeta.decimals)),
        slippageBps: Math.round((Number.isFinite(parsedSlippage) ? parsedSlippage : 1) * 100),
        userPublicKey: executionAddress,
      });
      setQuote(q);
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
    setQuoting(false);
  };

  const handleSwap = async () => {
    if (!quote || !executionAddress) return;
    setSwapping(true);
    try {
      const parsedAmount = parseFloat(amount);
      const parsedSlippage = parseFloat(slippagePct);
      const res = activeBotWallet
        ? await executeBotWalletSwap({
            circleId,
            inputMint,
            outputMint,
            amount: Math.floor(parsedAmount * Math.pow(10, inputMeta.decimals)),
            slippageBps: Math.round((Number.isFinite(parsedSlippage) ? parsedSlippage : 1) * 100),
          })
        : {
            ...(await client.executeSwap({
              inputMint,
              outputMint,
              amount: Math.floor(parsedAmount * Math.pow(10, inputMeta.decimals)),
              slippageBps: Math.round((Number.isFinite(parsedSlippage) ? parsedSlippage : 1) * 100),
              userPublicKey: executionAddress,
            })),
            walletAddress: undefined,
          };

      if (res.success) {
        const stopLoss = parsePositiveNumber(stopLossPct);
        const takeProfit = parsePositiveNumber(takeProfitPct);
        const trailingStop = parsePositiveNumber(trailingStopPct);

        await logTrade({
          userId,
          circleId,
          walletAddress: res.walletAddress || executionAddress,
          action: 'swap',
          inputMint,
          outputMint,
          inputAmount: res.inputAmount,
          outputAmount: res.outputAmount,
          txHash: res.txHash,
          status: 'success',
          reason: (stopLoss || takeProfit || trailingStop) ? 'Protected trade' : undefined,
          strategyName: activeBotWallet ? 'smart_trade_bot_wallet' : 'smart_trade_manual',
          metadata: {
            executionWallet: activeBotWallet ? 'bot_wallet' : 'phantom',
            stopLossPct: stopLoss || null,
            takeProfitPct: takeProfit || null,
            trailingStopPct: trailingStop || null,
          },
        });

        await onBotWalletRefresh();
        let message = `Swap OK! TX: ${res.txHash?.slice(0, 12)}...`;

        if (stopLoss || takeProfit || trailingStop) {
          const outputQty = convertFromSmallest(res.outputAmount, outputMint);
          const outputSnapshot = await fetchTokenMarketSnapshot(outputMint);
          const inputSnapshot = await fetchTokenMarketSnapshot(inputMint);
          const livePrice = outputSnapshot?.priceUsd || 0;
          const derivedPrice = outputQty > 0 && inputSnapshot?.priceUsd
            ? (parsedAmount * inputSnapshot.priceUsd) / outputQty
            : 0;
          const entryPrice = livePrice || derivedPrice;

          if (entryPrice > 0 && outputQty > 0) {
            await savePosition({
              userId,
              tokenMint: outputMint,
              tokenSymbol: outputMeta.symbol,
              side: 'long',
              entryPrice,
              quantity: outputQty,
              stopLossPrice: stopLoss ? entryPrice * (1 - (stopLoss / 100)) : undefined,
              takeProfitPrice: takeProfit ? entryPrice * (1 + (takeProfit / 100)) : undefined,
              trailingStopPct: trailingStop,
              entryTxHash: res.txHash,
              circleId,
              strategyName: activeBotWallet ? 'smart_trade_bot_wallet' : 'smart_trade_manual',
            });
            message += ' Position saved.';
          }
        }

        setResult({ ok: true, msg: message });
        setQuote(null);
        setAmount('');
      } else {
        setResult({ ok: false, msg: res.error || 'Swap failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    }
    setSwapping(false);
  };

  if (!executionAddress) {
    return (
      <View style={[tf.container, !isDesktop && tf.containerMobile]}>
        <Text style={tf.noWallet}>Create a Bot Wallet or link Phantom to trade.</Text>
      </View>
    );
  }

  const buyActive = side === 'buy';
  const sellActive = side === 'sell';

  return (
    <ScrollView style={[tf.container, !isDesktop && tf.containerMobile]} showsVerticalScrollIndicator={false}>
      {/* Buy / Sell toggle */}
      <View style={tf.sideRow}>
        <Pressable onPress={() => { setSide('buy'); setQuote(null); }} style={[tf.sideBtn, buyActive && tf.sideBuyActive]}>
          <Text style={[tf.sideText, buyActive && { color: '#22c55e' }]}>BUY</Text>
        </Pressable>
        <Pressable onPress={() => { setSide('sell'); setQuote(null); }} style={[tf.sideBtn, sellActive && tf.sideSellActive]}>
          <Text style={[tf.sideText, sellActive && { color: '#ef4444' }]}>SELL</Text>
        </Pressable>
      </View>

      {/* Token info */}
      <View style={tf.pairRow}>
        <Text style={tf.pairLabel}>{inputMeta.symbol}</Text>
        <Text style={tf.pairArrow}>{'>'}</Text>
        <Text style={tf.pairLabel}>{outputMeta.symbol}</Text>
      </View>

      {/* Amount */}
      <Text style={tf.fieldLabel}>Amount ({inputMeta.symbol})</Text>
      <TextInput
        style={tf.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.0"
        placeholderTextColor="#555"
        keyboardType="decimal-pad"
      />
      <View style={tf.presetRow}>
        {['0.1', '0.5', '1.0', '5.0'].map(v => (
          <Pressable key={v} onPress={() => setAmount(v)} style={tf.presetBtn}>
            <Text style={tf.presetText}>{v}</Text>
          </Pressable>
        ))}
      </View>

      {/* Slippage */}
      <Text style={tf.fieldLabel}>Slippage %</Text>
      <View style={tf.presetRow}>
        {['0.5', '1.0', '2.0', '3.0'].map(v => (
          <Pressable key={v} onPress={() => setSlippagePct(v)} style={[tf.presetBtn, slippagePct === v && tf.presetActive]}>
            <Text style={[tf.presetText, slippagePct === v && { color: '#6366f1' }]}>{v}%</Text>
          </Pressable>
        ))}
      </View>

      {/* SmartTrade Protection */}
      <Pressable onPress={() => setShowProtection(!showProtection)} style={tf.protectionToggle}>
        <Text style={tf.protectionText}>{showProtection ? '- PROTECTION' : '+ PROTECTION'}</Text>
      </Pressable>

      {showProtection && (
        <View style={tf.protectionCard}>
          <View style={tf.protectionRow}>
            <View style={{ flex: 1 }}>
              <Text style={tf.fieldLabel}>SL %</Text>
              <TextInput style={tf.input} value={stopLossPct} onChangeText={setStopLossPct} placeholder="8" placeholderTextColor="#555" keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={tf.fieldLabel}>TP %</Text>
              <TextInput style={tf.input} value={takeProfitPct} onChangeText={setTakeProfitPct} placeholder="15" placeholderTextColor="#555" keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={tf.fieldLabel}>Trail %</Text>
              <TextInput style={tf.input} value={trailingStopPct} onChangeText={setTrailingStopPct} placeholder="5" placeholderTextColor="#555" keyboardType="decimal-pad" />
            </View>
          </View>
        </View>
      )}

      {/* Quote button */}
      <Pressable onPress={handleQuote} disabled={quoting || !amount} style={[tf.quoteBtn, { opacity: quoting || !amount ? 0.5 : 1 }]}>
        {quoting ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={tf.quoteBtnText}>GET QUOTE</Text>}
      </Pressable>

      {/* Quote preview */}
      {quote && (
        <View style={tf.quoteCard}>
          <View style={tf.quoteRow}>
            <Text style={tf.quoteLabel}>You send</Text>
            <Text style={tf.quoteValue}>{convertFromSmallest(quote.inAmount, inputMint).toFixed(4)} {inputMeta.symbol}</Text>
          </View>
          <View style={tf.quoteRow}>
            <Text style={tf.quoteLabel}>You receive</Text>
            <Text style={tf.quoteValue}>{convertFromSmallest(quote.outAmount, outputMint).toFixed(4)} {outputMeta.symbol}</Text>
          </View>
          <View style={tf.quoteRow}>
            <Text style={tf.quoteLabel}>Impact</Text>
            <Text style={[tf.quoteValue, quote.priceImpactPct > 1 && { color: '#ef4444' }]}>{quote.priceImpactPct.toFixed(3)}%</Text>
          </View>
          <View style={tf.quoteRow}>
            <Text style={tf.quoteLabel}>Route</Text>
            <Text style={tf.quoteValue} numberOfLines={1}>{quote.routePlan?.map(r => r.swapInfo.label).filter(Boolean).join(' > ') || 'Direct'}</Text>
          </View>

          <Pressable
            onPress={handleSwap}
            disabled={swapping}
            style={[tf.executeBtn, { backgroundColor: buyActive ? '#22c55e' : '#ef4444' }]}
          >
            {swapping
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={tf.executeBtnText}>{buyActive ? 'EXECUTE BUY' : 'EXECUTE SELL'}</Text>}
          </Pressable>
        </View>
      )}

      {/* Result banner */}
      {result && (
        <View style={[tf.resultBanner, { borderColor: result.ok ? '#22c55e30' : '#ef444430' }]}>
          <Text style={[tf.resultText, { color: result.ok ? '#22c55e' : '#ef4444' }]}>{result.msg}</Text>
        </View>
      )}

      {/* Execution info */}
      <Text style={tf.execInfo}>
        {activeBotWallet ? 'BOT WALLET' : 'PHANTOM'} | {slippagePct}% slip
      </Text>
    </ScrollView>
  );
}

const tf = StyleSheet.create({
  container: {
    width: 300,
    backgroundColor: '#0a0a0a',
    borderLeftWidth: 2,
    borderLeftColor: '#1a1a1a',
    padding: 10,
  },
  containerMobile: {
    width: '100%' as any,
    borderLeftWidth: 0,
    borderTopWidth: 2,
    borderTopColor: '#1a1a1a',
  },
  noWallet: { color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginTop: 20 },
  sideRow: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  sideBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#1a1a1a',
    alignItems: 'center',
  },
  sideBuyActive: { borderColor: '#22c55e50', backgroundColor: '#22c55e15' },
  sideSellActive: { borderColor: '#ef444450', backgroundColor: '#ef444415' },
  sideText: { color: '#6f6f6f', fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  pairLabel: { color: '#e8e8e8', fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },
  pairArrow: { color: '#3e3e3e', fontSize: 12, fontFamily: 'monospace' },
  fieldLabel: { color: '#6f6f6f', fontSize: 9, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4, letterSpacing: 1 },
  input: {
    backgroundColor: '#111111',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 2,
    color: '#e8e8e8',
    fontSize: 12,
    fontFamily: 'monospace',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
  },
  presetRow: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  presetBtn: {
    flex: 1,
    paddingVertical: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    alignItems: 'center',
  },
  presetActive: { borderColor: '#6366f150', backgroundColor: '#6366f115' },
  presetText: { color: '#6f6f6f', fontSize: 10, fontWeight: '600', fontFamily: 'monospace' },
  protectionToggle: { marginBottom: 8 },
  protectionText: { color: '#f59e0b', fontSize: 9, fontWeight: '700', fontFamily: 'monospace' },
  protectionCard: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 2,
    padding: 8,
    marginBottom: 10,
  },
  protectionRow: { flexDirection: 'row', gap: 6 },
  quoteBtn: {
    paddingVertical: 8,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#6366f140',
    backgroundColor: '#6366f115',
    alignItems: 'center',
    marginBottom: 8,
  },
  quoteBtnText: { color: '#6366f1', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  quoteCard: {
    backgroundColor: '#111111',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 2,
    padding: 8,
    marginBottom: 8,
  },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  quoteLabel: { color: '#6f6f6f', fontSize: 10, fontFamily: 'monospace' },
  quoteValue: { color: '#e8e8e8', fontSize: 10, fontWeight: '600', fontFamily: 'monospace' },
  executeBtn: {
    paddingVertical: 10,
    borderRadius: 2,
    alignItems: 'center',
    marginTop: 8,
  },
  executeBtnText: { color: '#e8e8e8', fontSize: 12, fontWeight: '700', fontFamily: 'monospace' },
  resultBanner: {
    borderWidth: 1,
    borderRadius: 2,
    padding: 8,
    marginBottom: 8,
  },
  resultText: { fontSize: 10, fontFamily: 'monospace' },
  execInfo: { color: '#3e3e3e', fontSize: 9, fontFamily: 'monospace', textAlign: 'center', marginTop: 4 },
});
