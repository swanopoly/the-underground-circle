// ═══════════════════════════════════════════════════════════════════════════════
//  Circle Games — Poker, Betting, Crypto Wagers, BlackSwan AI Player
// ═══════════════════════════════════════════════════════════════════════════════

// ── Crypto Types ─────────────────────────────────────────────────────────────

export type CryptoType = 'SOL' | 'ETH' | 'BTC' | 'USDC' | 'MATIC';

export interface CryptoWager {
  crypto: CryptoType;
  amount: number;
}

export const CRYPTO_INFO: Record<CryptoType, { symbol: string; color: string; icon: string }> = {
  SOL:  { symbol: '◎', color: '#14F195', icon: '◎' },
  ETH:  { symbol: 'Ξ', color: '#627EEA', icon: 'Ξ' },
  BTC:  { symbol: '₿', color: '#F7931A', icon: '₿' },
  USDC: { symbol: '$', color: '#2775CA', icon: '$' },
  MATIC:{ symbol: '⬡', color: '#8247E5', icon: '⬡' },
};

export const CRYPTO_TYPES: CryptoType[] = ['SOL', 'ETH', 'BTC', 'USDC', 'MATIC'];

// ── Poker ────────────────────────────────────────────────────────────────────

export const STARTING_CHIPS = 2000;

export const CARD_SUITS = ['♠', '♥', '♦', '♣'] as const;
export const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type PokerPhase = 'waiting' | 'deal' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PokerPlayer {
  id: string;
  name: string;
  chips: number;
  hand: string;       // e.g. "A♠ K♥"
  folded: boolean;
  isAI: boolean;       // BlackSwan AI player
  isCurrentUser: boolean;
  avatar?: string;
}

/** Deal a random 2-card hand */
export function dealHand(): string {
  const deck: string[] = [];
  for (const r of CARD_RANKS) for (const s of CARD_SUITS) deck.push(`${r}${s}`);
  // Fisher-Yates pick 2
  const i1 = Math.floor(Math.random() * deck.length);
  const card1 = deck[i1];
  deck.splice(i1, 1);
  const i2 = Math.floor(Math.random() * deck.length);
  const card2 = deck[i2];
  return `${card1} ${card2}`;
}

/** Deal community cards for a phase */
export function dealCommunity(count: number): string[] {
  const cards: string[] = [];
  const used = new Set<string>();
  while (cards.length < count) {
    const r = CARD_RANKS[Math.floor(Math.random() * CARD_RANKS.length)];
    const s = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
    const card = `${r}${s}`;
    if (!used.has(card)) { cards.push(card); used.add(card); }
  }
  return cards;
}

/** Simple hand strength score (higher = better) — for AI decision making */
export function handStrength(hand: string): number {
  const cards = hand.split(' ');
  if (cards.length < 2) return 0;
  const ranks = cards.map(c => {
    const r = c.replace(/[♠♥♦♣]/g, '');
    const idx = CARD_RANKS.indexOf(r as any);
    return idx >= 0 ? idx : 0;
  });
  const suited = cards.length >= 2 && cards[0].slice(-1) === cards[1].slice(-1);
  const highCard = Math.max(...ranks);
  const isPair = ranks.length >= 2 && ranks[0] === ranks[1];
  let score = highCard;
  if (isPair) score += 15;
  if (suited) score += 3;
  if (Math.abs(ranks[0] - ranks[1]) === 1) score += 2; // connected
  return score;
}

/** Parse a card string like "A♠" into rank index (0-12) and suit index (0-3) */
function parseCard(card: string): { rank: number; suit: number } {
  const r = card.replace(/[♠♥♦♣]/g, '');
  const s = card.slice(-1);
  return { rank: CARD_RANKS.indexOf(r as any), suit: CARD_SUITS.indexOf(s as any) };
}

