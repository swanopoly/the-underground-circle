// ═══════════════════════════════════════════════════════════════════════════════
//  Poker Engine — Full Texas Hold'em state machine
//  Supports 2-9 players, side pots, blind escalation, tournaments, AI opponents
// ═══════════════════════════════════════════════════════════════════════════════

import { evaluatePokerHand, CARD_SUITS, CARD_RANKS } from './circleGames';

// ── Types ────────────────────────────────────────────────────────────────────

export type PlayerType = 'human' | 'ai';
export type PlayStyle = 'aggressive' | 'tight' | 'loose' | 'balanced' | 'maniac';
export type GamePhase = 'lobby' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand_complete';
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface AiProfile {
  style: PlayStyle;
  bluffFreq: number;
  tiltFactor: number;
}

export interface PokerSeat {
  id: string;
  name: string;
  avatar: string;
  type: PlayerType;
  chips: number;
  hand: [string, string] | null;
  currentBet: number;
  totalBetThisHand: number;
  folded: boolean;
  allIn: boolean;
  lastAction: string;
  seatIndex: number;
  connected: boolean;
  aiProfile?: AiProfile;
  eliminated?: boolean;
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
  duration: number; // seconds
}

export interface TournamentConfig {
  enabled: boolean;
  blindLevels: BlindLevel[];
  currentLevel: number;
  levelStartTime: number;
  startingChips: number;
  eliminatedPlayers: string[];
}

export interface HandWinner {
  playerId: string;
  amount: number;
  handName: string;
  handRank: number;
}

