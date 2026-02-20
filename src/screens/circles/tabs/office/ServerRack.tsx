import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { OfficeAgent } from '../../../../lib/officeAgents';

const LED_COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#3b82f6'];

function BlinkingLED({ color, delay, size = 3 }: { color: string; delay: number; size?: number }) {
  const opacity = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 200 + Math.random() * 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.15, duration: 300 + Math.random() * 800, useNativeDriver: true }),
          Animated.delay(Math.random() * 2000),
        ])
      );
      loop.start();
      return () => loop.stop();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View style={[styles.led, { backgroundColor: color, opacity, width: size, height: size, borderRadius: size / 2 }]} />
  );
}

function ServerUnit({ label, leds, delay }: { label: string; leds: string[]; delay: number }) {
  return (
    <View style={styles.serverUnit}>
      <View style={styles.unitFace}>
        <Text style={styles.unitLabel}>{label}</Text>
        <View style={styles.ledRow}>
          {leds.map((color, i) => (
            <BlinkingLED key={i} color={color} delay={delay + i * 150} size={3} />
          ))}
        </View>
        <View style={styles.ventSlots}>
          {[0, 1, 2, 3, 4].map(i => (
            <View key={i} style={styles.ventSlot} />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function ServerRack({ agents = [] }: { agents?: OfficeAgent[] }) {
  const activeCount = agents.filter(a => a.status === 'active').length;
  const totalCost = agents.reduce((s, a) => s + a.costToday, 0);
  const totalTokens = agents.reduce((s, a) => s + a.tokensUsed, 0);

  return (
    <View style={styles.rack}>
      {/* Cabinet frame */}
      <View style={styles.cabinet}>
        {/* Top label */}
        <View style={styles.cabinetTop}>
          <BlinkingLED color="#22c55e" delay={0} size={4} />
          <Text style={styles.cabinetLabel}>SERVER RACK</Text>
          <BlinkingLED color="#22c55e" delay={300} size={4} />
        </View>

        {/* Server units */}
        <ServerUnit label="API" leds={['#22c55e', '#22c55e', '#3b82f6']} delay={0} />
        <ServerUnit label="GPU" leds={['#ef4444', '#eab308', '#22c55e']} delay={400} />
        <ServerUnit label="DB" leds={['#3b82f6', '#22c55e', '#eab308']} delay={800} />
        <ServerUnit label="CDN" leds={['#22c55e', '#3b82f6', '#22c55e']} delay={1200} />

        {/* Stats panel */}
        <View style={styles.statsPanel}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>NODES</Text>
            <Text style={[styles.statValue, { color: '#22c55e' }]}>{activeCount} UP</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>COST</Text>
            <Text style={[styles.statValue, { color: '#f59e0b' }]}>${totalCost.toFixed(2)}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>TOKENS</Text>
            <Text style={[styles.statValue, { color: '#6366f1' }]}>{(totalTokens / 1000).toFixed(0)}K</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>REGION</Text>
            <Text style={[styles.statValue, { color: '#3b82f6' }]}>US-E1</Text>
          </View>
        </View>

        {/* Power section */}
        <View style={styles.powerBar}>
          <BlinkingLED color="#22c55e" delay={0} size={3} />
          <Text style={styles.powerText}>PWR</Text>
          <View style={styles.powerFill}>
            <View style={[styles.powerLevel, { width: '78%' as any }]} />
          </View>
          <Text style={styles.powerPct}>78%</Text>
        </View>
      </View>

      {/* Cabinet legs */}
      <View style={styles.legs}>
        <View style={styles.leg} />
        <View style={styles.leg} />
      </View>

      {/* Floor label */}
      <Text style={styles.floorLabel}>AWS · us-east-1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rack: {
    position: 'absolute',
    right: 30,
    top: 240,
    zIndex: 8,
    alignItems: 'center',
  },
  cabinet: {
    width: 80,
    backgroundColor: '#0c0c18',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderRadius: 3,
    padding: 4,
    gap: 3,
  },
  cabinetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  cabinetLabel: {
    fontSize: 5,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 1,
  },
  // Server units
  serverUnit: {
    height: 16,
    backgroundColor: '#080812',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 1,
  },
  unitFace: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 4,
  },
  unitLabel: {
    fontSize: 5,
    color: '#444',
    fontFamily: 'monospace',
    fontWeight: '700',
    width: 16,
  },
  ledRow: {
    flexDirection: 'row',
    gap: 3,
  },
  led: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  ventSlots: {
    flexDirection: 'row',
    gap: 1,
    marginLeft: 'auto',
  },
  ventSlot: {
    width: 2,
    height: 8,
    backgroundColor: '#0f0f1a',
    borderWidth: 0.5,
    borderColor: '#1a1a2e',
  },
  // Stats panel
  statsPanel: {
    backgroundColor: '#06060e',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 4,
    gap: 2,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 5,
    color: '#444',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 6,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  // Power bar
  powerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    paddingHorizontal: 2,
  },
  powerText: {
    fontSize: 4,
    color: '#333',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  powerFill: {
    flex: 1,
    height: 4,
    backgroundColor: '#111',
    borderRadius: 2,
    overflow: 'hidden',
  },
  powerLevel: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  powerPct: {
    fontSize: 4,
    color: '#22c55e',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  // Legs
  legs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 60,
  },
  leg: {
    width: 6,
    height: 4,
    backgroundColor: '#1a1a2e',
  },
  // Floor label
  floorLabel: {
    fontSize: 5,
    color: '#333',
    fontFamily: 'monospace',
    marginTop: 2,
    letterSpacing: 0.5,
  },
});