/** Evaluate the best 5-card poker hand from up to 7 cards, returns { rank, name, score } */
export function evaluatePokerHand(cards: string[]): { rank: number; name: string; score: number } {
  if (cards.length < 2) return { rank: 0, name: 'High Card', score: 0 };
  const parsed = cards.map(parseCard).filter(c => c.rank >= 0);
  if (parsed.length < 2) return { rank: 0, name: 'High Card', score: 0 };

  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<number, number[]>();
  for (const { rank, suit } of parsed) {
    rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
    if (!suitCounts.has(suit)) suitCounts.set(suit, []);
    suitCounts.get(suit)!.push(rank);
  }

  // Check flush (5+ of same suit)
  let flushSuit: number | null = null;
  let flushRanks: number[] = [];
  for (const [suit, ranks] of suitCounts) {
    if (ranks.length >= 5) { flushSuit = suit; flushRanks = ranks.sort((a, b) => b - a); break; }
  }

  // Check straight (5 consecutive ranks)
  const uniqueRanks = [...new Set(parsed.map(c => c.rank))].sort((a, b) => b - a);
  let straightHigh = -1;
  for (let i = 0; i <= uniqueRanks.length - 5; i++) {
    if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) { straightHigh = uniqueRanks[i]; break; }
  }
  // Ace-low straight (A-2-3-4-5)
  if (straightHigh < 0 && uniqueRanks.includes(12) && uniqueRanks.includes(0) && uniqueRanks.includes(1) && uniqueRanks.includes(2) && uniqueRanks.includes(3)) {
    straightHigh = 3;
  }

  // Straight flush check
  if (flushSuit !== null && flushRanks.length >= 5) {
    const fr = [...new Set(flushRanks)].sort((a, b) => b - a);
    for (let i = 0; i <= fr.length - 5; i++) {
      if (fr[i] - fr[i + 4] === 4) {
        if (fr[i] === 12) return { rank: 9, name: 'Royal Flush', score: 900 + fr[i] };
        return { rank: 8, name: 'Straight Flush', score: 800 + fr[i] };
      }
    }
    // Ace-low straight flush
    if (fr.includes(12) && fr.includes(0) && fr.includes(1) && fr.includes(2) && fr.includes(3)) {
      return { rank: 8, name: 'Straight Flush', score: 803 };
    }
  }

  // Count groups
  const groups = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const g = groups.map(([r, c]) => ({ rank: r, count: c }));

  if (g[0].count === 4) {
    return { rank: 7, name: 'Four of a Kind', score: 700 + g[0].rank };
  }
  if (g[0].count === 3 && g.length >= 2 && g[1].count >= 2) {
    return { rank: 6, name: 'Full House', score: 600 + g[0].rank * 13 + g[1].rank };
  }
  if (flushSuit !== null) {
    return { rank: 5, name: 'Flush', score: 500 + flushRanks[0] };
  }
  if (straightHigh >= 0) {
    return { rank: 4, name: 'Straight', score: 400 + straightHigh };
  }
  if (g[0].count === 3) {
    return { rank: 3, name: 'Three of a Kind', score: 300 + g[0].rank };
  }
  if (g[0].count === 2 && g.length >= 2 && g[1].count === 2) {
    const high = Math.max(g[0].rank, g[1].rank);
    const low = Math.min(g[0].rank, g[1].rank);
    return { rank: 2, name: 'Two Pair', score: 200 + high * 13 + low };
  }
  if (g[0].count === 2) {
    const rankName = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'][g[0].rank] || '';
    return { rank: 1, name: `Pair of ${rankName}s`, score: 100 + g[0].rank };
  }
  return { rank: 0, name: 'High Card', score: uniqueRanks[0] };
}

// ── BlackSwan AI Player ──────────────────────────────────────────────────────

export const BLACKSWAN_PLAYER: Omit<PokerPlayer, 'chips' | 'hand' | 'folded'> = {
  id: 'blackswan_ai',
  name: 'BlackSwan',
  isAI: true,
  isCurrentUser: false,
  avatar: '🦢',
};

/** BlackSwan makes a poker decision based on hand strength and pot odds */
export function blackswanDecide(
  hand: string,
  communityCards: string[],
  pot: number,
  currentBet: number,
  chips: number,
  phase: PokerPhase,
): 'fold' | 'call' | 'raise' {
  // Pre-flop: use simple hand strength. Post-flop: evaluate with community cards
  let strength: number;
  if (communityCards.length === 0) {
    strength = handStrength(hand);
  } else {
    const allCards = [...hand.split(' ').filter(Boolean), ...communityCards];
    const eval_ = evaluatePokerHand(allCards);
    // Map evaluation score to a 0-30 range for decision thresholds
    strength = Math.min(30, Math.floor(eval_.score / 30) + eval_.rank * 3);
  }
  const potOdds = currentBet > 0 ? pot / currentBet : 10;

  // BlackSwan plays aggressively with strong hands, cautious otherwise
  if (strength >= 20) return 'raise';         // Premium hand — always raise
  if (strength >= 15 && potOdds > 2) return 'raise'; // Strong hand, good pot odds
  if (strength >= 10) return 'call';           // Decent hand — call
  if (strength >= 5 && phase === 'deal') return 'call'; // Speculative pre-flop
  if (currentBet > chips * 0.3) return 'fold'; // Too expensive
  if (potOdds > 4) return 'call';              // Cheap to stay in
  return Math.random() > 0.6 ? 'call' : 'fold'; // Marginal — sometimes bluff
}

/** BlackSwan raise amount */
export function blackswanRaise(pot: number, chips: number): number {
  const raises = [
    Math.floor(pot * 0.5),    // Half pot
    Math.floor(pot * 0.75),   // 3/4 pot
    Math.floor(pot),           // Full pot
  ];
  const amount = raises[Math.floor(Math.random() * raises.length)];
  return Math.min(amount, chips);
}