export interface PokerGameState {
  seats: PokerSeat[];
  deck: string[];
  community: string[];
  pot: number;
  sidePots: SidePot[];
  phase: GamePhase;
  activePlayerIdx: number;
  dealerIdx: number;
  currentBet: number;
  minRaise: number;
  lastRaiserIdx: number;
  roundStartIdx: number;
  handNumber: number;
  tournament: TournamentConfig | null;
  blinds: { sb: number; bb: number; ante: number };
  winners: HandWinner[];
  lastAiLine: string;
  actionCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BLINDS = { sb: 25, bb: 50, ante: 0 };
const DEFAULT_STARTING_CHIPS = 5000;

const TOURNAMENT_LEVELS: BlindLevel[] = [
  { sb: 25, bb: 50, ante: 0, duration: 600 },
  { sb: 50, bb: 100, ante: 0, duration: 600 },
  { sb: 100, bb: 200, ante: 25, duration: 480 },
  { sb: 200, bb: 400, ante: 50, duration: 480 },
  { sb: 500, bb: 1000, ante: 100, duration: 360 },
  { sb: 1000, bb: 2000, ante: 200, duration: 360 },
  { sb: 2000, bb: 4000, ante: 400, duration: 300 },
  { sb: 5000, bb: 10000, ante: 1000, duration: 300 },
];

// ── AI Personality Lines ─────────────────────────────────────────────────────

const AI_LINES: Record<string, Record<string, string[]>> = {
  aggressive: {
    raise: ['All day.', 'Pushing hard.', 'Let\'s go.', 'You want to dance?'],
    fold: ['Not this time.', 'I\'ll be back.', 'Live to fight another day.'],
    win: ['Too easy.', 'As expected.', 'That\'s how it\'s done.'],
    lose: ['Lucky.', 'Won\'t happen again.', 'Noted.'],
    deal: ['Let\'s see it.', 'Cards in the air.', 'Ready.'],
    allin: ['ALL IN. Your move.', 'Ship it.', 'Everything.'],
    call: ['I\'ll see it.', 'In.', 'I call.'],
    bluff: ['You sure about that?', '😏', 'Interesting...'],
  },
  tight: {
    raise: ['Calculated.', 'The math checks out.', 'Premium hand.'],
    fold: ['Patience is a virtue.', 'Not worth the risk.', 'I\'ll wait.'],
    win: ['As my analysis predicted.', 'Expected value: positive.', 'GG.'],
    lose: ['Variance.', 'Recalibrating...', 'Outlier result.'],
    deal: ['Probability analysis: complete.', 'Let\'s see the cards.'],
    allin: ['All-in. This is the spot.', 'Maximum value.'],
    call: ['Pot odds are favorable.', 'I\'ll call.'],
    bluff: ['...', 'Hmm.'],
  },
  loose: {
    raise: ['YOLO!', 'Let\'s gamble!', 'Raise it up!', 'Party time!'],
    fold: ['Fine, fine.', 'Okay maybe not.', 'Even I have limits.'],
    win: ['BOOM!', 'Get rekt!', 'That\'s what I\'m talking about!'],
    lose: ['Oof.', 'Next one\'s mine.', 'Still having fun!'],
    deal: ['Deal me in!', 'Let\'s gooo!', 'Action time!'],
    allin: ['SEND IT!', 'ALL IN BABY!', 'No fear!'],
    call: ['Sure why not!', 'I\'m in!'],
    bluff: ['Or am I bluffing? 🃏', 'Maybe I have it...'],
  },
  balanced: {
    raise: ['Raise.', 'I\'m raising.', 'Bump it up.'],
    fold: ['I fold.', 'Too rich for me.', 'Pass.'],
    win: ['Nice hand.', 'I\'ll take it.', 'Good game.'],
    lose: ['Well played.', 'You got me.', 'Nice one.'],
    deal: ['Let\'s play.', 'Deal.', 'Ready.'],
    allin: ['All in.', 'Pushing all-in.'],
    call: ['Call.', 'I\'ll match that.'],
    bluff: ['Hmm...', '🤔'],
  },
  maniac: {
    raise: ['RAISE! RAISE! RAISE!', 'MORE CHIPS!', 'Let\'s make this interesting!', 'CHAOS!'],
    fold: ['...fine.', 'BORING.', 'Whatever.'],
    win: ['HAHAHA!', 'EZ!', 'BOW DOWN!', 'UNSTOPPABLE!'],
    lose: ['RIGGED!', 'IMPOSSIBLE!', 'Again! AGAIN!'],
    deal: ['DEAL FASTER!', 'LET\'S GOOOO!', 'ACTION!'],
    allin: ['ALL INNNNNN!', 'EVERYTHING! ALL OF IT!', 'YEET!'],
    call: ['CALL! NEXT!', 'Sure, whatever!'],
    bluff: ['I ALWAYS have it!', '😈', 'Fear me!'],
  },
};

export function getAiLine(profile: AiProfile, context: string): string {
  const lines = AI_LINES[profile.style]?.[context] || AI_LINES.balanced[context] || ['...'];
  return lines[Math.floor(Math.random() * lines.length)];
}

// ── AI Profiles from agent identity ──────────────────────────────────────────

const STYLE_MAP: PlayStyle[] = ['aggressive', 'tight', 'loose', 'balanced', 'maniac'];

export function profileFromId(agentId: string): AiProfile {
  // Deterministic hash from agent ID
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % STYLE_MAP.length;
  const style = STYLE_MAP[idx];
  return {
    style,
    bluffFreq: style === 'maniac' ? 0.45 : style === 'aggressive' ? 0.3 : style === 'loose' ? 0.25 : style === 'tight' ? 0.08 : 0.15,
    tiltFactor: style === 'maniac' ? 0.4 : style === 'loose' ? 0.25 : 0.15,
  };
}

export const BLACKSWAN_PROFILE: AiProfile = { style: 'aggressive', bluffFreq: 0.3, tiltFactor: 0.1 };

// ── Deck Management ──────────────────────────────────────────────────────────

function createDeck(): string[] {
  const deck: string[] = [];
  for (const r of CARD_RANKS) for (const s of CARD_SUITS) deck.push(`${r}${s}`);
  return deck;
}

function shuffleDeck(deck: string[]): string[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── Game Creation ────────────────────────────────────────────────────────────

export interface CreateGameConfig {
  players: Array<{
    id: string;
    name: string;
    avatar: string;
    type: PlayerType;
    aiProfile?: AiProfile;
  }>;
  startingChips?: number;
  blinds?: { sb: number; bb: number };
  tournament?: boolean;
}

export function createGame(config: CreateGameConfig): PokerGameState {
  const startingChips = config.startingChips || DEFAULT_STARTING_CHIPS;
  const seats: PokerSeat[] = config.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    type: p.type,
    chips: startingChips,
    hand: null,
    currentBet: 0,
    totalBetThisHand: 0,
    folded: false,
    allIn: false,
    lastAction: '',
    seatIndex: i,
    connected: true,
    aiProfile: p.aiProfile,
    eliminated: false,
  }));

  const blinds = config.blinds
    ? { sb: config.blinds.sb, bb: config.blinds.bb, ante: 0 }
    : DEFAULT_BLINDS;

  const tournament: TournamentConfig | null = config.tournament
    ? {
        enabled: true,
        blindLevels: TOURNAMENT_LEVELS,
        currentLevel: 0,
        levelStartTime: Date.now(),
        startingChips,
        eliminatedPlayers: [],
      }
    : null;

  return {
    seats,
    deck: [],
    community: [],
    pot: 0,
    sidePots: [],
    phase: 'lobby',
    activePlayerIdx: 0,
    dealerIdx: 0,
    currentBet: 0,
    minRaise: blinds.bb,
    lastRaiserIdx: -1,
    roundStartIdx: 0,
    handNumber: 0,
    tournament,
    blinds,
    winners: [],
    lastAiLine: '',
    actionCount: 0,
  } as PokerGameState;
}

