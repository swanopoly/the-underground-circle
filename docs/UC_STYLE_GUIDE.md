# UC App Style Guide — Black & White Terminal Aesthetic

> The definitive visual language for The Underground Circle.
> Combines the Spawn Agents modal (pure B&W, sharp, monospace) with the
> Assign Agent panel (warm selection tints, status dots, agent identity).
> All agents and contributors MUST follow this guide for new UI.

---

## Core Principles

1. **Black canvas, white structure.** Background is `#000`. Borders are white or gray. Color is reserved for MEANING — status, selection, agent identity.
2. **Sharp, not rounded.** `borderRadius: 2` everywhere. No rounded corners (10px, 12px, 14px). Exception: status dots (fully round) and agent avatars (round).
3. **Monospace is the voice.** `fontFamily: 'monospace'` on ALL text. Headers use heavy `letterSpacing: 2-3`. Labels use `letterSpacing: 1.5`.
4. **Weight communicates hierarchy.** `fontWeight: '900'` for labels, headers, buttons. `'700'` for body text. Never use '400' or '500'.
5. **Hover is mandatory on web.** Every Pressable gets `transition: all 0.15s ease`, a hover state (border brightens + subtle lift), and a press state (scale squeeze).
6. **Color is functional, not decorative.** White = primary. Grays = secondary. Color appears ONLY for: status indicators, agent identity tints, active selection, success/error states.

---

## Color Palette

### Neutrals (the 90%)
| Token | Value | Use |
|---|---|---|
| `bg-primary` | `#000000` | Card/modal/page backgrounds |
| `bg-inset` | `#0a0a0a` | Input fields, nested containers |
| `bg-surface` | `#111111` | Elevated surfaces, active states |
| `border-subtle` | `#222222` | Dividers, inactive borders |
| `border-default` | `#333333` | Input borders, section borders |
| `border-strong` | `#ffffff` | Card outlines, active selection, CTA borders |
| `text-primary` | `#ffffff` | Headers, labels, primary content |
| `text-secondary` | `#888888` | Section labels, descriptions |
| `text-muted` | `#555555` | Placeholders, disabled text, hints |
| `text-ghost` | `#333333` | Divider text, footnotes |

### Functional colors (the 10%)
| Token | Value | When |
|---|---|---|
| `status-active` | `#22c55e` | Online, success, completed |
| `status-building` | `#6366f1` | In progress, processing |
| `status-idle` | `#f59e0b` | Waiting, warning, amber |
| `status-error` | `#ef4444` | Failed, offline, destructive |
| `accent-cyan` | `#22d3ee` | Primary accent (links, active UI) |
| `agent-color` | per-agent | Agent identity tint (used at 10-20% opacity for selection bg) |

---

## Typography

```
ALL TEXT: fontFamily: 'monospace'

Headers:    fontSize: 14-16, fontWeight: '900', letterSpacing: 3, color: #fff
Labels:     fontSize: 10-11, fontWeight: '900', letterSpacing: 1.5-2, color: #888
Body:       fontSize: 12-13, fontWeight: '700', color: #fff or #ccc
Hints:      fontSize: 9-10, fontWeight: '700', color: #555
Buttons:    fontSize: 11-12, fontWeight: '900', letterSpacing: 1-2, color: #000 (primary) or #888 (ghost)
```

No emojis in structural UI. Use text-glyph icons (`//`, `>_`, `+`, `x`, `ESC`) inside small bordered boxes instead.

---

## Borders & Corners

```
borderRadius: 2           — EVERYWHERE. Cards, buttons, inputs, pills, toggles.
borderWidth: 2            — Cards, CTAs, active selections, modal outlines.
borderWidth: 1            — Inputs, secondary buttons, dividers, ghost elements.

Exception: status dots     — fully round (borderRadius: 999)
Exception: agent avatars   — fully round
```

---

## Buttons

### Primary CTA
```
backgroundColor: '#fff'
borderColor: '#fff'
borderWidth: 2
borderRadius: 2
color: '#000'
fontWeight: '900'
letterSpacing: 2
— full width when possible
— hover: backgroundColor '#e0e0e0', boxShadow '0 0 20px rgba(255,255,255,0.25)'
— press: scale(0.98)
```

### Ghost / Secondary
```
backgroundColor: '#000'
borderColor: '#333'
borderWidth: 1
borderRadius: 2
color: '#888'
fontWeight: '900'
letterSpacing: 1
— hover: borderColor '#888', backgroundColor '#111'
— press: scale(0.96)
```

