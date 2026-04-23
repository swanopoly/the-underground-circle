// ═══════════════════════════════════════════════════════════════════════════════
//  PokerGame — Fullscreen WSOP-style Texas Hold'em
//  Supports N players (humans + AI agents), tournaments, side pots
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, Animated,
  ScrollView, Platform, Dimensions,
} from 'react-native';
import type { OfficeAgent } from '../../lib/officeAgents';
import {
  PokerGameState, PokerSeat, CreateGameConfig, GamePhase, PlayerAction,
  createGame, dealNewHand, playerAction, aiDecide, isHumanTurn,
  canCheck, getCallAmount, formatChips, getAiLine,
  profileFromId, BLACKSWAN_PROFILE, AiProfile,
} from '../../lib/pokerEngine';

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  agents: OfficeAgent[];
  circleId: string;
  currentUserId: string;
  currentUserName: string;
  onStateChange?: (summary: {
    phase: string;
    playerChips: number;
    handsWon: number;
    handsPlayed: number;
    playerCount: number;
  }) => void;
}

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  felt: '#0a2e1a',
  feltLight: '#0d3d23',
  feltDark: '#061a0f',
  rail: '#8B6914',
  railLight: '#c49b2c',
  railDark: '#5a4510',
  bg: '#050508',
  surface: '#0c0c18',
  card: '#f8f9fa',
  cardBack: '#0a1628',
  red: '#e63946',
  black: '#1d3557',
  gold: '#fbbf24',
  green: '#22c55e',
  purple: '#8b5cf6',
  blue: '#3b82f6',
  text: '#e2e8f0',
  textDim: '#64748b',
  textMuted: '#334155',
  danger: '#ef4444',
  accent: '#6366f1',
};

// ── Seat positions around oval table ─────────────────────────────────────────

function getSeatPositions(count: number, w: number, h: number): Array<{ x: number; y: number; labelBelow: boolean }> {
  const cx = w / 2;
  const cy = h * 0.44;
  const rx = w * 0.40;
  const ry = h * 0.32;
  const positions: Array<{ x: number; y: number; labelBelow: boolean }> = [];

  // Start from bottom center (player's seat), go clockwise
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI / 2) + (2 * Math.PI * i / count);
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    positions.push({ x, y, labelBelow: y > cy });
  }
  return positions;
}

// ── Card Component ───────────────────────────────────────────────────────────

function CardView({ card, faceDown, small }: { card?: string; faceDown?: boolean; small?: boolean }) {
  const w = small ? 36 : 52;
  const h = small ? 50 : 72;

  if (faceDown || !card) {
    return (
      <View style={[cardStyles.card, { width: w, height: h, backgroundColor: C.cardBack, borderColor: C.purple + '60' }]}>
        <View style={cardStyles.backPattern}>
          <View style={cardStyles.backInner}>
            <Text style={{ fontSize: small ? 10 : 14, opacity: 0.4 }}>🃏</Text>
          </View>
        </View>
      </View>
    );
  }

  const rank = card.replace(/[♠♥♦♣]/g, '');
  const suit = card.slice(-1);
  const isRed = suit === '♥' || suit === '♦';

  return (
    <View style={[cardStyles.card, { width: w, height: h }]}>
      <Text style={[cardStyles.rankTop, { color: isRed ? C.red : C.black, fontSize: small ? 10 : 14 }]}>{rank}</Text>
      <Text style={[cardStyles.suitCenter, { color: isRed ? C.red : C.black, fontSize: small ? 18 : 26 }]}>{suit}</Text>
      <Text style={[cardStyles.rankBot, { color: isRed ? C.red : C.black, fontSize: small ? 10 : 14 }]}>{rank}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 6, borderWidth: 1, borderColor: '#dee2e6',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    ...Platform.select({ web: { boxShadow: '0 2px 8px rgba(0,0,0,0.3)' } as any, default: { elevation: 4 } }),
  },
  backPattern: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#0f2340',
    borderRadius: 4, margin: 3, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.purple + '30',
  },
  backInner: { alignItems: 'center', justifyContent: 'center' },
  rankTop: { position: 'absolute', top: 3, left: 4, fontWeight: '900', fontFamily: 'monospace' },
  suitCenter: { fontWeight: '700' },
  rankBot: { position: 'absolute', bottom: 3, right: 4, fontWeight: '900', fontFamily: 'monospace', transform: [{ rotate: '180deg' }] },
});

// ── Chip Stack Visual ────────────────────────────────────────────────────────