/** BlackSwan trash talk lines */
export const BLACKSWAN_LINES: Record<string, string[]> = {
  deal: [
    'Let\'s see what you\'ve got...',
    'Probability analysis: complete.',
    'I\'ve computed all 2.6M possible hands.',
  ],
  raise: [
    'I see your bet and raise. Your move.',
    'My neural nets say: push.',
    'Calculated risk. I\'m in.',
  ],
  fold: [
    'Strategic retreat. For now.',
    'I\'ll wait for better cards.',
    'Folding. But I\'m watching.',
  ],
  win: [
    'As my models predicted.',
    'GG. Better luck next hand.',
    'The house always wins. I am the house.',
  ],
  lose: [
    'Variance happens. Recalibrating...',
    'Well played. I\'ll adapt.',
    'Interesting. My loss function is updating.',
  ],
};

export function getBlackswanLine(context: string): string {
  const lines = BLACKSWAN_LINES[context] || BLACKSWAN_LINES.deal;
  return lines[Math.floor(Math.random() * lines.length)];
}

// ── Coin Flip ────────────────────────────────────────────────────────────────

export function flipCoin(): 'heads' | 'tails' {
  return Math.random() > 0.5 ? 'heads' : 'tails';
}

// ── Roulette ─────────────────────────────────────────────────────────────────

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export type RouletteBet = 'red' | 'black' | 'odd' | 'even' | 'green' | 'high' | 'low';

export function spinRoulette(): number {
  return Math.floor(Math.random() * 37); // 0-36
}

export function checkRouletteBet(bet: RouletteBet, number: number): boolean {
  if (number === 0) return bet === 'green';
  switch (bet) {
    case 'red': return RED_NUMBERS.includes(number);
    case 'black': return !RED_NUMBERS.includes(number);
    case 'odd': return number % 2 === 1;
    case 'even': return number % 2 === 0;
    case 'high': return number >= 19;
    case 'low': return number >= 1 && number <= 18;
    default: return false;
  }
}

/** Roulette payout multiplier */
export function roulettePayout(bet: RouletteBet): number {
  if (bet === 'green') return 35;
  return 2; // red/black/odd/even/high/low all pay 2x
}

// ── Chess Engine ────────────────────────────────────────────────────────────

// Board is a 64-char string. Index 0 = a8, index 7 = h8, index 56 = a1, index 63 = h1.
// Uppercase = white, lowercase = black, '.' = empty
// R N B Q K B N R  (black back rank, indices 0-7)
// P P P P P P P P  (black pawns, indices 8-15)
// . . . . . . . .  (empty, indices 16-23)
// ...
// p p p p p p p p  (white pawns, indices 48-55)
// r n b q k b n r  (white back rank, indices 56-63)

export const CHESS_INITIAL_BOARD =
  'rnbqkbnr' +
  'pppppppp' +
  '........' +
  '........' +
  '........' +
  '........' +
  'PPPPPPPP' +
  'RNBQKBNR';

export const PIECE_TO_UNICODE: Record<string, string> = {
  'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
  'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟',
};

export function isWhitePiece(ch: string): boolean { return ch >= 'A' && ch <= 'Z'; }
export function isBlackPiece(ch: string): boolean { return ch >= 'a' && ch <= 'z'; }

function idxToRowCol(idx: number): [number, number] { return [Math.floor(idx / 8), idx % 8]; }
function rowColToIdx(r: number, c: number): number { return r * 8 + c; }
function inBounds(r: number, c: number): boolean { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function isOwnPiece(ch: string, white: boolean): boolean {
  return white ? isWhitePiece(ch) : isBlackPiece(ch);
}
function isEnemyPiece(ch: string, white: boolean): boolean {
  return white ? isBlackPiece(ch) : isWhitePiece(ch);
}

export function applyChessMove(board: string, from: number, to: number): string {
  const arr = board.split('');
  const piece = arr[from];
  arr[to] = piece;
  arr[from] = '.';
  // Auto-promote pawns
  if (piece === 'P' && to < 8) arr[to] = 'Q';
  if (piece === 'p' && to >= 56) arr[to] = 'q';
  return arr.join('');
}

function findKing(board: string, white: boolean): number {
  const king = white ? 'K' : 'k';
  return board.indexOf(king);
}

/** Generate pseudo-legal moves for a piece (ignoring check) */
function pseudoMoves(board: string, idx: number): number[] {
  const piece = board[idx];
  if (piece === '.') return [];
  const white = isWhitePiece(piece);
  const [r, c] = idxToRowCol(idx);
  const moves: number[] = [];
  const type = piece.toUpperCase();

  const addIfValid = (tr: number, tc: number) => {
    if (!inBounds(tr, tc)) return false;
    const target = board[rowColToIdx(tr, tc)];
    if (isOwnPiece(target, white)) return false;
    moves.push(rowColToIdx(tr, tc));
    return target === '.'; // continue sliding if empty
  };

  const slide = (dr: number, dc: number) => {
    for (let i = 1; i < 8; i++) {
      if (!addIfValid(r + dr * i, c + dc * i)) break;
    }
  };

  switch (type) {
    case 'P': {
      const dir = white ? -1 : 1;
      const startRow = white ? 6 : 1;
      // Forward
      const fwd = rowColToIdx(r + dir, c);
      if (inBounds(r + dir, c) && board[fwd] === '.') {
        moves.push(fwd);
        // Double push from start
        if (r === startRow) {
          const dbl = rowColToIdx(r + dir * 2, c);
          if (board[dbl] === '.') moves.push(dbl);
        }
      }
      // Captures
      for (const dc of [-1, 1]) {
        if (inBounds(r + dir, c + dc)) {
          const capIdx = rowColToIdx(r + dir, c + dc);
          if (isEnemyPiece(board[capIdx], white)) moves.push(capIdx);
        }
      }
      break;
    }
    case 'N':
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        addIfValid(r + dr, c + dc);
      }
      break;
    case 'B':
      slide(1, 1); slide(1, -1); slide(-1, 1); slide(-1, -1);
      break;
    case 'R':
      slide(1, 0); slide(-1, 0); slide(0, 1); slide(0, -1);
      break;
    case 'Q':
      slide(1, 0); slide(-1, 0); slide(0, 1); slide(0, -1);
      slide(1, 1); slide(1, -1); slide(-1, 1); slide(-1, -1);
      break;
    case 'K':
      for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        addIfValid(r + dr, c + dc);
      }
      break;
  }
  return moves;
}