### Destructive
```
Same as ghost but:
color: '#ef4444'
— hover: borderColor '#ef4444', backgroundColor '#1a0a0a'
```

---

## Inputs

```
backgroundColor: '#0a0a0a'
borderColor: '#333'
borderWidth: 1
borderRadius: 2
color: '#fff'
fontSize: 12-13
fontFamily: 'monospace'
paddingHorizontal: 14
paddingVertical: 10-12
placeholderTextColor: '#555'
— web: outlineStyle: 'none'
— focus: borderColor '#888' (subtle, not bright)
```

---

## Selection States

### Pill / chip selection (e.g., agent picker, count selector)
```
INACTIVE:
  borderColor: '#222'
  backgroundColor: '#000'
  text color: '#666'

ACTIVE:
  borderColor: '#fff'
  backgroundColor: '#fff'
  text color: '#000'
  — inverted: black text on white background

HOVER (inactive only):
  borderColor: '#888'
  backgroundColor: '#1a1a1a'
  transform: translateY(-1)
```

### Agent-tinted selection (e.g., assign agent, soul picker)
```
INACTIVE: same as pill
ACTIVE:
  borderColor: agentColor + '70'   (e.g., '#22c55e70')
  backgroundColor: agentColor + '15'
  text color: agentColor
```

---

## Cards & Modals

### Modal card
```
backgroundColor: '#000'
borderWidth: 2
borderColor: '#fff'
borderRadius: 2
padding: 24
gap: 16
— web: boxShadow '0 0 60px rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.15)'
```

### Scrim
```
backgroundColor: 'rgba(0,0,0,0.85)'
```

### Inline panel (e.g., assign agent in chat)
```
backgroundColor: '#000'
borderWidth: 1
borderColor: '#222'
borderRadius: 2
padding: 14-16
```

### Section divider
```
height: 1
backgroundColor: '#222'
```

---

## Hover & Press (web)

ALL interactive elements must have:
```tsx
style={({ hovered, pressed }: any) => [
  baseStyle,
  Platform.OS === 'web' && { transition: 'all 0.15s ease' },
  hovered && { borderColor: '#888', backgroundColor: '#111', transform: [{ translateY: -1 }] },
  pressed && { transform: [{ scale: 0.96 }] },
]}
```

For primary CTAs:
```tsx
hovered && { backgroundColor: '#e0e0e0', boxShadow: '0 0 20px rgba(255,255,255,0.25)' }
pressed && { backgroundColor: '#ccc', transform: [{ scale: 0.98 }] }
```

---

## Icon Blocks

Replace emojis with monospace text in bordered boxes:
```
width: 24-40
height: 24-40
borderRadius: 2
borderWidth: 2
borderColor: '#fff' or '#333'
backgroundColor: '#000'
alignItems: 'center'
justifyContent: 'center'

Text inside: fontSize 11-16, fontWeight '900', color '#fff', fontFamily 'monospace'

Examples: '//', '>_', '+', '#', '[]', 'N', 'x', 'ESC'
```

---

## Status Indicators

Small colored dots:
```
width: 6-8
height: 6-8
borderRadius: 999
backgroundColor: status color
```

Status badge text:
```
fontSize: 9-10
fontWeight: '900'
letterSpacing: 0.5-1
fontFamily: 'monospace'
color: status color
borderWidth: 1
borderColor: status color
borderRadius: 2
paddingHorizontal: 6
paddingVertical: 2
```

---

## Result / Feedback Banners

### Success
```
borderWidth: 2
borderColor: '#fff'
backgroundColor: '#111'
— icon: '//' in white
```

### Error
```
borderWidth: 2
borderColor: '#666'
backgroundColor: '#0a0a0a'
— icon: '!!' in white
```

### Info text inside banners
```
Title: color '#fff', fontWeight '900', letterSpacing 2
Message: color '#888', fontSize 11
```

---

## Don'ts

- No `borderRadius` above 2 (except status dots and avatars)
- No emojis in headers, labels, buttons, or section titles
- No background colors other than #000, #0a0a0a, #111 for structural elements
- No `fontFamily` other than `'monospace'`
- No font weights below '700'
- No inline styles without hover states on web Pressables
- No colored borders for inactive/non-functional elements
- No blur effects or gradients
- No `opacity` below 0.3 for disabled states (use 0.3 flat)
