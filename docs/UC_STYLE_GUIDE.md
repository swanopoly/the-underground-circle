# UC Style Guide — UC App Dark

> Clean product UI with depth, soft surfaces, and restrained accent color.
> The app should feel modern and lived-in, not monochrome-terminal and not pixel-gimmick.
> Indigo `#6366f1` remains the primary accent, with slate/blue surfaces doing most of the visual work.

---

## Core Principles

1. **App over terminal.** Default to polished product UI, not pure black-and-white command-line chrome.
2. **GitHub dark palette.** Backgrounds are `#0d1117` (page) and `#161b22` (surface). Borders are `#30363d`. Text fades from `#e6edf3` to `#8b949e` to `#484f58`.
3. **Soft corners.** `borderRadius: 8-16` on cards, buttons, inputs. `borderRadius: 999` on pills and badges. Full round on avatars and status dots.
4. **System font.** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. Monospace only for code blocks and terminal output.
5. **Subtle elevation.** Cards use a single soft shadow, not layered offset shadows. `boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 1px rgba(0,0,0,0.2)'`.
6. **Hover is a background shift,** not a dramatic lift. `backgroundColor` changes, border may brighten, no `translateY`.
7. **Indigo is the accent.** `#6366f1` for primary buttons, active states, progress bars, links. Used sparingly — most of the UI is neutral.
8. **Do not default to all-black with white 2px borders.** That older modal language is now legacy. Use tinted dark surfaces, low-contrast borders, and colored active states.

---

## Color Palette

### Backgrounds
| Token | Value | Use |
|---|---|---|
| `bg-canvas` | `#0d1117` | Page background, app shell |
| `bg-surface` | `#161b22` | Cards, panels, elevated containers |
| `bg-inset` | `#010409` | Input fields, code blocks, nested wells |
| `bg-overlay` | `#1c2128` | Dropdowns, popovers, tooltips |
| `bg-hover` | `#1c2128` | Hover state for list items and cards |
| `bg-active` | `#6366f115` | Active/selected item background tint |

### Borders
| Token | Value | Use |
|---|---|---|
| `border-default` | `#30363d` | Card borders, input borders, dividers |
| `border-muted` | `#21262d` | Subtle section dividers |
| `border-accent` | `#6366f1` | Active selection, focused inputs |

### Text
| Token | Value | Use |
|---|---|---|
| `text-primary` | `#e6edf3` | Headlines, body text, primary labels |
| `text-secondary` | `#8b949e` | Descriptions, secondary labels, meta |
| `text-muted` | `#484f58` | Placeholders, disabled, timestamps |
| `text-link` | `#6366f1` | Links, interactive text |

### Accent (indigo — UC signature)
| Token | Value | Use |
|---|---|---|
| `accent` | `#6366f1` | Primary buttons, active borders, progress bars |
| `accent-hover` | `#818cf8` | Button hover, link hover |
| `accent-muted` | `#6366f130` | Background tint for selected states |
| `accent-subtle` | `#6366f115` | Very light hover fills |

### Functional
| Token | Value | Use |
|---|---|---|
| `success` | `#3fb950` | Online, completed, positive |
| `warning` | `#d29922` | Idle, caution, pending |
| `danger` | `#f85149` | Error, offline, destructive |
| `info` | `#58a6ff` | Links, informational badges |

---

## Typography

```
SYSTEM FONT (all UI text):
  Web:     -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif
  iOS:     System
  Android: Roboto

MONOSPACE (code only):
  Web:     ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace

Page title:  fontSize: 20, fontWeight: '600', color: text-primary
Section:     fontSize: 16, fontWeight: '600', color: text-primary
Body:        fontSize: 14, fontWeight: '400', color: text-primary
Secondary:   fontSize: 14, fontWeight: '400', color: text-secondary
Small:       fontSize: 12, fontWeight: '400', color: text-secondary
Caption:     fontSize: 12, fontWeight: '500', color: text-muted
Badge:       fontSize: 12, fontWeight: '500', monospace for counts
```

---

## Borders & Corners

```
borderRadius: 6     — Cards, buttons, inputs, panels, modals
borderRadius: 20    — Pills, badges, tags, chips
borderRadius: 9999  — Avatars, status dots, round buttons

borderWidth: 1      — Everything. GitHub uses 1px borders exclusively.
```

---

## Buttons

### Primary (indigo)
```
backgroundColor: '#6366f1'
borderWidth: 0
borderRadius: 6
color: '#ffffff'
fontSize: 14
fontWeight: '600'
paddingVertical: 8
paddingHorizontal: 16
— hover: backgroundColor '#818cf8'
— press: backgroundColor '#4f46e5'
— disabled: opacity 0.5
```