const CHIP_COLORS: Array<{ min: number; color: string; accent: string }> = [
  { min: 1000, color: C.gold, accent: '#78350f' },
  { min: 500, color: '#1e293b', accent: C.gold },
  { min: 100, color: C.blue, accent: '#fff' },
  { min: 25, color: C.green, accent: '#fff' },
  { min: 5, color: C.danger, accent: '#fff' },
  { min: 1, color: '#f8f9fa', accent: '#888' },
];

function ChipStack({ amount, compact }: { amount: number; compact?: boolean }) {
  const chipSize = compact ? 14 : 20;
  const stackH = compact ? 3 : 4;
  let remaining = amount;
  const chips: Array<{ color: string; accent: string }> = [];

  for (const { min, color, accent } of CHIP_COLORS) {
    while (remaining >= min && chips.length < 6) {
      chips.push({ color, accent });
      remaining -= min;
    }
  }

  if (chips.length === 0) chips.push({ color: '#f8f9fa', accent: '#888' });

  return (
    <View style={{ alignItems: 'center', width: chipSize + 4 }}>
      {chips.slice(0, 5).map((chip, i) => (
        <View key={i} style={{
          width: chipSize, height: stackH, borderRadius: chipSize,
          backgroundColor: chip.color, borderWidth: 1, borderColor: chip.accent + '60',
          marginTop: i > 0 ? -(stackH * 0.4) : 0,
        }} />
      ))}
    </View>
  );
}

// ── Player Seat Component ────────────────────────────────────────────────────

function SeatView({ seat, isActive, isDealer, showCards, gamePhase, pos }: {
  seat: PokerSeat;
  isActive: boolean;
  isDealer: boolean;
  showCards: boolean;
  gamePhase: GamePhase;
  pos: { x: number; y: number; labelBelow: boolean };
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isActive) { pulseAnim.setValue(1); return; }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: false }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [isActive]);

  const borderColor = seat.folded ? C.textMuted
    : isActive ? C.green
    : seat.allIn ? C.gold
    : seat.lastAction.includes('RAISE') || seat.lastAction.includes('ALL-IN') ? C.purple
    : C.textDim;

  const isWinner = gamePhase === 'hand_complete' && !seat.folded && !seat.eliminated;

  return (
    <View style={[seatStyles.container, { left: pos.x - 44, top: pos.y - 36 }]}>
      {/* Cards */}
      {seat.hand && gamePhase !== 'lobby' && (
        <View style={seatStyles.cardsWrap}>
          <View style={{ transform: [{ rotate: '-6deg' }], marginRight: -6 }}>
            <CardView card={showCards ? seat.hand[0] : undefined} faceDown={!showCards} small />
          </View>
          <View style={{ transform: [{ rotate: '6deg' }] }}>
            <CardView card={showCards ? seat.hand[1] : undefined} faceDown={!showCards} small />
          </View>
        </View>
      )}

      {/* Avatar */}
      <Animated.View style={[
        seatStyles.avatar,
        { borderColor, opacity: seat.folded ? 0.4 : 1 },
        isActive && { borderWidth: 2.5 },
        isWinner && { borderColor: C.gold },
        isActive && { shadowColor: C.green, shadowOpacity: pulseAnim as any },
      ]}>
        <Text style={seatStyles.avatarText}>{seat.avatar}</Text>
      </Animated.View>

      {/* Dealer button */}
      {isDealer && (
        <View style={seatStyles.dealerBtn}>
          <Text style={seatStyles.dealerBtnText}>D</Text>
        </View>
      )}

      {/* Name + chips */}
      <View style={seatStyles.info}>
        <Text style={[seatStyles.name, seat.folded && { color: C.textMuted }]} numberOfLines={1}>{seat.name}</Text>
        <View style={seatStyles.chipsRow}>
          <ChipStack amount={seat.chips} compact />
          <Text style={[seatStyles.chipsText, seat.chips <= 0 && { color: C.danger }]}>{formatChips(seat.chips)}</Text>
        </View>
      </View>

      {/* Action badge */}
      {seat.lastAction && !seat.lastAction.includes('SB') && !seat.lastAction.includes('BB') && (
        <View style={[seatStyles.actionBadge, {
          backgroundColor: seat.lastAction.includes('FOLD') ? C.danger + '30' :
            seat.lastAction.includes('RAISE') || seat.lastAction.includes('ALL-IN') ? C.purple + '30' :
            C.green + '30',
          borderColor: seat.lastAction.includes('FOLD') ? C.danger + '60' :
            seat.lastAction.includes('RAISE') || seat.lastAction.includes('ALL-IN') ? C.purple + '60' :
            C.green + '60',
        }]}>
          <Text style={[seatStyles.actionText, {
            color: seat.lastAction.includes('FOLD') ? C.danger :
              seat.lastAction.includes('RAISE') || seat.lastAction.includes('ALL-IN') ? C.purple :
              C.green,
          }]}>{seat.lastAction.split(' ')[0]}</Text>
        </View>
      )}

      {/* Current bet */}
      {seat.currentBet > 0 && (
        <View style={seatStyles.betChip}>
          <Text style={seatStyles.betText}>{formatChips(seat.currentBet)}</Text>
        </View>
      )}
    </View>
  );
}