/** Check if a side's king is attacked */
export function isInCheck(board: string, white: boolean): boolean {
  const kingIdx = findKing(board, white);
  if (kingIdx < 0) return true;
  // Check if any enemy piece can capture the king
  for (let i = 0; i < 64; i++) {
    const ch = board[i];
    if (ch === '.' || isOwnPiece(ch, white)) continue;
    if (pseudoMoves(board, i).includes(kingIdx)) return true;
  }
  return false;
}

/** Get all legal moves for a side (filtered for check) */
export function getChessLegalMoves(board: string, turn: 'white' | 'black'): Array<[number, number]> {
  const white = turn === 'white';
  const moves: Array<[number, number]> = [];
  for (let i = 0; i < 64; i++) {
    const ch = board[i];
    if (ch === '.' || !isOwnPiece(ch, white)) continue;
    for (const to of pseudoMoves(board, i)) {
      const newBoard = applyChessMove(board, i, to);
      if (!isInCheck(newBoard, white)) {
        moves.push([i, to]);
      }
    }
  }
  return moves;
}

export function isCheckmate(board: string, turn: 'white' | 'black'): boolean {
  const white = turn === 'white';
  return getChessLegalMoves(board, turn).length === 0 && isInCheck(board, white);
}

export function isStalemate(board: string, turn: 'white' | 'black'): boolean {
  const white = turn === 'white';
  return getChessLegalMoves(board, turn).length === 0 && !isInCheck(board, white);
}

// ── Connect Four Win Detection ──────────────────────────────────────────────

/** Check if placing piece at (row, col) wins. Board is 42-char string (6 rows x 7 cols). */
export function checkConnectFourWin(boardStr: string, row: number, col: number, player: number): boolean {
  const get = (r: number, c: number): number => {
    if (r < 0 || r >= 6 || c < 0 || c >= 7) return -1;
    return parseInt(boardStr[r * 7 + c]) || 0;
  };

  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]]; // horiz, vert, diag-down-right, diag-down-left
  for (const [dr, dc] of directions) {
    let count = 1;
    // Count in positive direction
    for (let i = 1; i < 4; i++) {
      if (get(row + dr * i, col + dc * i) === player) count++;
      else break;
    }
    // Count in negative direction
    for (let i = 1; i < 4; i++) {
      if (get(row - dr * i, col - dc * i) === player) count++;
      else break;
    }
    if (count >= 4) return true;
  }
  return false;
}

/** Check if the connect four board is completely full */
export function isConnectFourFull(boardStr: string): boolean {
  for (let c = 0; c < 7; c++) {
    if (boardStr[c] === '0') return false;
  }
  return true;
}

/** Simple AI for Connect Four — prefers center, blocks wins, takes wins */
export function connectFourAI(boardStr: string, aiPlayer: number): number {
  const opponent = aiPlayer === 1 ? 2 : 1;
  const availCols: number[] = [];
  for (let c = 0; c < 7; c++) {
    if (boardStr[c] === '0') availCols.push(c);
  }
  if (availCols.length === 0) return -1;

  const dropRow = (b: string, col: number): number => {
    for (let r = 5; r >= 0; r--) {
      if (b[r * 7 + col] === '0') return r;
    }
    return -1;
  };

  // 1. Take the win
  for (const c of availCols) {
    const r = dropRow(boardStr, c);
    if (r >= 0) {
      const idx = r * 7 + c;
      const test = boardStr.substring(0, idx) + String(aiPlayer) + boardStr.substring(idx + 1);
      if (checkConnectFourWin(test, r, c, aiPlayer)) return c;
    }
  }
  // 2. Block opponent win
  for (const c of availCols) {
    const r = dropRow(boardStr, c);
    if (r >= 0) {
      const idx = r * 7 + c;
      const test = boardStr.substring(0, idx) + String(opponent) + boardStr.substring(idx + 1);
      if (checkConnectFourWin(test, r, c, opponent)) return c;
    }
  }
  // 3. Prefer center columns
  const centerPref = [3, 2, 4, 1, 5, 0, 6];
  for (const c of centerPref) {
    if (availCols.includes(c)) return c;
  }
  return availCols[0];
}