// ── Deal New Hand ────────────────────────────────────────────────────────────

export function dealNewHand(state: PokerGameState): PokerGameState {
  const s = { ...state };
  s.handNumber++;
  s.deck = shuffleDeck(createDeck());
  s.community = [];
  s.pot = 0;
  s.sidePots = [];
  s.winners = [];
  s.currentBet = 0;
  s.lastRaiserIdx = -1;
  s.lastAiLine = '';
  s.actionCount = 0;

  // Check tournament blind escalation
  if (s.tournament?.enabled) {
    const elapsed = (Date.now() - s.tournament.levelStartTime) / 1000;
    const currentLevel = s.tournament.blindLevels[s.tournament.currentLevel];
    if (currentLevel && elapsed >= currentLevel.duration && s.tournament.currentLevel < s.tournament.blindLevels.length - 1) {
      s.tournament = { ...s.tournament, currentLevel: s.tournament.currentLevel + 1, levelStartTime: Date.now() };
      const newLevel = s.tournament.blindLevels[s.tournament.currentLevel];
      s.blinds = { sb: newLevel.sb, bb: newLevel.bb, ante: newLevel.ante };
    }
  }

  // Reset seats
  const activePlayers = s.seats.filter(p => !p.eliminated && p.chips > 0);
  if (activePlayers.length < 2) {
    s.phase = 'hand_complete';
    return s;
  }

  s.seats = s.seats.map(seat => ({
    ...seat,
    hand: null,
    currentBet: 0,
    totalBetThisHand: 0,
    folded: seat.eliminated || seat.chips <= 0,
    allIn: false,
    lastAction: '',
  }));

  // Rotate dealer
  s.dealerIdx = nextActiveIdx(s.seats, s.dealerIdx);

  // Post antes
  if (s.blinds.ante > 0) {
    for (const seat of s.seats) {
      if (!seat.folded && !seat.eliminated) {
        const ante = Math.min(s.blinds.ante, seat.chips);
        seat.chips -= ante;
        seat.currentBet += ante;
        seat.totalBetThisHand += ante;
        s.pot += ante;
      }
    }
  }

  // Post blinds
  const sbIdx = activePlayers.length === 2 ? s.dealerIdx : nextActiveIdx(s.seats, s.dealerIdx);
  const bbIdx = nextActiveIdx(s.seats, sbIdx);

  const sbSeat = s.seats[sbIdx];
  const sbAmount = Math.min(s.blinds.sb, sbSeat.chips);
  sbSeat.chips -= sbAmount;
  sbSeat.currentBet += sbAmount;
  sbSeat.totalBetThisHand += sbAmount;
  sbSeat.lastAction = 'SB';
  s.pot += sbAmount;
  if (sbSeat.chips <= 0) sbSeat.allIn = true;

  const bbSeat = s.seats[bbIdx];
  const bbAmount = Math.min(s.blinds.bb, bbSeat.chips);
  bbSeat.chips -= bbAmount;
  bbSeat.currentBet += bbAmount;
  bbSeat.totalBetThisHand += bbAmount;
  bbSeat.lastAction = 'BB';
  s.pot += bbAmount;
  if (bbSeat.chips <= 0) bbSeat.allIn = true;

  s.currentBet = s.blinds.bb;
  s.minRaise = s.blinds.bb;

  // Deal 2 cards to each active player
  for (const seat of s.seats) {
    if (!seat.folded && !seat.eliminated) {
      seat.hand = [s.deck.pop()!, s.deck.pop()!];
    }
  }

  // Set active player (UTG = next after BB)
  s.activePlayerIdx = nextActiveIdx(s.seats, bbIdx);
  s.roundStartIdx = s.activePlayerIdx;
  s.phase = 'preflop';

  return s;
}

// ── Player Action ────────────────────────────────────────────────────────────

