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
  pot: number,
  currentBet: number,
  chips: number,
  phase: PokerPhase,
): 'fold' | 'call' | 'raise' {
  const strength = handStrength(hand);
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