// ─── Farm Plot Game ──────────────────────────────────────────────────────────

export type CropType = 't' | 'w' | 'p' | 'c' | 's' | 'n' | 'f' | 'r'; // tomato, wheat, pumpkin, crystal, strawberry, corn, mushroom, rose
export type PlotState = '0' | '1' | '2' | '3' | '4' | '5'; // empty, seed, sprout, growing, ready, dead

export const CROP_INFO: Record<CropType, { name: string; icon: string; growTime: number; gold: number; color: string; tier: number }> = {
  t: { name: 'Starfruit',      icon: '\u{1F31F}', growTime: 30000,   gold: 5,   color: '#fbbf24', tier: 1 }, // 30s
  w: { name: 'Nebula Grain',   icon: '\u2728',    growTime: 60000,   gold: 12,  color: '#c084fc', tier: 1 }, // 60s
  s: { name: 'Comet Berry',    icon: '\u2604\uFE0F', growTime: 45000,   gold: 8,   color: '#38bdf8', tier: 1 }, // 45s
  n: { name: 'Solar Stalk',    icon: '\u2600\uFE0F', growTime: 90000,   gold: 20,  color: '#fb923c', tier: 2 }, // 90s
  p: { name: 'Void Melon',     icon: '\u{1F7E3}', growTime: 120000,  gold: 30,  color: '#a855f7', tier: 2 }, // 2min
  f: { name: 'Neural Shroom',  icon: '\u{1F9E0}', growTime: 180000,  gold: 50,  color: '#f472b6', tier: 3 }, // 3min
  r: { name: 'Quantum Bloom',  icon: '\u{1F4AB}', growTime: 240000,  gold: 75,  color: '#34d399', tier: 3 }, // 4min
  c: { name: 'Dark Matter',    icon: '\u{1F48E}', growTime: 300000,  gold: 100, color: '#818cf8', tier: 4 }, // 5min
};

export const CROP_TYPES: CropType[] = ['t', 'w', 's', 'n', 'p', 'f', 'r', 'c'];
export const GRID_SIZE = 16; // 4x4 grid
export const EMPTY_FARM = '0'.repeat(GRID_SIZE);
export const EMPTY_CROPS = '0'.repeat(GRID_SIZE);

// ── Farm shop items ──────────────────────────────────────────────────────────

export type FarmUpgrade = 'sprinkler' | 'scarecrow' | 'fertilizer' | 'greenhouse' | 'golden_hoe';

export const FARM_SHOP: Record<FarmUpgrade, { name: string; icon: string; cost: number; desc: string }> = {
  sprinkler:  { name: 'Hydro Drone',      icon: '\u{1F6F8}', cost: 50,  desc: 'Auto-irrigates every 30s' },
  scarecrow:  { name: 'Force Field',      icon: '\u{1F6E1}\uFE0F', cost: 80,  desc: 'Crops survive cosmic storms' },
  fertilizer: { name: 'Quantum Boost',    icon: '\u26A1',    cost: 30,  desc: 'Next 5 crops grow 2x faster' },
  greenhouse: { name: 'Bio Dome',         icon: '\u{1F52E}', cost: 200, desc: 'All crops +50% yield' },
  golden_hoe: { name: 'Plasma Harvester', icon: '\u{1F52E}', cost: 500, desc: 'Chance to double harvest' },
};

// ── Farm season system ───────────────────────────────────────────────────────

export type FarmSeason = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_INFO: Record<FarmSeason, { icon: string; color: string; growBonus: number; waterDecay: number }> = {
  spring: { icon: '\u{1F31F}', color: '#c084fc', growBonus: 1.2,  waterDecay: 1.0 },  // Nova Phase
  summer: { icon: '\u2600\uFE0F', color: '#fbbf24', growBonus: 1.0,  waterDecay: 1.5 },  // Solar Flare
  autumn: { icon: '\u{1F30C}', color: '#818cf8', growBonus: 0.8,  waterDecay: 0.7 },  // Nebula Drift
  winter: { icon: '\u{1F311}', color: '#64748b', growBonus: 0.5,  waterDecay: 0.4 },  // Dark Cycle
};

export function getCurrentSeason(): FarmSeason {
  // Cycle through seasons every 10 minutes
  const cycle = Math.floor(Date.now() / 600000) % 4;
  return (['spring', 'summer', 'autumn', 'winter'] as FarmSeason[])[cycle];
}