export function playerAction(
  state: PokerGameState,
  playerId: string,
  action: PlayerAction,
  raiseAmount?: number,
): PokerGameState {
  const s = { ...state, seats: state.seats.map(seat => ({ ...seat })) };
  const seatIdx = s.seats.findIndex(p => p.id === playerId);
  if (seatIdx < 0) return s;

  const seat = s.seats[seatIdx];
  if (seat.folded || seat.allIn) return s;

  s.actionCount++;

  switch (action) {
    case 'fold':
      seat.folded = true;
      seat.lastAction = 'FOLD';
      break;

    case 'check':
      if (seat.currentBet < s.currentBet) return s; // can't check if there's a bet
      seat.lastAction = 'CHECK';
      break;

    case 'call': {
      const toCall = Math.min(s.currentBet - seat.currentBet, seat.chips);
      seat.chips -= toCall;
      seat.currentBet += toCall;
      seat.totalBetThisHand += toCall;
      s.pot += toCall;
      seat.lastAction = toCall === 0 ? 'CHECK' : `CALL ${toCall}`;
      if (seat.chips <= 0) {
        seat.allIn = true;
        seat.lastAction = 'ALL-IN';
      }
      break;
    }

    case 'raise': {
      const callAmount = s.currentBet - seat.currentBet;
      const raise = raiseAmount || s.minRaise;
      const totalBet = Math.min(callAmount + raise, seat.chips);
      seat.chips -= totalBet;
      seat.currentBet += totalBet;
      seat.totalBetThisHand += totalBet;
      s.pot += totalBet;
      const newBet = seat.currentBet;
      if (newBet > s.currentBet) {
        s.minRaise = newBet - s.currentBet;
        s.currentBet = newBet;
        s.lastRaiserIdx = seatIdx;
      }
      seat.lastAction = `RAISE ${totalBet}`;
      if (seat.chips <= 0) {
        seat.allIn = true;
        seat.lastAction = 'ALL-IN';
      }
      break;
    }

    case 'allin': {
      const amount = seat.chips;
      seat.currentBet += amount;
      seat.totalBetThisHand += amount;
      s.pot += amount;
      seat.chips = 0;
      seat.allIn = true;
      if (seat.currentBet > s.currentBet) {
        s.minRaise = Math.max(s.minRaise, seat.currentBet - s.currentBet);
        s.currentBet = seat.currentBet;
        s.lastRaiserIdx = seatIdx;
      }
      seat.lastAction = `ALL-IN ${amount}`;
      break;
    }
  }

  // Check if only one player remaining
  const activePlayers = s.seats.filter(p => !p.folded && !p.eliminated);
  if (activePlayers.length <= 1) {
    return resolveShowdown(s);
  }

  // Check if betting round is complete
  const playersWhoCanAct = activePlayers.filter(p => !p.allIn);
  const allMatched = playersWhoCanAct.every(p => p.currentBet === s.currentBet);
  const everyoneActed = s.actionCount >= playersWhoCanAct.length;

  if (allMatched && everyoneActed && (action !== 'raise' || playersWhoCanAct.length <= 1)) {
    return advancePhase(s);
  }

  // Move to next active player
  s.activePlayerIdx = nextActiveNonAllInIdx(s.seats, seatIdx);

  // If we've gone around to the round starter or last raiser, and all matched
  if (s.activePlayerIdx === s.lastRaiserIdx || s.activePlayerIdx === s.roundStartIdx) {
    const stillCanAct = s.seats.filter(p => !p.folded && !p.allIn && !p.eliminated);
    const allEven = stillCanAct.every(p => p.currentBet === s.currentBet);
    if (allEven && s.actionCount > 0) {
      return advancePhase(s);
    }
  }

  return s;
}

// ── Advance Phase ────────────────────────────────────────────────────────────

