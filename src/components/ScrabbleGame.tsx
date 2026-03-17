import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet, Platform, Animated, Easing,
} from 'react-native';
import {
  TILE_VALUES, EMPTY_BOARD, createTileBag, drawTiles, getCell, setCell,
  isOccupied, getMultiplier, MULT_LABELS, MULT_BG, MULT_COLORS,
  validateAndScore, scrabbleAI, isValidWord, getScrabbleLine,
} from '../lib/scrabbleEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlacedTile { r: number; c: number; letter: string; }

interface GameState {
  board: string;
  bag: string;
  rack1: string;
  rack2: string;
  score1: number;
  score2: number;
  turn: 1 | 2;
  pending: PlacedTile[];
  selectedTileIdx: number;
  gameOver: boolean;
  winner: 0 | 1 | 2;
  lastWord: string;
  lastScore: number;
  consecutivePasses: number;
  blackswanLine: string;
  moveHistory: string[];
}

function initGame(): GameState {
  let bag = createTileBag();
  const d1 = drawTiles(bag, 7); bag = d1.remaining;
  const d2 = drawTiles(bag, 7); bag = d2.remaining;
  return {
    board: EMPTY_BOARD,
    bag,
    rack1: d1.drawn,
    rack2: d2.drawn,
    score1: 0,
    score2: 0,
    turn: 1,
    pending: [],
    selectedTileIdx: -1,
    gameOver: false,
    winner: 0,
    lastWord: '',
    lastScore: 0,
    consecutivePasses: 0,
    blackswanLine: 'Your move, wordsmith.',
    moveHistory: [],
  };
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface ScrabbleGameProps {
  visible: boolean;
  onClose: () => void;
  vsComputer?: boolean;
  onStateChange?: (state: {
    board: string; score1: number; score2: number;
    turn: number; gameOver: boolean; winner: number;
  }) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ScrabbleGame({ visible, onClose, vsComputer = true, onStateChange }: ScrabbleGameProps) {
  const [game, setGame] = useState<GameState>(initGame);
  const [direction, setDirection] = useState<'H' | 'V'>('H');
  const [message, setMessage] = useState('');
  const [showingScore, setShowingScore] = useState(false);
  const aiTimeout = useRef<any>(null);
  const scoreFlash = useRef(new Animated.Value(0)).current;

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({
      board: game.board, score1: game.score1, score2: game.score2,
      turn: game.turn, gameOver: game.gameOver, winner: game.winner,
    });
  }, [game.board, game.score1, game.score2, game.turn, game.gameOver]);

  // AI move
  useEffect(() => {
    if (vsComputer && game.turn === 2 && !game.gameOver) {
      aiTimeout.current = setTimeout(() => {
        setGame(prev => {
          const aiMove = scrabbleAI(prev.board, prev.rack2);
          if (!aiMove) {
            // AI passes
            const passes = prev.consecutivePasses + 1;
            if (passes >= 4) {
              return { ...prev, gameOver: true, winner: prev.score1 >= prev.score2 ? 1 : 2,
                blackswanLine: prev.score1 >= prev.score2 ? getScrabbleLine('lose') : getScrabbleLine('win'),
                consecutivePasses: passes };
            }
            return { ...prev, turn: 1, consecutivePasses: passes,
              blackswanLine: getScrabbleLine('pass'),
              moveHistory: [...prev.moveHistory, 'BlackSwan: PASS'] };
          }

          // Apply AI move
          let newBoard = prev.board;
          for (const t of aiMove.placed) {
            newBoard = setCell(newBoard, t.r, t.c, t.letter);
          }

          // Remove used tiles from rack and draw new ones
          let newRack = prev.rack2;
          for (const t of aiMove.placed) {
            const idx = newRack.indexOf(t.letter);
            if (idx >= 0) newRack = newRack.slice(0, idx) + newRack.slice(idx + 1);
            else {
              const bi = newRack.indexOf('_');
              if (bi >= 0) newRack = newRack.slice(0, bi) + newRack.slice(bi + 1);
            }
          }
          const draw = drawTiles(prev.bag, 7 - newRack.length);
          newRack += draw.drawn;

          const newScore = prev.score2 + aiMove.score;
          const line = aiMove.score >= 20 ? getScrabbleLine('bigWord') : getScrabbleLine('play');

          // Check game over
          const bagEmpty = draw.remaining.length === 0;
          const rackEmpty = newRack.length === 0;
          const isOver = bagEmpty && rackEmpty;

          return {
            ...prev,
            board: newBoard,
            bag: draw.remaining,
            rack2: newRack,
            score2: newScore,
            turn: 1,
            lastWord: aiMove.word.toUpperCase(),
            lastScore: aiMove.score,
            consecutivePasses: 0,
            blackswanLine: isOver ? (newScore >= prev.score1 ? getScrabbleLine('win') : getScrabbleLine('lose')) : line,
            gameOver: isOver,
            winner: isOver ? (newScore >= prev.score1 ? 2 : 1) : 0,
            moveHistory: [...prev.moveHistory, `BlackSwan: ${aiMove.word.toUpperCase()} (+${aiMove.score})`],
          };
        });
      }, 800 + Math.random() * 700);
    }
    return () => { if (aiTimeout.current) clearTimeout(aiTimeout.current); };
  }, [game.turn, game.gameOver, vsComputer]);

  // Flash score animation
  const flashScore = useCallback(() => {
    scoreFlash.setValue(0);
    Animated.sequence([
      Animated.timing(scoreFlash, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.timing(scoreFlash, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]).start();
  }, []);

  // Select tile from rack
  const selectTile = useCallback((idx: number) => {
    setGame(prev => ({ ...prev, selectedTileIdx: prev.selectedTileIdx === idx ? -1 : idx }));
  }, []);

  // Place tile on board
  const placeTile = useCallback((r: number, c: number) => {
    setGame(prev => {
      if (prev.gameOver || (vsComputer && prev.turn === 2)) return prev;
      if (isOccupied(prev.board, r, c)) return prev;
      if (prev.pending.some(p => p.r === r && p.c === c)) return prev;
      if (prev.selectedTileIdx < 0) return prev;

      const rack = prev.turn === 1 ? prev.rack1 : prev.rack2;
      if (prev.selectedTileIdx >= rack.length) return prev;

      const letter = rack[prev.selectedTileIdx];
      const newRack = rack.slice(0, prev.selectedTileIdx) + rack.slice(prev.selectedTileIdx + 1);
      const newPending = [...prev.pending, { r, c, letter: letter === '_' ? 'A' : letter }];

      return {
        ...prev,
        [prev.turn === 1 ? 'rack1' : 'rack2']: newRack,
        pending: newPending,
        selectedTileIdx: -1,
      };
    });
    setMessage('');
  }, [vsComputer]);

  // Remove pending tile (tap to recall)
  const recallTile = useCallback((idx: number) => {
    setGame(prev => {
      const tile = prev.pending[idx];
      if (!tile) return prev;
      const rackKey = prev.turn === 1 ? 'rack1' : 'rack2';
      const newPending = prev.pending.filter((_, i) => i !== idx);
      return {
        ...prev,
        [rackKey]: prev[rackKey] + tile.letter,
        pending: newPending,
      };
    });
  }, []);

  // Recall all pending tiles
  const recallAll = useCallback(() => {
    setGame(prev => {
      if (prev.pending.length === 0) return prev;
      const rackKey = prev.turn === 1 ? 'rack1' : 'rack2';
      const letters = prev.pending.map(p => p.letter).join('');
      return {
        ...prev,
        [rackKey]: prev[rackKey] + letters,
        pending: [],
        selectedTileIdx: -1,
      };
    });
    setMessage('');
  }, []);

  // Submit word
  const submitWord = useCallback(() => {
    setGame(prev => {
      if (prev.pending.length === 0) {
        setMessage('Place tiles on the board first');
        return prev;
      }

      const result = validateAndScore(prev.board, prev.pending);
      if (!result) {
        setMessage('Invalid word or placement');
        return prev;
      }

      // Commit tiles to board
      let newBoard = prev.board;
      for (const p of prev.pending) {
        newBoard = setCell(newBoard, p.r, p.c, p.letter);
      }

      // Draw new tiles
      const rackKey = prev.turn === 1 ? 'rack1' : 'rack2';
      const draw = drawTiles(prev.bag, 7 - prev[rackKey].length);
      const newRack = prev[rackKey] + draw.drawn;

      const scoreKey = prev.turn === 1 ? 'score1' : 'score2';
      const newScore = prev[scoreKey] + result.total;
      const mainWord = result.words[0]?.word || '';

      // Check game over
      const isOver = draw.remaining.length === 0 && newRack.length === 0;
      const nextTurn = prev.turn === 1 ? 2 : 1;

      flashScore();
      setMessage(`${mainWord} +${result.total}`);
      setTimeout(() => setMessage(''), 2000);

      return {
        ...prev,
        board: newBoard,
        bag: draw.remaining,
        [rackKey]: newRack,
        [scoreKey]: newScore,
        turn: isOver ? prev.turn : nextTurn as 1 | 2,
        pending: [],
        selectedTileIdx: -1,
        lastWord: mainWord,
        lastScore: result.total,
        consecutivePasses: 0,
        gameOver: isOver,
        winner: isOver ? (prev.score1 + (prev.turn === 1 ? result.total : 0) >= prev.score2 + (prev.turn === 2 ? result.total : 0) ? 1 : 2) : 0,
        moveHistory: [...prev.moveHistory, `You: ${mainWord} (+${result.total})`],
      };
    });
  }, [flashScore]);

  // Pass turn
  const passTurn = useCallback(() => {
    recallAll();
    setGame(prev => {
      const passes = prev.consecutivePasses + 1;
      if (passes >= 4) {
        return { ...prev, gameOver: true, winner: prev.score1 >= prev.score2 ? 1 : 2,
          consecutivePasses: passes,
          moveHistory: [...prev.moveHistory, `${prev.turn === 1 ? 'You' : 'BlackSwan'}: PASS`] };
      }
      return {
        ...prev,
        turn: prev.turn === 1 ? 2 : 1 as 1 | 2,
        consecutivePasses: passes,
        moveHistory: [...prev.moveHistory, `${prev.turn === 1 ? 'You' : 'BlackSwan'}: PASS`],
      };
    });
  }, [recallAll]);

  // Shuffle rack
  const shuffleRack = useCallback(() => {
    setGame(prev => {
      const rackKey = prev.turn === 1 ? 'rack1' : 'rack2';
      const arr = prev[rackKey].split('');
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return { ...prev, [rackKey]: arr.join('') };
    });
  }, []);

  // New game
  const newGame = useCallback(() => {
    setGame(initGame());
    setMessage('');
    setDirection('H');
  }, []);

  // Close handler
  const handleClose = useCallback(() => {
    if (aiTimeout.current) clearTimeout(aiTimeout.current);
    onClose();
  }, [onClose]);

  if (Platform.OS !== 'web') {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.container}>
            <Text style={s.headerTitle}>Scrabble</Text>
            <Text style={{ color: '#64748b', fontFamily: 'monospace', textAlign: 'center', margin: 16 }}>
              Only available on web
            </Text>
            <Pressable onPress={onClose} style={s.newGameBtn}>
              <Text style={s.newGameBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  const currentRack = game.turn === 1 ? game.rack1 : game.rack2;
  const isMyTurn = !vsComputer || game.turn === 1;
  const waiting = vsComputer && game.turn === 2 && !game.gameOver;

  // Build display board (board + pending tiles)
  const displayBoard = (() => {
    let b = game.board;
    for (const p of game.pending) {
      b = setCell(b, p.r, p.c, p.letter.toLowerCase()); // lowercase = pending
    }
    return b;
  })();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.overlay}>
        <View style={s.container}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Text style={s.headerTitle}>SCRABBLE</Text>
              <Text style={s.headerSub}>{game.bag.length} tiles left</Text>
            </View>
            <Pressable onPress={handleClose} style={s.closeBtn}>
              <Text style={s.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Scores */}
          <View style={s.scoreBar}>
            <Animated.View style={[s.scoreBox, game.turn === 1 && s.scoreBoxActive,
              { opacity: scoreFlash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }]}>
              <Text style={s.scoreLabel}>YOU</Text>
              <Text style={[s.scoreNum, game.turn === 1 && { color: '#22c55e' }]}>{game.score1}</Text>
            </Animated.View>
            <View style={s.vsBox}>
              <Text style={s.vsText}>VS</Text>
              {game.lastWord && !game.gameOver && (
                <Text style={s.lastWordText}>{game.lastWord} +{game.lastScore}</Text>
              )}
            </View>
            <Animated.View style={[s.scoreBox, game.turn === 2 && s.scoreBoxActive,
              { opacity: scoreFlash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }]}>
              <Text style={s.scoreLabel}>{vsComputer ? 'BLACKSWAN' : 'PLAYER 2'}</Text>
              <Text style={[s.scoreNum, game.turn === 2 && { color: '#ef4444' }]}>{game.score2}</Text>
            </Animated.View>
          </View>

          {/* BlackSwan line */}
          {vsComputer && (
            <View style={s.bsLineBox}>
              <Text style={s.bsLine}>🦢 {game.blackswanLine}</Text>
            </View>
          )}

          {/* Game Over overlay */}
          {game.gameOver && (
            <View style={s.gameOverBox}>
              <Text style={s.gameOverTitle}>
                {game.winner === 1 ? 'YOU WIN!' : game.winner === 2 ? (vsComputer ? 'BLACKSWAN WINS' : 'PLAYER 2 WINS') : 'DRAW'}
              </Text>
              <Text style={s.gameOverScore}>{game.score1} — {game.score2}</Text>
              <Pressable onPress={newGame} style={s.newGameBtn}>
                <Text style={s.newGameBtnText}>NEW GAME</Text>
              </Pressable>
            </View>
          )}

          <ScrollView style={s.boardScroll} contentContainerStyle={s.boardScrollContent}>
            {/* Board */}
            <View style={s.boardContainer}>
              {Array.from({ length: 15 }, (_, r) => (
                <View key={r} style={s.boardRow}>
                  {Array.from({ length: 15 }, (_, c) => {
                    const ch = displayBoard[r * 15 + c];
                    const isPending = ch !== '.' && ch === ch.toLowerCase() && ch !== '.';
                    const isPlaced = ch !== '.' && !isPending;
                    const mult = getMultiplier(r, c);
                    const multLabel = MULT_LABELS[mult];
                    const bgColor = isPlaced ? '#c4a35a' : isPending ? '#e2b86b' : MULT_BG[mult];
                    const borderColor = isPending ? '#f59e0b' : isPlaced ? '#a08940' : MULT_COLORS[mult];

                    return (
                      <Pressable
                        key={c}
                        onPress={() => isPending
                          ? recallTile(game.pending.findIndex(p => p.r === r && p.c === c))
                          : placeTile(r, c)
                        }
                        style={[s.cell, { backgroundColor: bgColor, borderColor }]}
                      >
                        {(isPlaced || isPending) ? (
                          <View style={s.tileInCell}>
                            <Text style={[s.tileLetter, isPending && { color: '#7c2d12' }]}>
                              {ch.toUpperCase()}
                            </Text>
                            <Text style={s.tilePoints}>
                              {TILE_VALUES[ch.toUpperCase()] || 0}
                            </Text>
                          </View>
                        ) : (
                          multLabel ? (
                            <Text style={[s.multText, { color: mult >= 3 ? '#fca5a5' : '#93c5fd' }]}>
                              {multLabel}
                            </Text>
                          ) : null
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Message bar */}
          {message ? (
            <View style={s.messageBar}>
              <Text style={s.messageText}>{message}</Text>
            </View>
          ) : null}

          {/* Rack */}
          {!game.gameOver && (
            <View style={s.rackSection}>
              <View style={s.rackRow}>
                {currentRack.split('').map((letter, i) => {
                  const isSelected = game.selectedTileIdx === i;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => isMyTurn && selectTile(i)}
                      style={[s.rackTile, isSelected && s.rackTileSelected,
                        !isMyTurn && { opacity: 0.4 }]}
                    >
                      <Text style={s.rackLetter}>{letter === '_' ? ' ' : letter}</Text>
                      <Text style={s.rackPoints}>{TILE_VALUES[letter] || 0}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Controls */}
              <View style={s.controlsRow}>
                <Pressable onPress={shuffleRack} style={s.ctrlBtn} disabled={!isMyTurn}>
                  <Text style={s.ctrlBtnText}>🔀 Shuffle</Text>
                </Pressable>
                <Pressable onPress={() => setDirection(d => d === 'H' ? 'V' : 'H')} style={[s.ctrlBtn, s.dirBtn]}>
                  <Text style={s.ctrlBtnText}>{direction === 'H' ? '→' : '↓'} {direction}</Text>
                </Pressable>
                <Pressable onPress={recallAll} style={s.ctrlBtn} disabled={game.pending.length === 0}>
                  <Text style={s.ctrlBtnText}>↩ Recall</Text>
                </Pressable>
                <Pressable
                  onPress={submitWord}
                  style={[s.ctrlBtn, s.playBtn, game.pending.length === 0 && { opacity: 0.4 }]}
                  disabled={game.pending.length === 0 || !isMyTurn}
                >
                  <Text style={[s.ctrlBtnText, { color: '#fff', fontWeight: '800' }]}>PLAY</Text>
                </Pressable>
                <Pressable onPress={passTurn} style={s.ctrlBtn} disabled={!isMyTurn}>
                  <Text style={[s.ctrlBtnText, { color: '#f87171' }]}>Pass</Text>
                </Pressable>
              </View>

              {waiting && (
                <View style={s.waitingBar}>
                  <Text style={s.waitingText}>🦢 BlackSwan is thinking...</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CELL_SIZE = 28;

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '95%' as any,
    maxWidth: 520,
    maxHeight: '95%' as any,
    backgroundColor: '#0d0d14',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#c4a35a',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
    backgroundColor: '#111318',
  },
  headerLeft: { gap: 2 },
  headerTitle: {
    color: '#c4a35a',
    fontSize: 18,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 3,
  },
  headerSub: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 6,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center', alignItems: 'center',
  },
  closeBtnText: { color: '#94a3b8', fontSize: 16 },

  // Scores
  scoreBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    backgroundColor: '#0a0a12',
  },
  scoreBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#111827',
  },
  scoreBoxActive: {
    borderColor: '#c4a35a50',
    backgroundColor: '#c4a35a10',
  },
  scoreLabel: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 1,
  },
  scoreNum: {
    color: '#e2e8f0',
    fontSize: 22,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  vsBox: { alignItems: 'center', width: 60 },
  vsText: { color: '#334155', fontSize: 12, fontFamily: 'monospace', fontWeight: '700' },
  lastWordText: { color: '#c4a35a', fontSize: 9, fontFamily: 'monospace', fontWeight: '600', marginTop: 2 },

  // BlackSwan line
  bsLineBox: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#0a0a12',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  bsLine: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Board
  boardScroll: { flex: 1 },
  boardScrollContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  boardContainer: {
    backgroundColor: '#0f1419',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#c4a35a40',
    padding: 2,
  },
  boardRow: { flexDirection: 'row' },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tileInCell: {
    width: '100%' as any,
    height: '100%' as any,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 2,
  },
  tileLetter: {
    color: '#1a1207',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  tilePoints: {
    position: 'absolute',
    bottom: 1,
    right: 2,
    color: '#5c4a1e',
    fontSize: 6,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  multText: {
    fontSize: 7,
    fontFamily: 'monospace',
    fontWeight: '700',
  },

  // Message
  messageBar: {
    paddingVertical: 4,
    backgroundColor: '#c4a35a20',
  },
  messageText: {
    color: '#c4a35a',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    textAlign: 'center',
  },

  // Rack
  rackSection: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    backgroundColor: '#111318',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  rackRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 8,
  },
  rackTile: {
    width: 40,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#c4a35a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#a08940',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'transform 0.1s ease' } as any : {}),
  },
  rackTileSelected: {
    borderColor: '#22c55e',
    backgroundColor: '#d4b86a',
    transform: [{ translateY: -6 }],
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 12px rgba(34,197,94,0.4)' } as any : {}),
  },
  rackLetter: {
    color: '#1a1207',
    fontSize: 20,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  rackPoints: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    color: '#5c4a1e',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '700',
  },

  // Controls
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  ctrlBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  ctrlBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  dirBtn: {
    borderColor: '#c4a35a40',
    minWidth: 44,
    alignItems: 'center',
  },
  playBtn: {
    backgroundColor: '#22c55e',
    borderColor: '#16a34a',
  },

  // Waiting
  waitingBar: {
    marginTop: 6,
    paddingVertical: 4,
  },
  waitingText: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
  },

  // Game over
  gameOverBox: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
    backgroundColor: 'rgba(13,13,20,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  gameOverTitle: {
    color: '#c4a35a',
    fontSize: 28,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 2,
  },
  gameOverScore: {
    color: '#e2e8f0',
    fontSize: 24,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  newGameBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#c4a35a',
  },
  newGameBtnText: {
    color: '#1a1207',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 1,
  },
});