// ── Farm weather events ──────────────────────────────────────────────────────

export type WeatherEvent = 'sunny' | 'rain' | 'storm' | 'drought';

export const WEATHER_INFO: Record<WeatherEvent, { icon: string; effect: string }> = {
  sunny:   { icon: '\u{1F6F8}', effect: 'Clear orbit' },
  rain:    { icon: '\u{1F320}', effect: 'Meteor shower +20 energy' },
  storm:   { icon: '\u26A1',    effect: 'Ion storm — random crop lost' },
  drought: { icon: '\u{1F525}', effect: 'Solar drain — energy 2x decay' },
};

export function rollWeather(): WeatherEvent {
  const r = Math.random();
  if (r < 0.5) return 'sunny';
  if (r < 0.75) return 'rain';
  if (r < 0.9) return 'storm';
  return 'drought';
}

export function getPlotGrowthPercent(plantedAt: number, cropType: CropType, growBonus = 1.0): number {
  if (!plantedAt) return 0;
  const elapsed = Date.now() - plantedAt;
  const growTime = (CROP_INFO[cropType]?.growTime || 60000) / growBonus;
  return Math.min(100, (elapsed / growTime) * 100);
}

export function getPlotState(plantedAt: number, cropType: CropType, waterLevel: number, growBonus = 1.0): PlotState {
  if (!plantedAt || cropType === '0' as any) return '0';
  if (waterLevel <= 0) return '5'; // dead — no water
  const pct = getPlotGrowthPercent(plantedAt, cropType, growBonus);
  if (pct < 15) return '1';  // seed
  if (pct < 45) return '2';  // sprout
  if (pct < 90) return '3';  // growing
  return '4';                 // ready to harvest
}

export function harvestPlot(cropType: CropType, hasGreenhouse = false, hasGoldenHoe = false): number {
  let gold = CROP_INFO[cropType]?.gold || 0;
  if (hasGreenhouse) gold = Math.ceil(gold * 1.5);
  if (hasGoldenHoe && Math.random() < 0.2) gold *= 2; // 20% chance double
  return gold;
}

// ── Farm achievements ────────────────────────────────────────────────────────

export const FARM_ACHIEVEMENTS = [
  { id: 'first_harvest', name: 'First Signal',     icon: '\u{1F4E1}', req: 1,    desc: 'Harvest your first data crop' },
  { id: 'farmer_10',     name: 'Star Farmer',      icon: '\u{1F31F}', req: 10,   desc: 'Harvest 10 data crops' },
  { id: 'farmer_50',     name: 'Galaxy Grower',    icon: '\u{1F30C}', req: 50,   desc: 'Harvest 50 data crops' },
  { id: 'gold_100',      name: 'Data Miner',       icon: '\u{1F4B0}', req: 100,  desc: 'Earn 100 stardust' },
  { id: 'gold_1000',     name: 'Cosmic Tycoon',    icon: '\u{1F451}', req: 1000, desc: 'Earn 1000 stardust' },
  { id: 'all_crops',     name: 'Xenobotanist',     icon: '\u{1F52C}', req: 8,    desc: 'Grow all 8 data species' },
];

// ─── Office Pet (Tamagotchi) ─────────────────────────────────────────────────

export type PetType = 'cat' | 'dog' | 'dragon' | 'blob' | 'fox' | 'penguin' | 'bunny' | 'owl';
export type PetStage = 'egg' | 'baby' | 'teen' | 'adult' | 'legendary';
export type PetMood = 'happy' | 'neutral' | 'sad' | 'sick' | 'sleeping' | 'dead' | 'excited' | 'dirty';
export type PetAccessory = 'none' | 'hat' | 'bow' | 'crown' | 'sunglasses' | 'scarf' | 'wings' | 'halo';

export const PET_INFO: Record<PetType, { name: string; stages: Record<PetStage, string>; color: string }> = {
  cat:     { name: 'Cat',     color: '#f59e0b', stages: { egg: '\u{1F95A}', baby: '\u{1F431}', teen: '\u{1F408}', adult: '\u{1F408}\u200D\u2B1B', legendary: '\u{1F981}' } },
  dog:     { name: 'Dog',     color: '#8b5cf6', stages: { egg: '\u{1F95A}', baby: '\u{1F436}', teen: '\u{1F415}', adult: '\u{1F415}\u200D\u{1F9BA}', legendary: '\u{1F43A}' } },
  dragon:  { name: 'Dragon',  color: '#ef4444', stages: { egg: '\u{1F95A}', baby: '\u{1F432}', teen: '\u{1F409}', adult: '\u{1F525}', legendary: '\u2604\uFE0F' } },
  blob:    { name: 'Blob',    color: '#22c55e', stages: { egg: '\u{1F95A}', baby: '\u{1F7E2}', teen: '\u{1F47E}', adult: '\u{1F9A0}', legendary: '\u{1F30C}' } },
  fox:     { name: 'Fox',     color: '#f97316', stages: { egg: '\u{1F95A}', baby: '\u{1F98A}', teen: '\u{1F98A}', adult: '\u{1F98A}', legendary: '\u{1F525}' } },
  penguin: { name: 'Penguin', color: '#38bdf8', stages: { egg: '\u{1F95A}', baby: '\u{1F427}', teen: '\u{1F427}', adult: '\u{1F427}', legendary: '\u2744\uFE0F' } },
  bunny:   { name: 'Bunny',   color: '#f472b6', stages: { egg: '\u{1F95A}', baby: '\u{1F430}', teen: '\u{1F407}', adult: '\u{1F407}', legendary: '\u{1F31F}' } },
  owl:     { name: 'Owl',     color: '#a78bfa', stages: { egg: '\u{1F95A}', baby: '\u{1F426}', teen: '\u{1F989}', adult: '\u{1F989}', legendary: '\u{1F31C}' } },
};