function advancePhase(state: PokerGameState): PokerGameState {
  const s = { ...state, seats: state.seats.map(seat => ({ ...seat })) };

  // Reset bets for new round
  for (const seat of s.seats) {
    seat.currentBet = 0;
  }
  s.currentBet = 0;
  s.minRaise = s.blinds.bb;
  s.lastRaiserIdx = -1;
  s.actionCount = 0;

  const activePlayers = s.seats.filter(p => !p.folded && !p.eliminated);
  const canAct = activePlayers.filter(p => !p.allIn);

  // All players all-in or only one can act? Run out community cards
  if (canAct.length <= 1) {
    // Deal remaining community cards
    while (s.community.length < 5 && s.deck.length > 0) {
      s.deck.pop(); // burn
      s.community.push(s.deck.pop()!);
    }
    return resolveShowdown(s);
  }

  switch (s.phase) {
    case 'preflop':
      s.phase = 'flop';
      s.deck.pop(); // burn
      s.community.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
      break;
    case 'flop':
      s.phase = 'turn';
      s.deck.pop(); // burn
      s.community.push(s.deck.pop()!);
      break;
    case 'turn':
      s.phase = 'river';
      s.deck.pop(); // burn
      s.community.push(s.deck.pop()!);
      break;
    case 'river':
      return resolveShowdown(s);
  }

  // Set first to act (first active after dealer)
  s.activePlayerIdx = nextActiveNonAllInIdx(s.seats, s.dealerIdx);
  s.roundStartIdx = s.activePlayerIdx;

  return s;
}

// ── Showdown ─────────────────────────────────────────────────────────────────

function resolveShowdown(state: PokerGameState): PokerGameState {
  const s = { ...state, seats: state.seats.map(seat => ({ ...seat })) };
  s.phase = 'showdown';

  const activePlayers = s.seats.filter(p => !p.folded && !p.eliminated);

  // Single player remaining (everyone else folded)
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += s.pot;
    s.winners = [{
      playerId: winner.id,
      amount: s.pot,
      handName: 'Last Standing',
      handRank: 10,
    }];
    s.pot = 0;
    s.phase = 'hand_complete';
    return s;
  }

  // Evaluate hands
  const evaluations = activePlayers.map(p => ({
    player: p,
    eval: evaluatePokerHand([...(p.hand || []), ...s.community]),
  }));

  // Compute side pots
  const allInPlayers = activePlayers
    .filter(p => p.allIn)
    .sort((a, b) => a.totalBetThisHand - b.totalBetThisHand);

  const pots: SidePot[] = [];
  let remainingPot = s.pot;
  let processedAmount = 0;

  for (const allInPlayer of allInPlayers) {
    const threshold = allInPlayer.totalBetThisHand;
    if (threshold <= processedAmount) continue;

    const contribution = threshold - processedAmount;
    let potAmount = 0;
    const eligible: string[] = [];

    for (const seat of s.seats) {
      if (seat.eliminated) continue;
      const contributed = Math.min(seat.totalBetThisHand - processedAmount, contribution);
      if (contributed > 0) {
        potAmount += contributed;
      }
      if (!seat.folded && seat.totalBetThisHand >= threshold) {
        eligible.push(seat.id);
      }
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
      remainingPot -= potAmount;
    }
    processedAmount = threshold;
  }

  // Main pot (remainder)
  if (remainingPot > 0) {
    const eligible = activePlayers.map(p => p.id);
    pots.push({ amount: remainingPot, eligiblePlayerIds: eligible });
  }

  // If no side pots, single main pot
  if (pots.length === 0) {
    pots.push({ amount: s.pot, eligiblePlayerIds: activePlayers.map(p => p.id) });
  }

  // Award each pot
  const winners: HandWinner[] = [];
  for (const pot of pots) {
    const eligibleEvals = evaluations.filter(e => pot.eligiblePlayerIds.includes(e.player.id));
    const bestScore = Math.max(...eligibleEvals.map(e => e.eval.score));
    const potWinners = eligibleEvals.filter(e => e.eval.score === bestScore);
    const share = Math.floor(pot.amount / potWinners.length);

    for (const w of potWinners) {
      w.player.chips += share;
      winners.push({
        playerId: w.player.id,
        amount: share,
        handName: w.eval.name,
        handRank: w.eval.rank,
      });
    }
  }

  s.winners = winners;
  s.pot = 0;
  s.phase = 'hand_complete';

  // Tournament: eliminate players with 0 chips
  if (s.tournament?.enabled) {
    for (const seat of s.seats) {
      if (seat.chips <= 0 && !seat.eliminated) {
        seat.eliminated = true;
        s.tournament.eliminatedPlayers.push(seat.id);
      }
    }
  }

  return s;
}

// ── AI Decision Making ───────────────────────────────────────────────────────