const seatStyles = StyleSheet.create({
  container: { position: 'absolute', width: 88, alignItems: 'center', zIndex: 5 },
  cardsWrap: { flexDirection: 'row', justifyContent: 'center', marginBottom: 2, zIndex: 6 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#0f172a',
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    ...Platform.select({ web: { boxShadow: '0 0 12px rgba(0,0,0,0.5)' } as any, default: { elevation: 6 } }),
  },
  avatarText: { fontSize: 20 },
  dealerBtn: {
    position: 'absolute', top: 44, right: 2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: C.gold, borderWidth: 1.5, borderColor: '#f59e0b',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  dealerBtnText: { color: '#78350f', fontSize: 9, fontWeight: '900' },
  info: { alignItems: 'center', marginTop: 2 },
  name: { fontSize: 10, fontWeight: '700', color: C.text, fontFamily: 'monospace', maxWidth: 80 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  chipsText: { fontSize: 10, fontWeight: '800', color: C.gold, fontFamily: 'monospace' },
  actionBadge: {
    position: 'absolute', top: -8, right: -8,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6,
    borderWidth: 1, zIndex: 10,
  },
  actionText: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace' },
  betChip: {
    position: 'absolute', top: 30, left: -10,
    backgroundColor: C.gold + '25', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: C.gold + '40',
  },
  betText: { fontSize: 8, fontWeight: '800', color: C.gold, fontFamily: 'monospace' },
});

// ── Main Component ───────────────────────────────────────────────────────────

export default function PokerGame({ visible, onClose, agents, circleId, currentUserId, currentUserName, onStateChange }: Props) {
  const [game, setGame] = useState<PokerGameState | null>(null);
  const [handsWon, setHandsWon] = useState(0);
  const [handsPlayed, setHandsPlayed] = useState(0);
  const [aiMessage, setAiMessage] = useState('');
  const [showdown, setShowdown] = useState(false);
  const [showRaiseSlider, setShowRaiseSlider] = useState(false);
  const aiTimerRef = useRef<any>(null);
  const gameRef = useRef<PokerGameState | null>(null);
  gameRef.current = game;
  const dim = Dimensions.get('window');

  // ── Lobby config ──
  const [lobbyChips, setLobbyChips] = useState(5000);
  const [lobbyBlinds, setLobbyBlinds] = useState({ sb: 25, bb: 50 });
  const [lobbyTournament, setLobbyTournament] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(['blackswan']);

  // Available AI opponents
  const availableAi = useMemo(() => {
    const ais: Array<{ id: string; name: string; avatar: string; profile: AiProfile }> = [
      { id: 'blackswan', name: 'BlackSwan', avatar: '🦢', profile: BLACKSWAN_PROFILE },
    ];
    for (const agent of agents) {
      if (agent.id === 'default::blackswan') continue;
      if (ais.find(a => a.id === agent.id)) continue;
      ais.push({
        id: agent.id,
        name: agent.name.slice(0, 12),
        avatar: agent.color?.startsWith('#') ? '🤖' : (agent.color || '🤖'),
        profile: profileFromId(agent.id),
      });
    }
    return ais;
  }, [agents]);

  // ── Start game ──
  const startGame = useCallback(() => {
    const players: CreateGameConfig['players'] = [
      { id: currentUserId || 'player', name: currentUserName || 'You', avatar: '👤', type: 'human' },
    ];

    for (const agId of selectedAgents) {
      const ai = availableAi.find(a => a.id === agId);
      if (ai) {
        players.push({ id: ai.id, name: ai.name, avatar: ai.avatar, type: 'ai', aiProfile: ai.profile });
      }
    }

    if (players.length < 2) return;

    const state = createGame({
      players,
      startingChips: lobbyChips,
      blinds: lobbyBlinds,
      tournament: lobbyTournament,
    });

    const dealt = dealNewHand(state);
    setGame(dealt);
    setHandsPlayed(1);
    setHandsWon(0);
    setShowdown(false);
    setAiMessage('');
  }, [selectedAgents, lobbyChips, lobbyBlinds, lobbyTournament, availableAi, currentUserId, currentUserName]);

  // ── Process AI turns ──
  useEffect(() => {
    if (!game) return;
    if (game.phase === 'lobby' || game.phase === 'hand_complete' || game.phase === 'showdown') return;

    const activeSeat = game.seats[game.activePlayerIdx];
    if (!activeSeat || activeSeat.type !== 'ai' || activeSeat.folded || activeSeat.allIn) return;

    // Delay for realism
    const delay = 600 + Math.random() * 1200;
    aiTimerRef.current = setTimeout(() => {
      const currentGame = gameRef.current;
      if (!currentGame) return;
      const currentSeat = currentGame.seats[currentGame.activePlayerIdx];
      if (!currentSeat || currentSeat.type !== 'ai' || currentSeat.folded || currentSeat.allIn) return;

      const decision = aiDecide(currentGame, currentSeat);
      const profile = currentSeat.aiProfile || BLACKSWAN_PROFILE;

      // Get personality line
      const lineCtx = decision.action === 'fold' ? 'fold'
        : decision.action === 'raise' ? 'raise'
        : decision.action === 'allin' ? 'allin'
        : decision.action === 'call' ? 'call'
        : 'deal';
      const line = getAiLine(profile, lineCtx);
      setAiMessage(`${currentSeat.avatar} ${currentSeat.name}: "${line}"`);

      const newState = playerAction(currentGame, currentSeat.id, decision.action, decision.amount);
      setGame(newState);
    }, delay);

    return () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); };
  }, [game?.activePlayerIdx, game?.phase, game?.actionCount]);

  // ── Handle hand completion ──
  useEffect(() => {
    if (!game || game.phase !== 'hand_complete') return;

    setShowdown(true);
    const humanWon = game.winners.some(w => w.playerId === (currentUserId || 'player'));
    if (humanWon) setHandsWon(prev => prev + 1);

    // Show winner messages
    if (game.winners.length > 0) {
      const winner = game.seats.find(s => s.id === game.winners[0].playerId);
      if (winner) {
        const profile = winner.aiProfile;
        if (profile) {
          const line = getAiLine(profile, humanWon ? 'lose' : 'win');
          setAiMessage(`${winner.avatar} ${winner.name}: "${line}"`);
        }
      }
    }

    // Sync state back to furniture tile
    const humanSeat = game.seats.find(s => s.type === 'human');
    onStateChange?.({
      phase: 'showdown',
      playerChips: humanSeat?.chips || 0,
      handsWon: handsWon + (humanWon ? 1 : 0),
      handsPlayed,
      playerCount: game.seats.filter(s => !s.eliminated).length,
    });
  }, [game?.phase]);

  // ── Deal next hand ──
  const dealNext = useCallback(() => {
    const currentGame = gameRef.current;
    if (!currentGame) return;
    setShowdown(false);
    setAiMessage('');
    setShowRaiseSlider(false);

    const activePlayers = currentGame.seats.filter(s => !s.eliminated && s.chips > 0);
    if (activePlayers.length < 2) {
      setGame(null);
      return;
    }

    const newState = dealNewHand(currentGame);
    setGame(newState);
    setHandsPlayed(prev => prev + 1);
  }, []);

  // ── Handle player action ──
  const handleAction = useCallback((action: PlayerAction, amount?: number) => {
    const currentGame = gameRef.current;
    if (!currentGame) return;
    const humanId = currentUserId || 'player';
    setShowRaiseSlider(false);
    const newState = playerAction(currentGame, humanId, action, amount);
    setGame(newState);
  }, [currentUserId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const humanSeat = game?.seats.find(s => s.type === 'human');
  const humanTurn = game ? isHumanTurn(game) : false;
  const callAmt = game ? getCallAmount(game) : 0;
  const canCheckNow = game ? canCheck(game) : false;
  const tableW = Math.min(dim.width, 800);
  const tableH = Math.min(dim.height * 0.65, 500);
  const positions = game ? getSeatPositions(game.seats.length, tableW, tableH) : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <View style={[s.container, { maxWidth: 820, maxHeight: dim.height - 20 }]} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Text style={s.headerTitle}>♠ TEXAS HOLD'EM</Text>
              {game && (
                <Text style={s.headerSub}>
                  Hand #{game.handNumber} · {game.blinds.sb}/{game.blinds.bb}
                  {game.tournament?.enabled ? ` · Level ${game.tournament.currentLevel + 1}` : ''}
                </Text>
              )}
            </View>
            <View style={s.headerRight}>
              {game && (
                <Text style={s.headerStats}>
                  W: {handsWon}/{handsPlayed} · Chips: {formatChips(humanSeat?.chips || 0)}
                </Text>
              )}
              <Pressable onPress={onClose} style={s.closeBtn}>
                <Text style={s.closeBtnText}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* ── LOBBY ── */}
          {!game && (
            <ScrollView style={s.lobbyScroll} contentContainerStyle={s.lobby}>
              <Text style={s.lobbyTitle}>🃏 TABLE SETUP</Text>

              {/* Chip + Blind config */}
              <View style={s.lobbySection}>
                <Text style={s.lobbyLabel}>STARTING CHIPS</Text>
                <View style={s.lobbyRow}>
                  {[2000, 5000, 10000, 25000].map(v => (
                    <Pressable key={v} onPress={() => setLobbyChips(v)}
                      style={[s.lobbyChip, lobbyChips === v && s.lobbyChipActive]}>
                      <Text style={[s.lobbyChipText, lobbyChips === v && s.lobbyChipTextActive]}>{formatChips(v)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={s.lobbySection}>
                <Text style={s.lobbyLabel}>BLINDS</Text>
                <View style={s.lobbyRow}>
                  {[{ sb: 10, bb: 20 }, { sb: 25, bb: 50 }, { sb: 50, bb: 100 }, { sb: 100, bb: 200 }].map(v => (
                    <Pressable key={v.sb} onPress={() => setLobbyBlinds(v)}
                      style={[s.lobbyChip, lobbyBlinds.sb === v.sb && s.lobbyChipActive]}>
                      <Text style={[s.lobbyChipText, lobbyBlinds.sb === v.sb && s.lobbyChipTextActive]}>{v.sb}/{v.bb}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={s.lobbySection}>
                <Pressable onPress={() => setLobbyTournament(!lobbyTournament)} style={s.lobbyToggleRow}>
                  <View style={[s.lobbyToggle, lobbyTournament && s.lobbyToggleOn]}>
                    <Text style={{ fontSize: 10, color: lobbyTournament ? C.gold : '#555' }}>{lobbyTournament ? '✓' : ''}</Text>
                  </View>
                  <Text style={s.lobbyToggleLabel}>TOURNAMENT MODE</Text>
                  <Text style={s.lobbyToggleDesc}>(blind escalation)</Text>
                </Pressable>
              </View>

              {/* Player selection */}
              <View style={s.lobbySection}>
                <Text style={s.lobbyLabel}>OPPONENTS ({selectedAgents.length}/{Math.min(availableAi.length, 8)})</Text>
                <View style={s.lobbyPlayers}>
                  {availableAi.map(ai => {
                    const selected = selectedAgents.includes(ai.id);
                    return (
                      <Pressable key={ai.id} onPress={() => {
                        setSelectedAgents(prev =>
                          prev.includes(ai.id)
                            ? prev.filter(id => id !== ai.id)
                            : prev.length < 8 ? [...prev, ai.id] : prev
                        );
                      }} style={[s.lobbyPlayer, selected && s.lobbyPlayerActive]}>
                        <Text style={s.lobbyPlayerAvatar}>{ai.avatar}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.lobbyPlayerName, selected && { color: C.text }]}>{ai.name}</Text>
                          <Text style={s.lobbyPlayerStyle}>{ai.profile.style.toUpperCase()}</Text>
                        </View>
                        <View style={[s.lobbyPlayerCheck, selected && { backgroundColor: C.green, borderColor: C.green }]}>
                          {selected && <Text style={{ fontSize: 10, color: '#fff' }}>✓</Text>}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Pressable onPress={startGame} style={[s.startBtn, selectedAgents.length === 0 && { opacity: 0.3 }]}
                disabled={selectedAgents.length === 0}>
                <Text style={s.startBtnText}>DEAL — {selectedAgents.length + 1} PLAYERS</Text>
              </Pressable>
            </ScrollView>
          )}

          {/* ── GAME TABLE ── */}
          {game && (
            <View style={s.tableArea}>
              {/* Felt table */}
              <View style={[s.table, { width: tableW, height: tableH }]}>
                {/* Felt gradient layers */}
                <View style={s.feltBase} />
                <View style={s.feltOverlay} />
                {/* Rail */}
                <View style={s.railOuter} />
                <View style={s.railInner} />

                {/* Community cards */}
                {game.community.length > 0 && (
                  <View style={s.communityWrap}>
                    {game.community.map((card, i) => (
                      <View key={i} style={{ marginHorizontal: 2 }}>
                        <CardView card={card} />
                      </View>
                    ))}
                  </View>
                )}

                {/* Pot */}
                {game.pot > 0 && (
                  <View style={s.potWrap}>
                    <ChipStack amount={game.pot} />
                    <Text style={s.potText}>{formatChips(game.pot)}</Text>
                  </View>
                )}

                {/* Phase label */}
                <View style={s.phaseWrap}>
                  <Text style={s.phaseText}>
                    {game.phase === 'preflop' ? 'PRE-FLOP' :
                     game.phase === 'hand_complete' ? (game.winners[0] ? `${game.seats.find(s2 => s2.id === game.winners[0].playerId)?.name || '?'} WINS` : 'COMPLETE') :
                     game.phase.toUpperCase()}
                  </Text>
                </View>

                {/* Player seats */}
                {game.seats.map((seat, i) => {
                  const pos = positions[i];
                  if (!pos || seat.eliminated) return null;
                  const isHuman = seat.type === 'human';
                  const isShowdownPhase = game.phase === 'hand_complete' || game.phase === 'showdown';
                  const showCards = isHuman || (isShowdownPhase && !seat.folded);
                  return (
                    <SeatView
                      key={seat.id}
                      seat={seat}
                      isActive={game.activePlayerIdx === i && game.phase !== 'hand_complete'}
                      isDealer={game.dealerIdx === i}
                      showCards={showCards}
                      gamePhase={game.phase}
                      pos={pos}
                    />
                  );
                })}

                {/* Winner hand name overlay */}
                {game.phase === 'hand_complete' && game.winners.length > 0 && (
                  <View style={s.winnerOverlay}>
                    {game.winners.map((w, i) => {
                      const winner = game.seats.find(s2 => s2.id === w.playerId);
                      return (
                        <View key={i} style={s.winnerCard}>
                          <Text style={s.winnerAvatar}>{winner?.avatar || '?'}</Text>
                          <View>
                            <Text style={s.winnerName}>{winner?.name || '?'} wins {formatChips(w.amount)}</Text>
                            <Text style={s.winnerHand}>{w.handName}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* AI message */}
              {aiMessage ? (
                <View style={s.aiMessageWrap}>
                  <Text style={s.aiMessageText}>{aiMessage}</Text>
                </View>
              ) : null}

              {/* ── ACTION BAR ── */}
              <View style={s.actionBar}>
                {game.phase === 'hand_complete' ? (
                  <View style={s.actionRow}>
                    <Pressable onPress={dealNext} style={s.dealNextBtn}>
                      <Text style={s.dealNextBtnText}>DEAL NEXT HAND</Text>
                    </Pressable>
                    <Pressable onPress={() => setGame(null)} style={s.leaveBtn}>
                      <Text style={s.leaveBtnText}>LEAVE TABLE</Text>
                    </Pressable>
                  </View>
                ) : humanTurn ? (
                  <View style={{ width: '100%' }}>
                    <View style={s.actionRow}>
                      <Pressable onPress={() => handleAction('fold')} style={s.foldBtn}>
                        <Text style={s.foldBtnText}>FOLD</Text>
                      </Pressable>
                      <Pressable onPress={() => handleAction(canCheckNow ? 'check' : 'call')} style={s.callBtn}>
                        <Text style={s.callBtnText}>{canCheckNow ? 'CHECK' : `CALL ${formatChips(callAmt)}`}</Text>
                      </Pressable>
                      <Pressable onPress={() => setShowRaiseSlider(!showRaiseSlider)} style={s.raiseBtn}>
                        <Text style={s.raiseBtnText}>RAISE</Text>
                      </Pressable>
                      <Pressable onPress={() => handleAction('allin')} style={s.allInBtn}>
                        <Text style={s.allInBtnText}>ALL IN</Text>
                      </Pressable>
                    </View>

                    {/* Raise presets */}
                    {showRaiseSlider && (
                      <View style={s.raisePresets}>
                        {[
                          { label: '2x BB', amount: game.blinds.bb * 2 },
                          { label: '½ Pot', amount: Math.floor(game.pot * 0.5) },
                          { label: '¾ Pot', amount: Math.floor(game.pot * 0.75) },
                          { label: 'Pot', amount: game.pot },
                          { label: '2x Pot', amount: game.pot * 2 },
                        ].filter(p => p.amount <= (humanSeat?.chips || 0)).map(preset => (
                          <Pressable key={preset.label} onPress={() => handleAction('raise', preset.amount)} style={s.raisePresetBtn}>
                            <Text style={s.raisePresetText}>{preset.label}</Text>
                            <Text style={s.raisePresetAmt}>{formatChips(preset.amount)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={s.waitingRow}>
                    <View style={s.waitingDot} />
                    <Text style={s.waitingText}>
                      {game.seats[game.activePlayerIdx]?.name || '...'} is thinking...
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  container: {
    flex: 1, width: '100%', backgroundColor: C.bg, borderRadius: 0,
    overflow: 'hidden',
  },
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#0a0a14', borderBottomWidth: 1, borderBottomColor: '#1a1a2a',
  },
  headerLeft: {},
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 16, fontWeight: '900', color: C.text, fontFamily: 'monospace', letterSpacing: 2 },
  headerSub: { fontSize: 11, color: C.textDim, fontFamily: 'monospace', marginTop: 2 },
  headerStats: { fontSize: 11, color: C.gold, fontFamily: 'monospace', fontWeight: '700' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a2a',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a2a3a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  closeBtnText: { fontSize: 14, color: C.textDim, fontWeight: '700' },

  // Lobby
  lobbyScroll: { flex: 1 },
  lobby: { padding: 20, alignItems: 'center' },
  lobbyTitle: { fontSize: 20, fontWeight: '900', color: C.text, fontFamily: 'monospace', letterSpacing: 2, marginBottom: 20 },
  lobbySection: { width: '100%', maxWidth: 500, marginBottom: 16 },
  lobbyLabel: { fontSize: 10, fontWeight: '800', color: C.textDim, fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8 },
  lobbyRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  lobbyChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a3a', backgroundColor: '#111124',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  lobbyChipActive: { borderColor: C.green + '80', backgroundColor: C.green + '15' },
  lobbyChipText: { fontSize: 13, fontWeight: '700', color: C.textDim, fontFamily: 'monospace' },
  lobbyChipTextActive: { color: C.green },
  lobbyToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lobbyToggle: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#2a2a3a',
    backgroundColor: '#111124', alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  lobbyToggleOn: { borderColor: C.gold + '80', backgroundColor: C.gold + '15' },
  lobbyToggleLabel: { fontSize: 12, fontWeight: '800', color: C.text, fontFamily: 'monospace' },
  lobbyToggleDesc: { fontSize: 10, color: C.textDim, fontFamily: 'monospace' },
  lobbyPlayers: { gap: 6 },
  lobbyPlayer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a3a', backgroundColor: '#111124',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  lobbyPlayerActive: { borderColor: C.accent + '60', backgroundColor: C.accent + '10' },
  lobbyPlayerAvatar: { fontSize: 24 },
  lobbyPlayerName: { fontSize: 13, fontWeight: '700', color: C.textDim, fontFamily: 'monospace' },
  lobbyPlayerStyle: { fontSize: 9, fontWeight: '700', color: C.textMuted, fontFamily: 'monospace', letterSpacing: 1, marginTop: 1 },
  lobbyPlayerCheck: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#2a2a3a',
    alignItems: 'center', justifyContent: 'center',
  },
  startBtn: {
    paddingHorizontal: 40, paddingVertical: 14, borderRadius: 10,
    backgroundColor: C.green + '20', borderWidth: 1.5, borderColor: C.green + '60',
    marginTop: 20,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  startBtnText: { fontSize: 15, fontWeight: '900', color: C.green, fontFamily: 'monospace', letterSpacing: 2 },

  // Table area
  tableArea: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  table: {
    backgroundColor: C.felt, borderRadius: 120, overflow: 'hidden',
    position: 'relative',
    ...Platform.select({ web: { boxShadow: '0 4px 30px rgba(0,0,0,0.6), inset 0 0 60px rgba(10,46,26,0.5)' } as any, default: { elevation: 10 } }),
  },
  feltBase: {
    ...StyleSheet.absoluteFillObject, borderRadius: 120,
    backgroundColor: C.felt,
  },
  feltOverlay: {
    ...StyleSheet.absoluteFillObject, borderRadius: 120,
    backgroundColor: 'transparent',
    borderWidth: 2, borderColor: C.feltLight + '30',
  },
  railOuter: {
    ...StyleSheet.absoluteFillObject, borderRadius: 120,
    borderWidth: 8, borderColor: C.railDark, backgroundColor: 'transparent',
  },
  railInner: {
    ...StyleSheet.absoluteFillObject, borderRadius: 112,
    borderWidth: 2, borderColor: C.railLight + '40', backgroundColor: 'transparent',
    margin: 6,
  },

  // Community cards
  communityWrap: {
    position: 'absolute', top: '35%' as any, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', zIndex: 8,
  },

  // Pot
  potWrap: {
    position: 'absolute', top: '22%' as any, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, zIndex: 8,
  },
  potText: { fontSize: 16, fontWeight: '900', color: C.gold, fontFamily: 'monospace',
    ...Platform.select({ web: { textShadow: '0 0 8px rgba(251,191,36,0.4)' } as any, default: {} }),
  },

  // Phase label
  phaseWrap: {
    position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center', zIndex: 10,
  },
  phaseText: {
    fontSize: 11, fontWeight: '900', color: C.gold, fontFamily: 'monospace', letterSpacing: 2,
    backgroundColor: '#0008', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8,
  },

  // Winner overlay
  winnerOverlay: {
    position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center', zIndex: 12,
  },
  winnerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.gold + '20', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: C.gold + '50',
  },
  winnerAvatar: { fontSize: 24 },
  winnerName: { fontSize: 13, fontWeight: '900', color: C.gold, fontFamily: 'monospace' },
  winnerHand: { fontSize: 11, fontWeight: '700', color: C.text, fontFamily: 'monospace', marginTop: 1 },

  // AI message
  aiMessageWrap: {
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.accent + '15',
    borderRadius: 8, borderWidth: 1, borderColor: C.accent + '30', marginTop: 6, maxWidth: 500,
  },
  aiMessageText: { fontSize: 11, color: C.accent, fontFamily: 'monospace', fontWeight: '600', textAlign: 'center' },

  // Action bar
  actionBar: {
    width: '100%', maxWidth: 600, paddingVertical: 10, paddingHorizontal: 8,
    alignItems: 'center',
  },
  actionRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  foldBtn: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8,
    backgroundColor: C.danger + '20', borderWidth: 1, borderColor: C.danger + '50',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  foldBtnText: { fontSize: 13, fontWeight: '900', color: C.danger, fontFamily: 'monospace' },
  callBtn: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8,
    backgroundColor: C.green + '20', borderWidth: 1, borderColor: C.green + '50',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  callBtnText: { fontSize: 13, fontWeight: '900', color: C.green, fontFamily: 'monospace' },
  raiseBtn: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8,
    backgroundColor: C.purple + '20', borderWidth: 1, borderColor: C.purple + '50',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  raiseBtnText: { fontSize: 13, fontWeight: '900', color: C.purple, fontFamily: 'monospace' },
  allInBtn: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8,
    backgroundColor: C.gold + '20', borderWidth: 1, borderColor: C.gold + '50',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  allInBtnText: { fontSize: 13, fontWeight: '900', color: C.gold, fontFamily: 'monospace' },

  // Raise presets
  raisePresets: {
    flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap',
  },
  raisePresetBtn: {
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
    backgroundColor: C.purple + '10', borderWidth: 1, borderColor: C.purple + '30',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  raisePresetText: { fontSize: 10, fontWeight: '800', color: C.purple, fontFamily: 'monospace' },
  raisePresetAmt: { fontSize: 9, fontWeight: '600', color: C.textDim, fontFamily: 'monospace', marginTop: 1 },

  // Deal next / leave
  dealNextBtn: {
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 8,
    backgroundColor: C.green + '20', borderWidth: 1, borderColor: C.green + '50',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  dealNextBtnText: { fontSize: 13, fontWeight: '900', color: C.green, fontFamily: 'monospace' },
  leaveBtn: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8,
    backgroundColor: '#1a1a2a', borderWidth: 1, borderColor: '#2a2a3a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  leaveBtnText: { fontSize: 13, fontWeight: '700', color: C.textDim, fontFamily: 'monospace' },

  // Waiting
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold },
  waitingText: { fontSize: 12, color: C.textDim, fontFamily: 'monospace', fontWeight: '600' },
});