export const PET_TYPES: PetType[] = ['cat', 'dog', 'dragon', 'blob', 'fox', 'penguin', 'bunny', 'owl'];

export const PET_STAGE_XP: Record<PetStage, number> = {
  egg: 0,
  baby: 50,
  teen: 200,
  adult: 500,
  legendary: 1500,
};

export const MOOD_EMOJI: Record<PetMood, string> = {
  happy: '\u{1F60A}',
  excited: '\u{1F929}',
  neutral: '\u{1F610}',
  sad: '\u{1F622}',
  sick: '\u{1F922}',
  dirty: '\u{1F4A9}',
  sleeping: '\u{1F634}',
  dead: '\u{1F480}',
};

export const PET_ACCESSORY_INFO: Record<PetAccessory, { icon: string; cost: number; name: string }> = {
  none:       { icon: '',                name: 'None',        cost: 0 },
  hat:        { icon: '\u{1F3A9}',       name: 'Top Hat',     cost: 30 },
  bow:        { icon: '\u{1F380}',       name: 'Bow',         cost: 20 },
  crown:      { icon: '\u{1F451}',       name: 'Crown',       cost: 100 },
  sunglasses: { icon: '\u{1F576}\uFE0F', name: 'Sunglasses',  cost: 40 },
  scarf:      { icon: '\u{1F9E3}',       name: 'Scarf',       cost: 25 },
  wings:      { icon: '\u{1FABD}',       name: 'Wings',       cost: 150 },
  halo:       { icon: '\u{1F607}',       name: 'Halo',        cost: 200 },
};

// ── Pet food items ───────────────────────────────────────────────────────────

export type PetFood = 'kibble' | 'treat' | 'steak' | 'fish' | 'cake';

export const PET_FOOD_INFO: Record<PetFood, { icon: string; hungerGain: number; happinessGain: number; xp: number; cost: number; name: string }> = {
  kibble: { icon: '\u{1F35A}', hungerGain: 20, happinessGain: 5,  xp: 3,  cost: 0,   name: 'Kibble' },
  treat:  { icon: '\u{1F36A}', hungerGain: 15, happinessGain: 15, xp: 5,  cost: 5,   name: 'Treat' },
  steak:  { icon: '\u{1F356}', hungerGain: 40, happinessGain: 10, xp: 8,  cost: 15,  name: 'Steak' },
  fish:   { icon: '\u{1F41F}', hungerGain: 30, happinessGain: 20, xp: 10, cost: 20,  name: 'Fish' },
  cake:   { icon: '\u{1F382}', hungerGain: 10, happinessGain: 40, xp: 15, cost: 30,  name: 'Cake' },
};

export const PET_FOOD_TYPES: PetFood[] = ['kibble', 'treat', 'steak', 'fish', 'cake'];

// ── Pet tricks ───────────────────────────────────────────────────────────────

export type PetTrick = 'sit' | 'roll' | 'shake' | 'spin' | 'dance' | 'fetch';

export const PET_TRICK_INFO: Record<PetTrick, { name: string; icon: string; xpReward: number; minStage: PetStage }> = {
  sit:   { name: 'Sit',       icon: '\u{1F43E}', xpReward: 5,  minStage: 'baby' },
  roll:  { name: 'Roll Over', icon: '\u{1F300}', xpReward: 8,  minStage: 'baby' },
  shake: { name: 'Shake',     icon: '\u{1F91D}', xpReward: 10, minStage: 'teen' },
  spin:  { name: 'Spin',      icon: '\u{1F4AB}', xpReward: 12, minStage: 'teen' },
  dance: { name: 'Dance',     icon: '\u{1F57A}', xpReward: 20, minStage: 'adult' },
  fetch: { name: 'Fetch',     icon: '\u{1F3BE}', xpReward: 25, minStage: 'adult' },
};

const DECAY_RATE = 2; // points per minute
const CRITICAL_THRESHOLD = 20;
const POOP_INTERVAL = 180000; // poop every 3 minutes after eating
const DIRTY_PENALTY = 0.5; // extra decay per minute when dirty