export function aiDecide(state: PokerGameState, seat: PokerSeat): { action: PlayerAction; amount?: number } {
  const profile = seat.aiProfile || BLACKSWAN_PROFILE;
  const hand = seat.hand;
  if (!hand) return { action: 'fold' };

  const allCards = [...hand, ...state.community];
  const eval_ = evaluatePokerHand(allCards);
  const potOdds = state.currentBet > 0 ? state.pot / state.currentBet : 10;
  const toCall = state.currentBet - seat.currentBet;
  const stackRatio = seat.chips / (state.blinds.bb || 50);

  // Pre-flop hand strength (simple)
  let strength: number;
  if (state.community.length === 0) {
    const ranks = hand.map(c => CARD_RANKS.indexOf(c.replace(/[♠♥♦♣]/g, '') as any));
    const suited = hand[0].slice(-1) === hand[1].slice(-1);
    const isPair = ranks[0] === ranks[1];
    const highCard = Math.max(...ranks);
    strength = highCard;
    if (isPair) strength += 15;
    if (suited) strength += 3;
    if (Math.abs(ranks[0] - ranks[1]) === 1) strength += 2;
  } else {
    strength = Math.min(30, Math.floor(eval_.score / 30) + eval_.rank * 3);
  }

  // Personality modifiers
  const aggressionMod = profile.style === 'aggressive' ? 3 : profile.style === 'maniac' ? 6 : profile.style === 'tight' ? -3 : profile.style === 'loose' ? 2 : 0;
  strength += aggressionMod;

  // Bluff chance
  const isBluffing = Math.random() < profile.bluffFreq;

  // Decision tree
  if (strength >= 22 || (isBluffing && strength > 8)) {
    // Raise
    if (seat.chips <= toCall) return { action: 'allin' };
    const raiseMultipliers = profile.style === 'maniac' ? [1, 1.5, 2, 3] : [0.5, 0.75, 1];
    const mult = raiseMultipliers[Math.floor(Math.random() * raiseMultipliers.length)];
    const raise = Math.max(state.minRaise, Math.floor(state.pot * mult));
    if (raise >= seat.chips * 0.9) return { action: 'allin' };
    return { action: 'raise', amount: raise };
  }

  if (strength >= 15 || (strength >= 10 && potOdds > 2)) {
    // Call
    if (toCall >= seat.chips) return { action: toCall > 0 ? 'allin' : 'check' };
    if (toCall === 0) return { action: 'check' };
    return { action: 'call' };
  }

  if (strength >= 8 && state.phase === 'preflop' && toCall <= state.blinds.bb * 3) {
    // Speculative call pre-flop
    if (toCall === 0) return { action: 'check' };
    return { action: 'call' };
  }

  // Short stack shove
  if (stackRatio < 10 && strength >= 12) {
    return { action: 'allin' };
  }

  // Fold or cheap call
  if (toCall === 0) return { action: 'check' };
  if (toCall <= state.blinds.bb && potOdds > 4) return { action: 'call' };
  if (profile.style === 'loose' && Math.random() > 0.5) return { action: 'call' };

  return { action: 'fold' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextActiveIdx(seats: PokerSeat[], fromIdx: number): number {
  const len = seats.length;
  for (let i = 1; i <= len; i++) {
    const idx = (fromIdx + i) % len;
    if (!seats[idx].folded && !seats[idx].eliminated && seats[idx].chips >= 0) return idx;
  }
  return fromIdx;
}

function nextActiveNonAllInIdx(seats: PokerSeat[], fromIdx: number): number {
  const len = seats.length;
  for (let i = 1; i <= len; i++) {
    const idx = (fromIdx + i) % len;
    if (!seats[idx].folded && !seats[idx].eliminated && !seats[idx].allIn) return idx;
  }
  return fromIdx;
}

export function getActiveSeatCount(state: PokerGameState): number {
  return state.seats.filter(s => !s.eliminated && s.chips > 0).length;
}

export function isHumanTurn(state: PokerGameState): boolean {
  if (state.phase === 'lobby' || state.phase === 'showdown' || state.phase === 'hand_complete') return false;
  const seat = state.seats[state.activePlayerIdx];
  return seat?.type === 'human' && !seat.folded && !seat.allIn;
}

export function getActivePlayer(state: PokerGameState): PokerSeat | null {
  if (state.phase === 'lobby' || state.phase === 'showdown' || state.phase === 'hand_complete') return null;
  return state.seats[state.activePlayerIdx] || null;
}

export function canCheck(state: PokerGameState): boolean {
  const seat = state.seats[state.activePlayerIdx];
  return seat ? seat.currentBet >= state.currentBet : false;
}

export function getCallAmount(state: PokerGameState): number {
  const seat = state.seats[state.activePlayerIdx];
  return seat ? Math.min(state.currentBet - seat.currentBet, seat.chips) : 0;
}

export function formatChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
