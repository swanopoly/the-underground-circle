/**
 * HeliusTab — Helius (Solana) integration management
 *
 * Allows users to:
 *   - Enter/test their Helius API key
 *   - See connection status & RPC health
 *   - Link their Solana wallet for trading bot
 *   - Quick portfolio overview
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import {
  HeliusClient,
  createUserHeliusClient,
  cacheHeliusApiKeyLocally,
  clearHeliusApiKeyLocalCache,
  type PortfolioSnapshot,
  type TokenBalance,
  SOL_MINT,
} from '../../../lib/heliusTrading';

const HELIUS_COLOR = '#9945FF';

type ViewMode = 'loading' | 'setup' | 'connected';

export default function HeliusTab({ circleId }: { circleId: string }) {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [storedKeyId, setStoredKeyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);

  useEffect(() => {
    loadState();
  }, [circleId]);

  const loadState = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMode('setup'); return; }
      setUserId(user.id);

      // Check for stored Helius key via RPC (respects auth.uid())
      const { data: allKeys } = await supabase.rpc('list_user_api_keys');
      const heliusKey = (allKeys || []).find((k: any) => k.provider === 'helius' && k.is_active);

      if (heliusKey?.id) {
        setStoredKeyId(heliusKey.id);

        // Check for linked Solana wallet
        const { data: profile } = await supabase
          .from('profiles')
          .select('wallet_address, wallet_address_sol')
          .eq('id', user.id)
          .single();

        const walletAddr = profile?.wallet_address_sol || profile?.wallet_address || null;
        if (walletAddr) {
          setWalletAddress(walletAddr);
          loadPortfolio(user.id, walletAddr);
        }

        setMode('connected');
      } else {
        setMode('setup');
      }
    } catch {
      setMode('setup');
    }
  };

  const loadPortfolio = async (uid: string, wallet: string) => {
    setLoadingPortfolio(true);
    try {
      const client = await createUserHeliusClient(uid);
      if (client) {
        const snap = await client.getPortfolio(wallet);
        setPortfolio(snap);
      }
    } catch (err) {
      console.error('Portfolio load error:', err);
    } finally {
      setLoadingPortfolio(false);
    }
  };

  const handleTestKey = async () => {
    if (!apiKeyInput.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const client = new HeliusClient({ apiKey: apiKeyInput.trim() });
      const balance = await client.getSolBalance('11111111111111111111111111111111');
      setTestResult({ ok: true, msg: 'Helius RPC is reachable' });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim() || !userId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('store_user_api_key', {
        p_provider: 'helius',
        p_api_key: apiKeyInput.trim(),
        p_label: 'Helius RPC',
        p_endpoint: null,
      });
      if (error) {
        setTestResult({ ok: false, msg: error.message });
      } else {
        await cacheHeliusApiKeyLocally(userId, apiKeyInput.trim());
        setStoredKeyId(data);
        setMode('connected');
        setTestResult(null);
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!storedKeyId) return;
    try {
      await supabase.rpc('delete_user_api_key', { p_key_id: storedKeyId });
      if (userId) await clearHeliusApiKeyLocalCache(userId);
      setStoredKeyId(null);
      setPortfolio(null);
      setApiKeyInput('');
      setMode('setup');
    } catch {}
  };

  const handleLinkWallet = async () => {
    // Try to detect Phantom wallet
    const phantom = (window as any)?.phantom?.solana;
    if (!phantom) {
      setTestResult({ ok: false, msg: 'Phantom wallet not detected. Install Phantom to link your Solana wallet.' });
      return;
    }
    try {
      const resp = await phantom.connect();
      const pubkey = resp.publicKey.toString();
      // Save to profile
      if (userId) {
        await supabase.from('profiles').update({ wallet_address_sol: pubkey, wallet_address: pubkey }).eq('id', userId);
        setWalletAddress(pubkey);
        loadPortfolio(userId, pubkey);
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message || 'Failed to connect Phantom' });
    }
  };

  // ── Loading ──
  if (mode === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={HELIUS_COLOR} />
      </View>
    );
  }

  // ── Setup: Enter API Key ──
  if (mode === 'setup') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          <Text style={styles.title}>Connect Helius</Text>
          <Text style={styles.desc}>
            Add your Helius API key to enable Solana RPC, token tracking, swaps via Jupiter, and the trading bot.
          </Text>

          <Pressable
            onPress={() => {
              if (Platform.OS === 'web') window.open('https://dashboard.helius.dev/', '_blank');
            }}
            style={styles.linkRow}
          >
            <Text style={styles.linkText}>Get your key at dashboard.helius.dev {'>'}</Text>
          </Pressable>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Helius API key..."
              placeholderTextColor="#555"
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.btnRow}>
            <Pressable
              onPress={handleTestKey}
              disabled={testing || !apiKeyInput.trim()}
              style={[styles.btn, styles.btnOutline]}
            >
              {testing ? <ActivityIndicator size="small" color={HELIUS_COLOR} /> :
                <Text style={[styles.btnText, { color: HELIUS_COLOR }]}>Test</Text>}
            </Pressable>

            <Pressable
              onPress={handleSaveKey}
              disabled={saving || !apiKeyInput.trim()}
              style={[styles.btn, styles.btnFilled]}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> :
                <Text style={[styles.btnText, { color: '#fff' }]}>Save & Connect</Text>}
            </Pressable>
          </View>

          {testResult && (
            <View style={[styles.resultBanner, { borderColor: testResult.ok ? '#22c55e40' : '#ef444440' }]}>
              <Text style={[styles.resultDot, { color: testResult.ok ? '#22c55e' : '#ef4444' }]}>
                {testResult.ok ? '+' : '!'}
              </Text>
              <Text style={[styles.resultText, { color: testResult.ok ? '#22c55e' : '#ef4444' }]}>
                {testResult.msg}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  // ── Connected ──
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {/* Status */}
      <View style={styles.section}>
        <View style={styles.statusRow}>
          <View style={styles.statusDotGreen} />
          <Text style={styles.statusText}>Helius Connected</Text>
        </View>
        <Text style={styles.desc}>
          Your Helius API key is active. Trading bot, token balances, and Jupiter swaps are available.
        </Text>
      </View>

      {/* Wallet Link */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Solana Wallet</Text>
        {walletAddress ? (
          <View style={styles.walletCard}>
            <Text style={styles.walletLabel}>Connected</Text>
            <Text style={styles.walletAddr}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</Text>
            {loadingPortfolio && <ActivityIndicator size="small" color={HELIUS_COLOR} style={{ marginTop: 8 }} />}
          </View>
        ) : (
          <Pressable onPress={handleLinkWallet} style={[styles.btn, styles.btnFilled, { alignSelf: 'flex-start' }]}>
            <Text style={[styles.btnText, { color: '#fff' }]}>Link Phantom Wallet</Text>
          </Pressable>
        )}
      </View>

      {/* Portfolio Preview */}
      {portfolio && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio Snapshot</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>${portfolio.totalValueUsd.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Total Value</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{portfolio.solBalance.toFixed(4)}</Text>
              <Text style={styles.statLabel}>SOL Balance</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{portfolio.tokens.length}</Text>
              <Text style={styles.statLabel}>Tokens</Text>
            </View>
          </View>

          {/* Top tokens */}
          {portfolio.tokens.filter(t => t.usdValue > 0.01).slice(0, 8).map((token, i) => (
            <View key={token.mint} style={styles.tokenRow}>
              <View style={styles.tokenLeft}>
                <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                <Text style={styles.tokenName}>{token.name}</Text>
              </View>
              <View style={styles.tokenRight}>
                <Text style={styles.tokenAmount}>{token.amount.toFixed(4)}</Text>
                <Text style={styles.tokenUsd}>${token.usdValue.toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Quick Links */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Integrations</Text>
        <Text style={styles.desc}>
          Helius powers the following features across the Office:
        </Text>
        <View style={styles.featureList}>
          {[
            { label: 'Trading Bot', desc: 'DCA, alerts, and manual swaps via Backpack' },
            { label: 'Automations', desc: 'Trading automation templates (portfolio monitor, alerts, DCA)' },
            { label: 'Wallet Tab', desc: 'Token balances and transaction history' },
          ].map(f => (
            <View key={f.label} style={styles.featureRow}>
              <Text style={styles.featureBullet}>{'>'}</Text>
              <View>
                <Text style={styles.featureLabel}>{f.label}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Disconnect */}
      <View style={styles.section}>
        <Pressable onPress={handleDisconnect} style={[styles.btn, styles.btnDanger]}>
          <Text style={[styles.btnText, { color: '#ef4444' }]}>Disconnect Helius</Text>
        </Pressable>
      </View>

      {testResult && (
        <View style={[styles.resultBanner, { borderColor: testResult.ok ? '#22c55e40' : '#ef444440' }]}>
          <Text style={[styles.resultDot, { color: testResult.ok ? '#22c55e' : '#ef4444' }]}>
            {testResult.ok ? '+' : '!'}
          </Text>
          <Text style={[styles.resultText, { color: testResult.ok ? '#22c55e' : '#ef4444' }]}>
            {testResult.msg}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40, gap: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  section: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    padding: 16,
  },
  title: {
    color: HELIUS_COLOR,
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  desc: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
    marginBottom: 12,
  },

  // Link
  linkRow: { marginBottom: 16 },
  linkText: { color: HELIUS_COLOR, fontSize: 12, fontFamily: 'monospace', fontWeight: '600' },

  // Input
  inputRow: { marginBottom: 12 },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
  },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: HELIUS_COLOR + '40',
    backgroundColor: HELIUS_COLOR + '08',
  },
  btnFilled: {
    backgroundColor: HELIUS_COLOR,
  },
  btnDanger: {
    borderWidth: 1,
    borderColor: '#ef444440',
    backgroundColor: '#ef444408',
  },
  btnText: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },

  // Result
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#0a0a0a',
  },
  resultDot: { fontSize: 14, fontWeight: '900', fontFamily: 'monospace', width: 18, textAlign: 'center' },
  resultText: { fontSize: 12, fontFamily: 'monospace', flex: 1 },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusDotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  statusText: { color: '#22c55e', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },

  // Wallet
  walletCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HELIUS_COLOR + '30',
    padding: 12,
  },
  walletLabel: { color: HELIUS_COLOR, fontSize: 11, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4 },
  walletAddr: { color: '#ccc', fontSize: 13, fontFamily: 'monospace' },

  // Stats
  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    padding: 10,
    alignItems: 'center',
  },
  statValue: { color: '#fff', fontSize: 16, fontWeight: '800', fontFamily: 'monospace' },
  statLabel: { color: '#666', fontSize: 10, fontFamily: 'monospace', marginTop: 4 },

  // Tokens
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  tokenLeft: { flex: 1 },
  tokenSymbol: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  tokenName: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
  tokenRight: { alignItems: 'flex-end' },
  tokenAmount: { color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  tokenUsd: { color: '#888', fontSize: 11, fontFamily: 'monospace' },

  // Features
  featureList: { gap: 10 },
  featureRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  featureBullet: { color: HELIUS_COLOR, fontSize: 12, fontWeight: '700', fontFamily: 'monospace', marginTop: 1 },
  featureLabel: { color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: 'monospace' },
  featureDesc: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
});