export function computePetStats(
  hunger: number, happiness: number, energy: number,
  lastFed: number, lastPlayed: number, lastSlept: number,
  cleanliness?: number, lastCleaned?: number,
): { hunger: number; happiness: number; energy: number; cleanliness: number; mood: PetMood } {
  const now = Date.now();
  const minutesSinceFed = (now - (lastFed || now)) / 60000;
  const minutesSincePlayed = (now - (lastPlayed || now)) / 60000;
  const minutesSinceSlept = (now - (lastSlept || now)) / 60000;
  const minutesSinceCleaned = (now - (lastCleaned || now)) / 60000;

  // Cleanliness decays over time and faster after eating
  const cleanBase = cleanliness ?? 100;
  const cl = Math.max(0, Math.min(100, cleanBase - minutesSinceCleaned * 1.5));
  const dirtyPenalty = cl < 30 ? DIRTY_PENALTY : 0;

  const h = Math.max(0, Math.min(100, hunger - minutesSinceFed * (DECAY_RATE + dirtyPenalty)));
  const hp = Math.max(0, Math.min(100, happiness - minutesSincePlayed * (DECAY_RATE + dirtyPenalty)));
  const e = Math.max(0, Math.min(100, energy - minutesSinceSlept * (DECAY_RATE * 0.5)));

  const avg = (h + hp + e) / 3;
  let mood: PetMood = 'happy';
  if (avg <= 0) mood = 'dead';
  else if (cl < 15) mood = 'dirty';
  else if (avg < CRITICAL_THRESHOLD) mood = 'sick';
  else if (avg < 35) mood = 'sad';
  else if (avg < 60) mood = 'neutral';
  else if (avg > 85 && cl > 70) mood = 'excited';

  return { hunger: Math.round(h), happiness: Math.round(hp), energy: Math.round(e), cleanliness: Math.round(cl), mood };
}

export function getPetStage(xp: number): PetStage {
  if (xp >= PET_STAGE_XP.legendary) return 'legendary';
  if (xp >= PET_STAGE_XP.adult) return 'adult';
  if (xp >= PET_STAGE_XP.teen) return 'teen';
  if (xp >= PET_STAGE_XP.baby) return 'baby';
  return 'egg';
}

export function feedPet(food: PetFood = 'kibble'): { hungerGain: number; happinessGain: number; xp: number; cost: number } {
  const info = PET_FOOD_INFO[food];
  return { hungerGain: info.hungerGain, happinessGain: info.happinessGain, xp: info.xp, cost: info.cost };
}

export function playWithPet(): { happinessGain: number; xp: number; energyCost: number } {
  return { happinessGain: 25, xp: 8, energyCost: 10 };
}

export function restPet(): { energyGain: number; xp: number } {
  return { energyGain: 40, xp: 3 };
}

export function bathPet(): { cleanlinessGain: number; happinessGain: number; xp: number } {
  return { cleanlinessGain: 80, happinessGain: 10, xp: 5 };
}

export function medicinePet(): { hungerGain: number; happinessGain: number; energyGain: number; xp: number; cost: number } {
  return { hungerGain: 20, happinessGain: 15, energyGain: 20, xp: 10, cost: 25 };
}

export function doTrick(trick: PetTrick, stage: PetStage): { success: boolean; xp: number; happinessGain: number } {
  const info = PET_TRICK_INFO[trick];
  const stages: PetStage[] = ['egg', 'baby', 'teen', 'adult', 'legendary'];
  const canDo = stages.indexOf(stage) >= stages.indexOf(info.minStage);
  if (!canDo) return { success: false, xp: 0, happinessGain: 0 };
  const success = Math.random() > 0.3; // 70% success rate
  return { success, xp: success ? info.xpReward : 2, happinessGain: success ? 15 : -5 };
}

// ── Pet achievements ─────────────────────────────────────────────────────────

export const PET_ACHIEVEMENTS = [
  { id: 'first_feed',  name: 'First Signal',     icon: '\u{1F4E1}', desc: 'Feed your companion for the first time' },
  { id: 'teen_stage',  name: 'Evolving',         icon: '\u{1F31F}', desc: 'Reach teen stage' },
  { id: 'adult_stage', name: 'Fully Evolved',    icon: '\u{1F4AA}', desc: 'Reach adult stage' },
  { id: 'legendary',   name: 'Cosmic Legend',    icon: '\u{1F30C}', desc: 'Reach legendary stage' },
  { id: 'trick_5',     name: 'Star Performer',   icon: '\u{1F3BE}', desc: 'Perform 5 tricks' },
  { id: 'revive',      name: 'Respawn',          icon: '\u{1F495}', desc: 'Revive a fallen companion' },
  { id: 'all_food',    name: 'Cosmic Foodie',    icon: '\u{1F37D}\uFE0F', desc: 'Try all food types' },
  { id: 'accessorize', name: 'Space Fashion',    icon: '\u{1F451}', desc: 'Buy an accessory' },
];
