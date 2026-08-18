import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PixelAgent from './PixelAgent';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  AgentAppearance,
  DEFAULT_APPEARANCE,
  EnvironmentType,
  EYE_COLORS,
  HAIR_COLORS,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKIN_TONES,
} from '../../../../lib/officeConfig';
import { MONO } from './AgentPanelShared';

const PANTS_COLORS = ['#2d2d3d', '#2a2a2a', '#3d2b1a', '#1e3a5f', '#2d1b4e', '#1a3d1a'];

interface Props {
  agent: OfficeAgent;
  appearances?: Record<string, AgentAppearance>;
  // Customization is a durable command, not an optimistic presentation hook.
  // Only an explicit true receipt may be rendered as saved.
  onAppearanceChange: (id: string, appearance: AgentAppearance) => Promise<boolean>;
  environmentType?: EnvironmentType;
  reduceMotion: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Category = 'colors' | 'looks' | 'accessories' | 'aura';

const CATEGORIES: Array<{ key: Category; label: string; color: string }> = [
  { key: 'colors', label: 'COLORS', color: '#6366f1' },
  { key: 'looks', label: 'LOOKS', color: '#22c55e' },
  { key: 'accessories', label: 'ITEMS', color: '#f59e0b' },
  { key: 'aura', label: 'AURA', color: '#a855f7' },
];

export default function AgentCustomizePanel({
  agent,
  appearances,
  onAppearanceChange,
  environmentType,
  reduceMotion,
}: Props) {
  const appearance = appearances?.[agent.id] || appearances?.[agent.name] || { ...DEFAULT_APPEARANCE, shirtColor: agent.color, hairColor: agent.color };
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [category, setCategory] = useState<Category>('colors');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  // Generation fencing prevents a late durable receipt from publishing into
  // a closed or newly selected agent panel.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveGenerationRef.current += 1;
      saveInFlightRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const flashSaved = (generation: number) => {
    if (!mountedRef.current || saveGenerationRef.current !== generation) return;
    setSaveState('saved');
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      if (mountedRef.current && saveGenerationRef.current === generation) setSaveState('idle');
    }, 1200);
  };

  const update = (patch: Partial<AgentAppearance>) => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    setSaveState('saving');
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }

    void (async () => {
      try {
        const saved = await onAppearanceChange(agent.id, { ...appearance, ...patch });
        if (!mountedRef.current || saveGenerationRef.current !== generation) return;
        if (saved !== true) {
          setSaveState('error');
          return;
        }
        flashSaved(generation);
      } catch (err) {
        console.warn('[AgentCustomizePanel] Failed to persist appearance:', err);
        if (mountedRef.current && saveGenerationRef.current === generation) {
          setSaveState('error');
        }
      } finally {
        if (saveGenerationRef.current === generation) saveInFlightRef.current = false;
      }
    })();
  };

  const saveIndicator = (() => {
    if (saveState === 'saving') return { color: '#6366f1', dot: '#6366f1', label: 'SAVING…' };
    if (saveState === 'saved') return { color: '#22c55e', dot: '#22c55e', label: '✓ SAVED' };
    if (saveState === 'error') return { color: '#ef4444', dot: '#ef4444', label: '✕ NOT SAVED — TRY AGAIN' };
    return { color: '#606075', dot: '#2a2a3e', label: 'READY' };
  })();

  const neonSkinTones = ['#ff00ff', '#00ff88', '#00ffff', '#ff4444', '#ffff00', '#aa55ff'];

  const ColorScroll = ({ label, colors, value, onSelect }: { label: string; colors: string[]; value: string; onSelect: (c: string) => void }) => (
    <>
      <Text style={styles.sectionTitle}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
        {colors.map(color => {
          const active = value === color;
          const isNeon = neonSkinTones.includes(color);
          return (
            <Pressable
              key={color}
              accessibilityRole="button"
              accessibilityLabel={`${label.toLowerCase()} color ${color}`}
              accessibilityState={{ selected: active, disabled: saveState === 'saving' }}
              disabled={saveState === 'saving'}
              onPress={() => onSelect(color)}
              style={[
                styles.swatch,
                { backgroundColor: color },
                // Neon glow — native uses shadow*, web uses boxShadow.
                // (RN's shadow* props don't render on web, so neon tones used
                // to look identical to normal ones there.)
                isNeon && (Platform.OS === 'web'
                  ? ({ boxShadow: `0 0 12px ${color}cc, 0 0 4px ${color}` } as any)
                  : { shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.9 }),
                active && styles.swatchActive,
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              ]}
            >
              {active && <Text style={styles.swatchCheck}>✓</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );

  const ItemScroll = ({ label, items }: { label: string; items: { key: string; emoji: string; name: string; active: boolean; glow?: string }[] }) => (
    <>
      <Text style={styles.sectionTitle}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
        {items.map(item => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`${label.toLowerCase()} ${item.name.toLowerCase()}`}
            accessibilityState={{ selected: item.active, disabled: saveState === 'saving' }}
            disabled={saveState === 'saving'}
            onPress={() => {
              const field = label === 'HAT'
                ? 'hat'
                : label === 'EXPRESSION'
                ? 'expression'
                : label === 'ACCESSORY'
                ? 'accessory'
                : label === 'BACK ITEM'
                ? 'backItem'
                : label === 'FACIAL HAIR'
                ? 'facialHair'
                : label === 'PET'
                ? 'pet'
                : label === 'AURA'
                ? 'aura'
                : label === 'HAND ITEM'
                ? 'handItem'
                : label === 'HAIR STYLE'
                ? 'hairStyle'
                : '';
              if (field) update({ [field]: item.key } as any);
            }}
            style={[
              styles.itemCard,
              item.active && styles.itemCardActive,
              // Aura glow — web: boxShadow; native: shadow* props.
              item.active && item.glow && (Platform.OS === 'web'
                ? ({ boxShadow: `0 0 14px ${item.glow}dd, 0 0 4px ${item.glow}` } as any)
                : { shadowColor: item.glow, shadowOffset: { width: 0, height: 0 }, shadowRadius: 10, shadowOpacity: 0.8 }),
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
            ]}
          >
            <Text style={styles.itemEmoji}>{item.emoji}</Text>
            <Text style={[styles.itemLabel, item.active && styles.itemLabelActive]}>{item.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  return (
    <View style={styles.section}>
      <View style={styles.body}>
        {/* Save status — transient feedback so users see that each color/emoji
            click actually persisted (or failed). Fades back to READY after 1.2s. */}
        <View
          style={styles.saveRow}
          accessibilityRole={saveState === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion={saveState === 'error' ? 'assertive' : 'polite'}
          accessibilityState={{ busy: saveState === 'saving' }}
          accessibilityLabel={`Customization save status: ${saveIndicator.label}`}
        >
          <View style={[styles.saveDot, { backgroundColor: saveIndicator.dot }]} />
          <Text style={[styles.saveLabel, { color: saveIndicator.color }]} numberOfLines={1}>
            {saveIndicator.label}
          </Text>
        </View>
        <View style={styles.preview}>
          {/* Larger preview with a subtle grid background — makes subtle
              color/accessory changes much easier to spot */}
          <View
            style={styles.previewInner}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Appearance preview for ${agent.name}`}
          >
            <PixelAgent
              agent={agent}
              appearance={appearance}
              environmentType={environmentType}
              selected={false}
              scale={2.5}
              reduceMotion={reduceMotion}
            />
          </View>
        </View>

        {/* Category tabs */}
        <View style={styles.categoryRow}>
          {CATEGORIES.map(c => {
            const active = category === c.key;
            return (
              <Pressable
                key={c.key}
                accessibilityRole="button"
                accessibilityLabel={`Show ${c.label.toLowerCase()} customization options`}
                accessibilityState={{ selected: active }}
                onPress={() => setCategory(c.key)}
                style={[
                  styles.categoryPill,
                  active && { borderColor: c.color, backgroundColor: c.color },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
              >
                <Text style={[styles.categoryPillText, { color: active ? '#0a0a0a' : c.color }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {category === 'colors' && <>
        <ColorScroll label="SKIN" colors={SKIN_TONES} value={appearance.skinTone} onSelect={color => update({ skinTone: color })} />
        <ColorScroll label="HAIR COLOR" colors={HAIR_COLORS} value={appearance.hairColor} onSelect={color => update({ hairColor: color })} />
        <ColorScroll label="EYES" colors={EYE_COLORS} value={appearance.eyeColor} onSelect={color => update({ eyeColor: color })} />
        <ColorScroll label="SHIRT" colors={SHIRT_COLORS} value={appearance.shirtColor} onSelect={color => update({ shirtColor: color })} />
        <ColorScroll label="PANTS" colors={PANTS_COLORS} value={appearance.pantsColor} onSelect={color => update({ pantsColor: color })} />
        <ColorScroll label="SHOES" colors={SHOE_COLORS} value={appearance.shoeColor} onSelect={color => update({ shoeColor: color })} />
        </>}

        {category === 'looks' && <>
        <ItemScroll label="HAIR STYLE" items={['flat', 'spiky', 'mohawk', 'long', 'curly', 'ponytail', 'cap', 'bald', 'buzzcut', 'afro', 'undercut', 'pigtails'].map(style => {
          const emojis: Record<string, string> = { flat: '➡️', spiky: '⬆️', mohawk: '🔱', long: '💇', curly: '🌀', ponytail: '🎀', cap: '🧢', bald: '🥚', buzzcut: '✂️', afro: '🟤', undercut: '💈', pigtails: '🎗️' };
          return { key: style, emoji: emojis[style], name: style.toUpperCase(), active: appearance.hairStyle === style };
        })} />
        <ItemScroll label="EXPRESSION" items={['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry', 'surprised', 'smirk', 'crying'].map(expression => {
          const emojis: Record<string, string> = { neutral: '😐', happy: '😊', focused: '🤨', sleepy: '😴', cool: '😎', angry: '😠', surprised: '😲', smirk: '😏', crying: '😢' };
          return { key: expression, emoji: emojis[expression], name: expression.toUpperCase(), active: appearance.expression === expression };
        })} />
        <ItemScroll label="FACIAL HAIR" items={['none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu', 'sideburns', 'soul_patch'].map(hair => {
          const emojis: Record<string, string> = { none: '🚫', stubble: '🔘', beard: '🧔', mustache: '👨', goatee: '🐐', fu_manchu: '🐉', sideburns: '🔲', soul_patch: '▪️' };
          const names: Record<string, string> = { none: 'NONE', stubble: 'STUBBLE', beard: 'BEARD', mustache: 'STACHE', goatee: 'GOATEE', fu_manchu: 'FU MANCHU', sideburns: 'BURNS', soul_patch: 'PATCH' };
          return { key: hair, emoji: emojis[hair], name: names[hair], active: (appearance.facialHair || 'none') === hair };
        })} />
        </>}

        {category === 'accessories' && <>
        <ItemScroll label="HAT" items={['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet', 'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'].map(hat => {
          const emojis: Record<string, string> = { none: '🚫', cap: '🧢', tophat: '🎩', beanie: '🧶', crown: '👑', helmet: '⛑️', horns: '😈', space_helmet: '🚀', wizard_hat: '🧙', halo: '😇', antenna: '👽', crab_helmet: '🦀', pirate_hat: '🏴‍☠️', cowboy_hat: '🤠', fez: '🎖️', mohawk_spikes: '🔩' };
          const names: Record<string, string> = { none: 'NONE', cap: 'CAP', tophat: 'TOP HAT', beanie: 'BEANIE', crown: 'CROWN', helmet: 'HELMET', horns: 'HORNS', space_helmet: 'SPACE', wizard_hat: 'WIZARD', halo: 'HALO', antenna: 'ANTENNA', crab_helmet: 'CRAB', pirate_hat: 'PIRATE', cowboy_hat: 'COWBOY', fez: 'FEZ', mohawk_spikes: 'SPIKES' };
          return { key: hat, emoji: emojis[hat], name: names[hat], active: appearance.hat === hat };
        })} />
        <ItemScroll label="ACCESSORY" items={['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing', 'visor_shades', 'gas_mask'].map(accessory => {
          const emojis: Record<string, string> = { none: '🚫', glasses: '👓', headphones: '🎧', bowtie: '🎀', scarf: '🧣', hoodie: '🧥', mask: '😷', monocle: '🧐', eyepatch: '🏴‍☠️', bandana: '🥷', chain: '⛓️', piercing: '💎', visor_shades: '🕶️', gas_mask: '☣️' };
          const names: Record<string, string> = { none: 'NONE', glasses: 'GLASSES', headphones: 'PHONES', bowtie: 'BOWTIE', scarf: 'SCARF', hoodie: 'HOODIE', mask: 'MASK', monocle: 'MONOCLE', eyepatch: 'PATCH', bandana: 'BANDANA', chain: 'CHAIN', piercing: 'PIERCE', visor_shades: 'VISOR', gas_mask: 'GAS MASK' };
          return { key: accessory, emoji: emojis[accessory], name: names[accessory], active: appearance.accessory === accessory };
        })} />
        <ItemScroll label="BACK ITEM" items={['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox'].map(item => {
          const emojis: Record<string, string> = { none: '🚫', cape: '🦸', backpack: '🎒', wings: '🪽', jetpack: '🚀', shield: '🛡️', sword: '⚔️', quiver: '🏹', crab_shell: '🦀', tentacles: '🐙', rocket: '🚀', scroll: '📜', boombox: '📻' };
          const names: Record<string, string> = { none: 'NONE', cape: 'CAPE', backpack: 'PACK', wings: 'WINGS', jetpack: 'JETPACK', shield: 'SHIELD', sword: 'SWORD', quiver: 'QUIVER', crab_shell: 'SHELL', tentacles: 'TENTACLES', rocket: 'ROCKET', scroll: 'SCROLL', boombox: 'BOOMBOX' };
          return { key: item, emoji: emojis[item], name: names[item], active: (appearance.backItem || 'none') === item };
        })} />
        <ItemScroll label="PET" items={['none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones'].map(pet => {
          const emojis: Record<string, string> = { none: '🚫', cat: '🐱', dog: '🐕', bird: '🐦', robot: '🤖', dragon: '🐉', alien: '👽', crab: '🦀', snake: '🐍', bat: '🦇', skull: '💀', mushroom: '🍄', spider: '🕷️', shark: '🦈', bones: '🦴' };
          const names: Record<string, string> = { none: 'NONE', cat: 'CAT', dog: 'DOG', bird: 'BIRD', robot: 'ROBOT', dragon: 'DRAGON', alien: 'ALIEN', crab: 'CRAB', snake: 'SNAKE', bat: 'BAT', skull: 'SKULL', mushroom: 'SHROOM', spider: 'SPIDER', shark: 'SHARK', bones: 'BONES' };
          return { key: pet, emoji: emojis[pet], name: names[pet], active: (appearance.pet || 'none') === pet };
        })} />
        <ItemScroll label="HAND ITEM" items={['none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand', 'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'].map(item => {
          const emojis: Record<string, string> = { none: '🚫', lightsaber: '⚔️', coffee: '☕', laptop: '💻', flag: '🚩', wand: '🪄', crab_claws: '🦞', sword_hand: '🗡️', pizza: '🍕', microphone: '🎤', torch: '🔦' };
          const names: Record<string, string> = { none: 'NONE', lightsaber: 'SABER', coffee: 'COFFEE', laptop: 'LAPTOP', flag: 'FLAG', wand: 'WAND', crab_claws: 'CLAWS', sword_hand: 'SWORD', pizza: 'PIZZA', microphone: 'MIC', torch: 'TORCH' };
          return { key: item, emoji: emojis[item], name: names[item], active: (appearance.handItem || 'none') === item };
        })} />
        </>}

        {category === 'aura' && <>
        <ItemScroll label="AURA" items={['none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'].map(aura => {
          const emojis: Record<string, string> = { none: '🚫', fire: '🔥', ice: '🧊', electric: '⚡', nature: '🌿', shadow: '🌑', rainbow: '🌈', glitch: '📟', cosmic: '✨', toxic: '☢️', holy: '🕊️', void: '🕳️', galaxy: '🌌' };
          const names: Record<string, string> = { none: 'NONE', fire: 'FIRE', ice: 'ICE', electric: 'BOLT', nature: 'LEAF', shadow: 'SHADOW', rainbow: 'RAINBOW', glitch: 'GLITCH', cosmic: 'COSMIC', toxic: 'TOXIC', holy: 'HOLY', void: 'VOID', galaxy: 'GALAXY' };
          const glowColors: Record<string, string> = { fire: '#ef4444', ice: '#6366f1', electric: '#f59e0b', nature: '#22c55e', shadow: '#6f6f6f', rainbow: '#a855f7', cosmic: '#6366f1', toxic: '#22c55e', holy: '#ffd700', galaxy: '#a855f7' };
          return { key: aura, emoji: emojis[aura], name: names[aura], active: (appearance.aura || 'none') === aura, glow: glowColors[aura] };
        })} />
        </>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 10,
    padding: 16,
  },
  body: {
    gap: 10,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    backgroundColor: '#0a0a0a',
  },
  saveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  saveLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: MONO,
  },
  preview: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    backgroundColor: '#0a0a0a',
    minHeight: 220,
    // Subtle checker-grid so small appearance changes are visually obvious.
    // Single-value backgroundPosition because RN Web's style validator
    // rejects the multi-value form; the checker still reads clearly because
    // each of the four gradients tiles on the same 16px grid.
    ...(Platform.OS === 'web' ? {
      backgroundImage:
        'linear-gradient(45deg, #0f0f18 25%, transparent 25%),' +
        'linear-gradient(-45deg, #0f0f18 25%, transparent 25%),' +
        'linear-gradient(45deg, transparent 75%, #0f0f18 75%),' +
        'linear-gradient(-45deg, transparent 75%, #0f0f18 75%)',
      backgroundSize: '16px 16px',
    } as any : {}),
  },
  previewInner: {
    // Inner container so the preview can be centered inside the grid bg
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  categoryPill: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    fontFamily: MONO,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
    marginBottom: 6,
    marginTop: 4,
  },
  scroll: {
    marginBottom: 4,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 2,
    borderColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: {
    borderColor: '#fff',
    transform: [{ scale: 1.08 }],
  },
  swatchCheck: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  itemCard: {
    width: 84,
    minHeight: 72,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginRight: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCardActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f115',
  },
  itemEmoji: {
    fontSize: 22,
    marginBottom: 6,
  },
  itemLabel: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  itemLabelActive: {
    color: '#fff',
  },
});