### Secondary (outline)
```
backgroundColor: '#21262d'
borderWidth: 1
borderColor: '#30363d'
borderRadius: 6
color: '#e6edf3'
fontSize: 14
fontWeight: '600'
— hover: backgroundColor '#30363d', borderColor '#8b949e'
— press: backgroundColor '#161b22'
```

### Danger
```
Same as secondary but:
color: '#f85149'
— hover: backgroundColor '#f8514915', borderColor '#f85149', color '#ff7b72'
```

### Ghost / link
```
backgroundColor: transparent
borderWidth: 0
color: '#6366f1'
— hover: color '#818cf8', textDecoration underline
```

---

## Inputs

```
backgroundColor: '#0d1117'
borderWidth: 1
borderColor: '#30363d'
borderRadius: 6
color: '#e6edf3'
fontSize: 14
paddingHorizontal: 12
paddingVertical: 8
placeholderTextColor: '#484f58'
— focus: borderColor '#6366f1', boxShadow '0 0 0 3px rgba(99,102,241,0.3)'
— web: outlineStyle 'none'
```

---

## Cards

### Standard card
```
backgroundColor: '#111827'
borderWidth: 1
borderColor: '#1f2937'
borderRadius: 16
padding: 16
— web: boxShadow '0 1px 3px rgba(0,0,0,0.12)'
— hover: borderColor '#8b949e'
```

### Featured card (profile hero, pinned items)
```
backgroundColor: '#0f172a'
borderWidth: 1
borderColor: '#312e81'
borderRadius: 16
padding: 24
— web: boxShadow '0 2px 8px rgba(0,0,0,0.2), 0 0 0 1px rgba(99,102,241,0.1)'
```

### Stat card
```
backgroundColor: '#161b22'
borderWidth: 1
borderColor: '#30363d'
borderRadius: 6
padding: 16
— center aligned, compact
— number: fontSize 24, fontWeight '600', color text-primary
— label: fontSize 12, fontWeight '500', color text-secondary
```

### Modal
```
backgroundColor: '#111827'
borderWidth: 1
borderColor: '#1f2937'
borderRadius: 12
padding: 24
— web: boxShadow '0 8px 24px rgba(0,0,0,0.4)'
— scrim: backgroundColor 'rgba(0,0,0,0.5)'
```

---

## Explicit Anti-Pattern

Do not ship new UI with this default treatment unless a surface is intentionally a terminal or code console:

```
backgroundColor: '#000'
borderWidth: 2
borderColor: '#fff'
borderRadius: 2
fontFamily: 'monospace' for all text
primary buttons: white fill / black text
```

That style is too rigid for most app surfaces and makes dashboards, forms, and productivity views feel detached from the rest of the product.

---

## Hover & Press

Interactive elements:
```tsx
style={({ hovered, pressed }: any) => [
  baseStyle,
  Platform.OS === 'web' && { transition: 'all 0.2s ease' },
  hovered && { backgroundColor: '#1c2128' },
  pressed && { backgroundColor: '#21262d' },
]}
```

Cards:
```tsx
hovered && { borderColor: '#8b949e' }
```

Buttons:
```tsx
// Primary
hovered && { backgroundColor: '#818cf8' }
// Secondary
hovered && { backgroundColor: '#30363d', borderColor: '#8b949e' }
```

---

## Badges & Pills

```
backgroundColor: '#6366f120'
borderRadius: 20
paddingHorizontal: 10
paddingVertical: 3
— text: fontSize 12, fontWeight '600', color '#6366f1'
```

Status badges use functional colors:
```
success: bg '#3fb95020', color '#3fb950'
warning: bg '#d2992220', color '#d29922'
danger:  bg '#f8514920', color '#f85149'
```

---

## Avatars

```
borderRadius: 9999 (fully round)
borderWidth: 1
borderColor: '#30363d'
```

Sizes: 20 (inline), 32 (list), 48 (card), 80 (profile hero)

---

## Section Dividers

```
height: 1
backgroundColor: '#21262d'
marginVertical: 16
```

---

## Spacing

Follow a 4px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Card padding: 16
- Section gap: 16-24
- List item padding: 12-16
- Inline gap: 8-12
- Page horizontal padding: 16-24 mobile, 32-48 desktop

---

## Don'ts

- No pixel-art offset shadows (`4px 4px 0px`) — use subtle CSS elevation only
- No `borderRadius: 2` — minimum is 6 for containers, 20 for pills
- No `letterSpacing` above 1 on body text (subtle on labels is fine)
- No `fontWeight: '900'` — max is '700', prefer '600' for most UI
- No colored backgrounds on structural cards — only `#161b22`
- No indigo borders on inactive elements — only on active/selected/focused
- No heavy glows or `perspective` transforms on standard cards
- No monospace outside of code blocks, terminal, and agent session data
- No emojis in structural UI (section headers, labels, buttons)
