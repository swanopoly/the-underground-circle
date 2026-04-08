# Design Techniques Reference (2025-2026)

> **Purpose**: Actionable reference for AI coding agents building modern web and mobile UIs. Every technique includes what it is, why it matters, how to implement it, and real-world examples.
>
> **Last Updated**: April 2026

---

## Table of Contents

1. [Visual Design Trends](#1-visual-design-trends-2025-2026)
2. [CSS & Layout Techniques](#2-css--layout-techniques)
3. [React & React Native Patterns](#3-react--react-native-patterns)
4. [Animation & Motion](#4-animation--motion)
5. [Accessibility & Performance](#5-accessibility--performance)
6. [Design Systems](#6-design-systems)
7. [AI-Specific UI Patterns](#7-ai-specific-ui-patterns)

---

## 1. Visual Design Trends 2025-2026

### 1.1 Glassmorphism & Apple's Liquid Glass

**What it is**: Frosted-glass UI elements with background blur, transparency, and subtle borders. Apple's "Liquid Glass" (introduced at WWDC 2025) is the evolved form — translucent surfaces that dynamically react to movement with specular highlights and light refraction.

**Why it's trending**: Apple's adoption across iOS 26, iPadOS 26, and macOS Tahoe 26 made it the dominant visual language. GPUs in mid-range devices now handle backdrop-filter with ease, making it production-viable.

**Status**: Glassmorphism is the single most relevant "-morphism" in 2026. Neomorphism has faded due to accessibility concerns (low contrast). Claymorphism remains niche for playful/3D-heavy brands.

**How to implement**:

```css
/* Basic Glassmorphism Card */
.glass-card {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* Enhanced Liquid Glass Effect */
.liquid-glass {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 20px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    0 4px 30px rgba(0, 0, 0, 0.1);
  /* Simulate light refraction */
  mix-blend-mode: normal;
}

/* CRITICAL: Always ensure text contrast over glass */
.glass-card .text-content {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
```

**Accessibility warning**: Semi-transparent layers over complex imagery create serious contrast issues. Always add text shadows or darkened overlays behind text on glass surfaces.

**Examples**: Apple iOS 26 system UI, Linear app, Vercel dashboard

---

### 1.2 Dark Mode Design

**What it is**: A UI color scheme using dark backgrounds with light text and UI elements.

**Why it's trending**: Reduces eye strain, saves battery on OLED screens, and is now expected by users as a baseline feature. 96.7% browser support for `prefers-color-scheme` as of 2025.

**How to implement**:

```css
/* Step 1: Define tokens as CSS custom properties */
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f7;
  --bg-elevated: #ffffff;
  --text-primary: #1d1d1f;
  --text-secondary: #6e6e73;
  --border-color: rgba(0, 0, 0, 0.1);
  --shadow: rgba(0, 0, 0, 0.08);
}

/* Step 2: Auto-detect system preference */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0f172a;      /* NOT pure black — avoids OLED halation */
    --bg-secondary: #1e293b;
    --bg-elevated: #1e293b;
    --text-primary: #f1f5f9;
    --text-secondary: #94a3b8;
    --border-color: rgba(255, 255, 255, 0.1);
    --shadow: rgba(0, 0, 0, 0.3);
  }
}

/* Step 3: Manual toggle override via data attribute */
[data-theme="dark"] {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-elevated: #1e293b;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --border-color: rgba(255, 255, 255, 0.1);
  --shadow: rgba(0, 0, 0, 0.3);
}
```

```javascript
// JavaScript: Toggle + persist preference
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}
```

**Best practices**:
- Never use pure black (`#000000`) — use dark grays like `#0f172a` or `#1a1a2e`
- Reduce white text opacity slightly (`#e2e8f0` instead of `#ffffff`) for less glare
- Provide both auto-detection AND a manual toggle
- Persist the user's choice in `localStorage`
- Use `<picture>` with `media="(prefers-color-scheme: dark)"` for images that need different versions

**Examples**: GitHub, Stripe docs, Linear, every major SaaS app

---

### 1.3 Bento Grid Layouts

**What it is**: Modular layouts inspired by Japanese bento boxes — asymmetric, varying-sized cards with rounded corners organized in a grid. 67% of top 100 SaaS websites on ProductHunt now use some form of bento layout.

**Why it's trending**: Creates "glanceable" interfaces that increase dwell time by 47% and click-through rates by 38%. Perfect for feature showcases, dashboards, and landing pages.

**How to implement**:

```css
/* CSS Grid Bento Layout */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: auto;
  gap: 16px;
  padding: 16px;
}

.bento-card {
  background: var(--bg-elevated);
  border-radius: 16px;        /* 2026 trend: 12-24px radius */
  padding: 24px;
  overflow: hidden;
}

/* Spanning cards for visual hierarchy */
.bento-card--wide { grid-column: span 2; }
.bento-card--tall { grid-row: span 2; }
.bento-card--hero { grid-column: span 2; grid-row: span 2; }

/* Responsive: Stack on mobile */
@media (max-width: 768px) {
  .bento-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .bento-card--wide,
  .bento-card--hero {
    grid-column: span 2;
  }
}

@media (max-width: 480px) {
  .bento-grid {
    grid-template-columns: 1fr;
  }
  .bento-card--wide,
  .bento-card--tall,
  .bento-card--hero {
    grid-column: span 1;
    grid-row: span 1;
  }
}
```

```jsx
// React Bento Grid Component
function BentoGrid({ children }) {
  return <div className="bento-grid">{children}</div>;
}

function BentoCard({ size = 'default', children }) {
  const sizeClasses = {
    default: '',
    wide: 'bento-card--wide',
    tall: 'bento-card--tall',
    hero: 'bento-card--hero',
  };
  return (
    <div className={`bento-card ${sizeClasses[size]}`}>
      {children}
    </div>
  );
}
```

**2026 evolution ("Bento 2.0")**: Exaggerated corner rounding, micro-interaction hover states on each card, and "Agentic Bento" where grid layouts are dynamically generated by AI based on content importance.

**Examples**: Apple feature pages, Linear, Stripe, Vercel, Notion

---

### 1.4 Neubrutalism / Anti-Design

**What it is**: A rebellious aesthetic that rejects polished, soft-shadowed "Clean UI" in favor of high contrast, bold typography, thick borders, sharp shadows, and clashing colors. A modern reinterpretation of Brutalist architecture principles.

**Why it's trending**: Stands out in a sea of identical SaaS designs. Communicates boldness, creativity, and authenticity. Figma's conference branding and Gumroad's redesign popularized it.

**Key characteristics**:
- **Shadows**: Sharp, no-blur, offset black rectangles (e.g., `box-shadow: 4px 4px 0 #000`)
- **Borders**: Thick, solid, black (`border: 3px solid #000`)
- **Colors**: High contrast, often clashing primaries
- **Typography**: Oversized, grotesque/sans-serif, often monospaced
- **Corners**: Either perfectly square or moderately rounded

**How to implement**:

```css
/* Neubrutalist Button */
.btn-brutal {
  background: #ffe14d;
  color: #000000;
  border: 3px solid #000000;
  border-radius: 0;
  padding: 12px 24px;
  font-family: 'Space Mono', monospace;
  font-weight: 700;
  font-size: 1rem;
  text-transform: uppercase;
  box-shadow: 4px 4px 0 #000000;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}

.btn-brutal:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0 #000000;
}

.btn-brutal:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0 #000000;
}

/* Neubrutalist Card */
.card-brutal {
  background: #ffffff;
  border: 3px solid #000000;
  border-radius: 0;
  padding: 24px;
  box-shadow: 6px 6px 0 #000000;
}
```

**2026 evolution**: "Soft Brutalism" — rounded corners and pastel colors combined with thick borders and sharp shadows, creating a friendlier but still bold aesthetic.

**Examples**: Figma Config branding, Gumroad, many indie/creative agency sites

---

### 1.5 Typography Trends

**What it is**: Typography in 2026 has become a primary design element, not just a text delivery mechanism. Three dominant approaches: variable fonts, kinetic/animated type, and oversized hero typography.

**Variable Fonts**:

```css
/* Variable font with multiple axes */
@font-face {
  font-family: 'Inter Variable';
  src: url('/fonts/Inter-Variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-display: swap;
}

body {
  font-family: 'Inter Variable', system-ui, sans-serif;
  font-weight: 400;
  /* Optical sizing — adjusts detail for different sizes */
  font-optical-sizing: auto;
}

h1 {
  font-weight: 800;
  font-variation-settings: 'wdth' 110;   /* Width axis */
}

/* Responsive weight adjustments for accessibility */
@media (prefers-contrast: high) {
  body {
    font-weight: 500;
    font-variation-settings: 'wght' 500, 'opsz' 20;
  }
}
```

**Why variable fonts matter**:
- Single file replaces 6-10 font files — faster load times
- Smooth animations between weights/widths
- Dynamic accessibility adjustments via `prefers-contrast`
- Now the default for digital-first brands

**Kinetic Typography (CSS animations)**:

```css
/* Text reveal animation */
.kinetic-text {
  overflow: hidden;
}

.kinetic-text span {
  display: inline-block;
  transform: translateY(100%);
  animation: slideUp 0.6s ease-out forwards;
}

@keyframes slideUp {
  to { transform: translateY(0); }
}

/* Stagger children for word-by-word reveal */
.kinetic-text span:nth-child(2) { animation-delay: 0.1s; }
.kinetic-text span:nth-child(3) { animation-delay: 0.2s; }
.kinetic-text span:nth-child(4) { animation-delay: 0.3s; }
```

**Examples**: Apple.com hero sections, Stripe typography, Linear marketing pages

---

### 1.6 Color Trends

**Dominant palettes for 2025-2026**:

| Trend | Description | Use Case |
|-------|-------------|----------|
| **Neon-on-dark** | Bright saturated accents (#00ff88, #7c3aed) on near-black backgrounds | Developer tools, gaming, creative apps |
| **Nature distilled** | Muted earth tones (sage, terracotta, sand) | Wellness, sustainability, lifestyle |
| **Gradient meshes** | Multi-point gradients with organic color transitions | Hero sections, backgrounds, branding |
| **Vibrant systems** | Cohesive multi-color palettes (5-7 colors working together) | Dashboards, data visualization, SaaS |
| **Duotone** | Two-color overlays on photography/imagery | Blog headers, hero images |

```css
/* Mesh Gradient Background */
.mesh-gradient {
  background:
    radial-gradient(at 20% 80%, hsla(210, 100%, 70%, 0.3) 0px, transparent 50%),
    radial-gradient(at 80% 20%, hsla(280, 100%, 70%, 0.3) 0px, transparent 50%),
    radial-gradient(at 50% 50%, hsla(340, 100%, 70%, 0.2) 0px, transparent 50%),
    hsl(220, 20%, 10%);
}

/* Animated Gradient */
.animated-gradient {
  background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
  background-size: 400% 400%;
  animation: gradientShift 15s ease infinite;
}

@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* Neon Glow Effect */
.neon-accent {
  color: #00ff88;
  text-shadow:
    0 0 7px #00ff88,
    0 0 10px #00ff88,
    0 0 21px #00ff88;
}
```

---

### 1.7 3D Elements & WebGL in UI

**What it is**: Subtle 3D elements, interactive models, and shader effects integrated into traditional 2D interfaces. Not full 3D scenes, but 3D as an enhancement layer.

**Why it's trending**: WebGPU reached universal browser support in September 2025 (Safari 26 was the last holdout). React Three Fiber makes 3D accessible to React developers. Performance gains of 2-10x over WebGL for complex scenes.

**Key tools**:
- **Three.js** — The standard 3D library (now with TSL shader language and WebGPU support)
- **React Three Fiber** — React renderer for Three.js
- **Spline** — No-code 3D design tool with React export
- **WebGPU** — Next-gen GPU API replacing WebGL (2-10x performance)

```jsx
// React Three Fiber — Interactive 3D element in UI
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Float } from '@react-three/drei';

function Hero3D() {
  return (
    <div style={{ height: '400px', width: '100%' }}>
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} />
        <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
          <mesh>
            <torusKnotGeometry args={[1, 0.3, 128, 32]} />
            <meshStandardMaterial
              color="#7c3aed"
              roughness={0.2}
              metalness={0.8}
            />
          </mesh>
        </Float>
        <OrbitControls enableZoom={false} autoRotate />
      </Canvas>
    </div>
  );
}
```

**Examples**: Stripe's globe, Linear's 3D icons, Vercel's gradient meshes, GitHub Universe site

---

### 1.8 AI-Generated Visuals in UI

**What it is**: Using AI to generate or personalize UI visuals — from dynamic hero images to personalized illustrations to generative backgrounds.

**Why it's trending**: Reduces design asset production time, enables personalization at scale, and creates unique visual identities.

**Practical applications**:
- Generative backgrounds/patterns unique to each user session
- AI-generated placeholder imagery during development
- Dynamic illustration systems that respond to content
- Personalized dashboard themes based on user behavior

---

## 2. CSS & Layout Techniques

### 2.1 Container Queries

**What it is**: Style elements based on the size of their container rather than the viewport. Makes components truly portable and self-contained.

**Why it's trending**: Replaced 600+ lines of media query overrides for reusable components. Essential for component-driven design systems.

**How to implement**:

```css
/* Step 1: Establish a containment context */
.card-wrapper {
  container-type: inline-size;
  container-name: card;
}

/* Step 2: Query the container's size */
@container card (min-width: 400px) {
  .card {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 16px;
  }
}

@container card (min-width: 700px) {
  .card {
    grid-template-columns: 300px 1fr 200px;
  }
  .card__actions {
    flex-direction: column;
  }
}

/* Container query units — relative to the container */
.card__title {
  font-size: clamp(1rem, 3cqi, 1.5rem);   /* cqi = container query inline */
}
```

**Browser support**: Baseline in all modern browsers since February 2023.

**Examples**: Every modern component library, Shopify storefront components

---

### 2.2 The `:has()` Selector

**What it is**: A parent/relational selector — style an element based on what it contains. Often called the "parent selector" CSS developers waited decades for.

**How to implement**:

```css
/* Style a form group when its input is focused */
.form-group:has(input:focus) {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Card layout changes when it contains an image */
.card:has(img) {
  grid-template-rows: 200px 1fr;
}

.card:not(:has(img)) {
  grid-template-rows: 1fr;
}

/* Style a label when its associated checkbox is checked */
label:has(input[type="checkbox"]:checked) {
  background: #dbeafe;
  border-color: #3b82f6;
}

/* Global: add padding when a dialog is open */
body:has(dialog[open]) {
  overflow: hidden;
}
```

**Browser support**: Baseline since December 2023.

---

### 2.3 CSS Nesting

**What it is**: Write nested CSS rules natively without preprocessors like Sass/SCSS.

**Why it's trending**: Eliminates the need for Sass in many projects. Cleaner, more organized stylesheets.

```css
/* Native CSS Nesting */
.card {
  background: var(--bg-elevated);
  border-radius: 12px;
  padding: 24px;

  & .card__title {
    font-size: 1.25rem;
    font-weight: 600;
  }

  & .card__body {
    margin-top: 12px;
    color: var(--text-secondary);
  }

  &:hover {
    box-shadow: 0 4px 12px var(--shadow);
  }

  /* Nested media query */
  @media (min-width: 768px) {
    padding: 32px;
  }
}
```

**Browser support**: Baseline since August 2023. Can be confidently used in production.

---

### 2.4 View Transitions API

**What it is**: Native browser API for animated transitions between DOM states (same-page) or between pages (cross-document). GPU-accelerated with minimal overhead.

**Why it's trending**: Replaces heavyweight JS animation libraries for page transitions. Apps feel 2-3x snappier on low-end devices. Same-document transitions reached Baseline in October 2025.

**How to implement**:

```css
/* Cross-document view transitions (no JS needed) */
@view-transition {
  navigation: auto;
}

/* Name elements that should persist across transitions */
.hero-image {
  view-transition-name: hero;
}

.page-title {
  view-transition-name: title;
}

/* Customize the transition animation */
::view-transition-old(hero) {
  animation: fadeOut 0.3s ease-out;
}

::view-transition-new(hero) {
  animation: fadeIn 0.3s ease-in;
}

/* Default crossfade for the entire page */
::view-transition-old(root) {
  animation: fadeOut 0.25s ease-out;
}
::view-transition-new(root) {
  animation: fadeIn 0.25s ease-in;
}
```

```jsx
// React/Next.js: View Transitions with <ViewTransition>
// next.config.js: { experimental: { viewTransition: true } }

import { ViewTransition } from 'react';
import { unstable_ViewTransition as ViewTransition } from 'react';

function ProductCard({ product }) {
  return (
    <ViewTransition name={`product-${product.id}`}>
      <Link href={`/product/${product.id}`}>
        <img src={product.image} alt={product.name} />
        <h3>{product.name}</h3>
      </Link>
    </ViewTransition>
  );
}
```

**Next.js setup**: Set `viewTransition: true` in `next.config.js`. Route navigations automatically trigger `<ViewTransition>` animations.

**Examples**: Next.js apps, Chrome's settings pages, many SPAs replacing Framer Motion page transitions

---

### 2.5 Scroll-Driven Animations

**What it is**: CSS-native animations tied to scroll position rather than time. Two types: `scroll()` (linked to scroll container position) and `view()` (linked to element visibility in viewport).

**Why it's trending**: Replaces IntersectionObserver + JS scroll handlers. Runs off the main thread for 60fps performance. Production-ready with cross-browser support (Chrome 115+, Firefox, Safari).

**How to implement**:

```css
/* Progress bar that fills as page scrolls */
.progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: #3b82f6;
  width: 100%;
  transform-origin: left;
  animation: scaleProgress linear;
  animation-timeline: scroll();
}

@keyframes scaleProgress {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* Fade-in elements as they enter the viewport */
.reveal {
  animation: fadeInUp linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(50px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Parallax effect — pure CSS */
.parallax-layer {
  animation: parallax linear;
  animation-timeline: scroll();
}

@keyframes parallax {
  from { transform: translateY(0); }
  to { transform: translateY(-100px); }
}
```

**Key considerations**:
- Always provide a non-animated fallback for browsers that don't support it
- Respect `prefers-reduced-motion`
- Use `animation-range` to control when animations start/end relative to viewport

---

### 2.6 CSS Subgrid

**What it is**: Allows a grid child to adopt its parent grid's track sizing, ensuring nested content aligns to the parent grid lines.

**Why it's trending**: Solves the decades-old problem of aligning content across cards of different content lengths (e.g., card titles, descriptions, and buttons all lining up).

```css
/* Parent Grid */
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

/* Card inherits parent's column tracks */
.card {
  display: grid;
  grid-template-rows: subgrid;
  grid-row: span 3;             /* Span 3 row tracks: title, body, footer */
  border-radius: 12px;
  overflow: hidden;
}

/* Content aligns perfectly across all cards */
.card__title { /* Row 1 */ }
.card__body  { /* Row 2 */ }
.card__footer { /* Row 3 */ }
```

**Browser support**: All major browsers — Chrome 117+, Edge 117+, Firefox 71+, Safari 16+.

---

### 2.7 Anchor Positioning

**What it is**: Position elements relative to other elements without JavaScript. CSS-native tooltips, popovers, and dropdowns.

```css
/* The anchor element */
.trigger {
  anchor-name: --menu-trigger;
}

/* Positioned relative to the anchor */
.tooltip {
  position: fixed;
  position-anchor: --menu-trigger;
  inset-area: top;               /* Position above the anchor */
  margin-bottom: 8px;
}

/* Fallback with @supports for graceful degradation */
@supports not (anchor-name: --x) {
  .tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
  }
}
```

**Status**: Emerging — pair with `@supports` guards for progressive enhancement. Chrome 125+ supports it.

---

### 2.8 CSS Cascade Layers (@layer)

**What it is**: Explicit control over CSS cascade order, independent of selector specificity. Layers declared earlier have lower priority than layers declared later.

**Why it's trending**: Eliminates `!important` hacks and specificity wars, especially when integrating third-party CSS (Tailwind, component libraries, etc.).

```css
/* Declare layer order up front */
@layer normalize, vendors, base, components, utilities, overrides;

/* Import third-party CSS into layers */
@import url('normalize.css') layer(normalize);
@import url('vendor-library.css') layer(vendors);

/* Base styles */
@layer base {
  body {
    font-family: var(--font-sans);
    color: var(--text-primary);
  }
  a { color: var(--color-link); }
}

/* Components — beats base regardless of specificity */
@layer components {
  .btn {
    padding: 8px 16px;
    border-radius: 8px;
  }
}

/* Utilities — highest priority among layers */
@layer utilities {
  .hidden { display: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; }
}
```

**Browser support**: Universal — over 96% global support since 2022.

---

### 2.9 CSS @scope

**What it is**: Apply styles only within a defined DOM subtree without coupling selectors to fragile structure.

```css
@scope (.card) to (.card__footer) {
  /* Styles apply inside .card but NOT inside .card__footer */
  p {
    color: var(--text-secondary);
    line-height: 1.6;
  }
  a {
    color: var(--color-link);
    text-decoration: underline;
  }
}
```

**Why it matters**: True component-scoped styles without CSS Modules, styled-components, or BEM naming. The platform's answer to style encapsulation.

---

### 2.10 Scroll-State Container Queries

**What it is**: New in 2026 — style descendants based on whether a scroll container is stuck, snapped, or overflowing.

```css
.sticky-header {
  container-type: scroll-state;
}

/* Style changes when the header is stuck */
@container scroll-state(stuck: top) {
  .sticky-header {
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(12px);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
}
```

---

## 3. React & React Native Patterns

### 3.1 React Server Components (RSC)

**What it is**: Components that render on the server and send HTML to the client with zero JavaScript bundle cost. The default in Next.js App Router.

**Why it's trending**: Dramatically reduces client-side JavaScript, improves initial load times, and allows direct database/API access in components.

**Key patterns**:

```jsx
// Pattern 1: Static Shell + Dynamic Islands
// layout.tsx — Server Component (no "use client")
export default function Layout({ children }) {
  return (
    <div className="app-shell">
      <Sidebar />          {/* Server Component: 0 JS shipped */}
      <main>
        <Suspense fallback={<DashboardSkeleton />}>
          {children}        {/* Streamed progressively */}
        </Suspense>
      </main>
    </div>
  );
}

// Pattern 2: Push "use client" to LEAF components only
// BAD: "use client" on a wrapper pulls ALL children client-side
// GOOD: Only interactive elements get "use client"

// InteractiveButton.tsx
'use client';
export function LikeButton({ postId }) {
  const [liked, setLiked] = useState(false);
  return <button onClick={() => setLiked(!liked)}>Like</button>;
}

// PostCard.tsx — Stays as server component
import { LikeButton } from './InteractiveButton';
export function PostCard({ post }) {
  return (
    <article>
      <h2>{post.title}</h2>
      <p>{post.excerpt}</p>
      <LikeButton postId={post.id} />  {/* Only this ships JS */}
    </article>
  );
}

// Pattern 3: Server Actions for mutations
// actions.ts
'use server';
export async function createComment(formData: FormData) {
  const content = formData.get('content');
  await db.comments.create({ data: { content } });
  revalidatePath('/posts');
}
```

**Anti-pattern to avoid**: Nesting async server components sequentially creates server-side waterfalls. Use parallel data fetching with granular `<Suspense>` boundaries.

---

### 3.2 Optimistic UI Updates

**What it is**: Update the UI immediately assuming the server operation will succeed, then roll back if it fails. Makes apps feel instant.

**React 19's `useOptimistic` hook**:

```jsx
'use client';
import { useOptimistic } from 'react';
import { likePost } from './actions';

function LikeButton({ post }) {
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    post.likes,
    (currentLikes, newLike) => currentLikes + 1
  );

  async function handleLike() {
    addOptimisticLike(1);          // Instant UI update
    await likePost(post.id);      // Server action (may fail)
  }

  return (
    <form action={handleLike}>
      <button type="submit">
        {optimisticLikes} Likes
      </button>
    </form>
  );
}
```

**TanStack Query approach** (for client-side data):

```jsx
const likeMutation = useMutation({
  mutationFn: (postId) => api.likePost(postId),
  onMutate: async (postId) => {
    await queryClient.cancelQueries(['posts', postId]);
    const previous = queryClient.getQueryData(['posts', postId]);
    queryClient.setQueryData(['posts', postId], (old) => ({
      ...old,
      likes: old.likes + 1,
    }));
    return { previous };
  },
  onError: (err, postId, context) => {
    queryClient.setQueryData(['posts', postId], context.previous);
  },
  onSettled: (data, err, postId) => {
    queryClient.invalidateQueries(['posts', postId]);
  },
});
```

**Best use cases**: Chat messages, likes, comments, cart updates, poll votes, collaborative editing, toggle actions.

---

### 3.3 Skeleton Loading States

**What it is**: Placeholder UI that mirrors the layout of incoming content with animated shimmer effects. Reduces perceived load time compared to spinners.

**How to implement**:

```jsx
// Skeleton component
function Skeleton({ width, height, rounded = false }) {
  return (
    <div
      className="skeleton"
      style={{
        width: width || '100%',
        height: height || '20px',
        borderRadius: rounded ? '50%' : '8px',
      }}
    />
  );
}

// Skeleton that matches a real card layout
function CardSkeleton() {
  return (
    <div className="card">
      <Skeleton height="200px" />                {/* Image area */}
      <div style={{ padding: '16px' }}>
        <Skeleton height="24px" width="70%" />    {/* Title */}
        <Skeleton height="16px" width="100%" />   {/* Body line 1 */}
        <Skeleton height="16px" width="85%" />    {/* Body line 2 */}
        <Skeleton height="36px" width="120px" />  {/* Button */}
      </div>
    </div>
  );
}
```

```css
/* Shimmer animation */
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-secondary) 25%,
    var(--bg-elevated) 50%,
    var(--bg-secondary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Pulse variant */
.skeleton--pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Integration with Suspense**:

```jsx
import { Suspense } from 'react';

function Dashboard() {
  return (
    <div className="dashboard">
      <Suspense fallback={<CardSkeleton />}>
        <AsyncDataCard />
      </Suspense>
    </div>
  );
}
```

**Libraries**: `react-loading-skeleton` (comes with shimmer out of the box), `shimmer-from-structure` (auto-generates skeletons from rendered UI).

---

### 3.4 React Native: Gesture-Driven Interactions

**What it is**: Touch-based interactions using gesture handlers that run on the native UI thread for 60fps performance.

**Key libraries**:
- **React Native Reanimated 3** — Animations on the UI thread
- **React Native Gesture Handler** — Native gesture recognition
- **React Native Bottom Sheet** — The most popular bottom sheet implementation
- **Expo Haptics** — Tactile feedback

```jsx
// Bottom Sheet with Gesture Handler + Reanimated
import BottomSheet from '@gorhom/bottom-sheet';
import { useCallback, useRef } from 'react';

function AppWithBottomSheet() {
  const bottomSheetRef = useRef(null);
  const snapPoints = ['25%', '50%', '90%'];

  const handleSheetChanges = useCallback((index) => {
    // Trigger haptic feedback at snap points
    if (index >= 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      enablePanDownToClose
      backgroundStyle={{
        backgroundColor: '#1e293b',
        borderRadius: 24,
      }}
      handleIndicatorStyle={{ backgroundColor: '#64748b' }}
    >
      <BottomSheetContent />
    </BottomSheet>
  );
}
```

```jsx
// Pull-to-Refresh with Custom Animation
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

function PullToRefresh({ onRefresh, children }) {
  const translateY = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = Math.min(e.translationY * 0.5, 100);
      }
    })
    .onEnd(() => {
      if (translateY.value > 60) {
        // Trigger refresh
        runOnJS(onRefresh)();
      }
      translateY.value = withSpring(0);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
```

**Haptic feedback patterns**:
- **Light impact**: Snap points, toggle switches, selection changes
- **Medium impact**: Successful actions, pull-to-refresh trigger
- **Heavy impact**: Destructive actions, errors
- **Selection**: Scrolling through picker items

---

## 4. Animation & Motion

### 4.1 Motion (formerly Framer Motion) — The React Standard

**What it is**: The de-facto animation library for React in 2026. Renamed from "Framer Motion" to "Motion" in 2025. Provides a declarative API with spring physics, gesture support, and layout animations.

**Import path** (2026): `import { motion, AnimatePresence } from "motion/react"`

**Core patterns**:

```jsx
import { motion, AnimatePresence } from "motion/react";

// Spring animation (default for physical properties)
<motion.div
  animate={{ scale: 1, opacity: 1 }}
  initial={{ scale: 0.8, opacity: 0 }}
  transition={{
    type: "spring",
    stiffness: 300,
    damping: 20,
    mass: 0.8,
  }}
/>

// Layout animations — elements animate to new positions
function Tabs({ activeTab, tabs }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button key={tab.id} onClick={() => setActive(tab.id)}>
          {tab.label}
          {activeTab === tab.id && (
            <motion.div
              className="tab-indicator"
              layoutId="activeTab"       // Shared layout animation
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

// Exit animations with AnimatePresence
function Modal({ isOpen, children }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="modal-content"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Scroll-triggered animations
import { useScroll, useTransform, motion } from "motion/react";

function ParallaxHero() {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <motion.div style={{ y, opacity }}>
      <h1>Welcome</h1>
    </motion.div>
  );
}
```

**Spring physics cheat sheet**:

| Feel | stiffness | damping | Use Case |
|------|-----------|---------|----------|
| Snappy | 500 | 30 | Tab indicators, toggles |
| Smooth | 200 | 20 | Page transitions, modals |
| Bouncy | 300 | 10 | Notifications, playful UI |
| Stiff | 700 | 40 | Tooltips, menus |

**Performance**: Motion's hybrid engine runs animations using the Web Animations API and ScrollTimeline for 120fps performance.

---

### 4.2 GSAP (GreenSock)

**What it is**: The most powerful general-purpose JS animation library. Up to 20x faster than CSS transitions in complex scenarios. Dominates in marketing sites, award-winning creative work, and complex scroll experiences.

**When to use GSAP vs Motion**:
- **Motion**: React apps, component animations, layout transitions, gesture interactions
- **GSAP**: Complex timelines, scroll-triggered sequences, non-React projects, SVG morphing, text splitting

```javascript
// GSAP ScrollTrigger — element animation on scroll
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

gsap.from(".feature-card", {
  scrollTrigger: {
    trigger: ".feature-section",
    start: "top 80%",
    end: "bottom 20%",
    toggleActions: "play none none reverse",
  },
  y: 60,
  opacity: 0,
  duration: 0.8,
  stagger: 0.15,
  ease: "power2.out",
});

// GSAP timeline for coordinated animations
const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

tl.from(".hero-title", { y: 100, opacity: 0, duration: 1 })
  .from(".hero-subtitle", { y: 50, opacity: 0, duration: 0.8 }, "-=0.5")
  .from(".hero-cta", { scale: 0.8, opacity: 0, duration: 0.6 }, "-=0.3");
```

---

### 4.3 Lottie vs Rive Animations

**What they are**: Tools for creating and rendering vector animations in UI. Both serve the "animated icon / micro-interaction / loading state" use case.

| Feature | Lottie | Rive |
|---------|--------|------|
| **Authoring** | After Effects + Bodymovin | Rive Editor (web-based) |
| **Interactivity** | Playback control (play/pause/seek) | Built-in state machines, data binding |
| **Runtime size** | ~60KB (lottie-web) | ~200KB (WASM + WebGL) |
| **Performance** | CPU-rendered SVG/Canvas | GPU-accelerated (WebGL) |
| **File size** | JSON-based, can be large | Binary format, very compact |
| **AI features** | Generative AI in Lottie Creator (2025) | N/A |
| **Best for** | Simple looping animations, icons | Interactive animations, games, complex UI states |

**Recommendation for 2026**:
- **New projects with interactive needs**: Use Rive
- **Simple looping icons/animations**: Use Lottie
- **Existing After Effects workflow**: Stay with Lottie

```jsx
// Lottie in React
import Lottie from 'lottie-react';
import animationData from './loading.json';

function LoadingAnimation() {
  return <Lottie animationData={animationData} loop autoplay />;
}

// Rive in React (with state machine interaction)
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';

function InteractiveIcon() {
  const { rive, RiveComponent } = useRive({
    src: '/icon.riv',
    stateMachines: 'State Machine 1',
    autoplay: true,
  });

  const hoverInput = useStateMachineInput(rive, 'State Machine 1', 'isHovered');

  return (
    <RiveComponent
      onMouseEnter={() => hoverInput && (hoverInput.value = true)}
      onMouseLeave={() => hoverInput && (hoverInput.value = false)}
    />
  );
}
```

---

### 4.4 Modern Parallax Scrolling

**What it is**: Elements moving at different speeds during scroll, creating depth. The 2026 approach uses CSS scroll-driven animations or `transform` (never `top`).

**Best approach (CSS-only)**:

```css
/* Pure CSS parallax with scroll-driven animations */
.parallax-slow {
  animation: parallaxSlow linear;
  animation-timeline: scroll();
}

.parallax-fast {
  animation: parallaxFast linear;
  animation-timeline: scroll();
}

@keyframes parallaxSlow {
  from { transform: translateY(0); }
  to { transform: translateY(-50px); }
}

@keyframes parallaxFast {
  from { transform: translateY(0); }
  to { transform: translateY(-150px); }
}
```

**Best approach (JS with Motion)**:

```jsx
import { useScroll, useTransform, motion } from "motion/react";

function ParallaxSection() {
  const { scrollYProgress } = useScroll();
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "-30%"]);
  const fgY = useTransform(scrollYProgress, [0, 1], ["0%", "-15%"]);

  return (
    <section className="parallax-section">
      <motion.div className="bg-layer" style={{ y: bgY }} />
      <motion.div className="fg-layer" style={{ y: fgY }} />
    </section>
  );
}
```

**Performance rules**:
- Always use `transform` not `top/left` (compositor thread vs. layout recalc)
- Add `will-change: transform` to parallax layers
- Keep speed multipliers subtle (0.2-0.5)
- Disable for `prefers-reduced-motion`

---

### 4.5 Cursor-Following Effects

```jsx
// Cursor-following element with Motion
import { motion, useMotionValue, useSpring } from "motion/react";

function CursorFollower() {
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);

  // Spring smoothing for natural feel
  const springX = useSpring(cursorX, { stiffness: 150, damping: 15 });
  const springY = useSpring(cursorY, { stiffness: 150, damping: 15 });

  useEffect(() => {
    const handleMouse = (e) => {
      cursorX.set(e.clientX - 16);
      cursorY.set(e.clientY - 16);
    };
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  return (
    <motion.div
      className="cursor-dot"
      style={{
        position: "fixed",
        left: springX,
        top: springY,
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "rgba(59, 130, 246, 0.5)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
```

---

## 5. Accessibility & Performance

### 5.1 Reduced Motion Preferences

**What it is**: Respecting the user's OS-level preference to minimize motion. Affects users with vestibular disorders, epilepsy, migraines, and scotopic sensitivity.

**This is not optional** — WCAG 2.2 SC 2.3.3 requires it, and the European Accessibility Act (2025) enforces it.

```css
/* Approach 1: Remove animations for reduced-motion users */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Approach 2 (preferred): Provide alternative, subtle animations */
.card-enter {
  animation: fadeSlideIn 0.3s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .card-enter {
    animation: simpleFade 0.15s ease-out;    /* Simpler, gentler alternative */
  }
}

@keyframes simpleFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

```javascript
// JavaScript check
const prefersReducedMotion =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Motion library integration
import { motion } from "motion/react";

function AnimatedCard({ children }) {
  const prefersReducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <motion.div
      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0.1 : 0.4,
      }}
    >
      {children}
    </motion.div>
  );
}
```

**Best practices**:
- Never remove ALL motion — crossfades and opacity changes are generally safe
- Provide on-page controls to pause/stop animations (WCAG SC 2.2.2)
- Auto-playing carousels and video backgrounds must have pause controls

---

### 5.2 Focus-Visible Patterns

**What it is**: Show focus indicators only for keyboard navigation, not mouse clicks. Essential for clean keyboard accessibility.

```css
/* Remove default focus for mouse users, keep for keyboard */
:focus {
  outline: none;
}

:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* Two-color focus indicator for maximum visibility (WCAG 2.2) */
:focus-visible {
  outline: 3px solid #000000;
  outline-offset: 2px;
  box-shadow: 0 0 0 6px #ffffff;    /* White outer ring for contrast */
}

/* Dark mode adjustment */
@media (prefers-color-scheme: dark) {
  :focus-visible {
    outline-color: #60a5fa;
    box-shadow: 0 0 0 6px #1e293b;
  }
}
```

**WCAG 2.2 requirement**: Focus indicators must have at least 3:1 contrast ratio against adjacent colors.

---

### 5.3 Inclusive Color Palettes

**Practical approach**:

```css
/* Semantic color system that works for color blindness */
:root {
  /* Don't rely on color alone — always pair with icons/text */
  --color-success: #16a34a;         /* Green */
  --color-success-bg: #f0fdf4;
  --color-error: #dc2626;           /* Red */
  --color-error-bg: #fef2f2;
  --color-warning: #d97706;         /* Amber */
  --color-warning-bg: #fffbeb;
  --color-info: #2563eb;            /* Blue */
  --color-info-bg: #eff6ff;
}

/* Minimum contrast ratios (WCAG 2.2):
   - Normal text: 4.5:1
   - Large text (18px+ or 14px+ bold): 3:1
   - UI components and graphics: 3:1
   - Focus indicators: 3:1 against adjacent colors
*/
```

**Tool**: Use the APCA (Advanced Perceptual Contrast Algorithm) for contrast checking — it's the emerging standard beyond WCAG 2's basic ratio.

---

### 5.4 Performance-First Design Patterns

**Core Web Vitals targets (2026)**:
- **LCP** (Largest Contentful Paint): < 2.5 seconds
- **INP** (Interaction to Next Paint): < 200 milliseconds (replaced FID in 2024)
- **CLS** (Cumulative Layout Shift): < 0.1

**Design patterns that impact performance**:

```html
<!-- Lazy loading images (native) -->
<img src="hero.webp" alt="Hero" loading="eager" fetchpriority="high" />
<img src="below-fold.webp" alt="Feature" loading="lazy" />

<!-- Responsive images with modern formats -->
<picture>
  <source srcset="image.avif" type="image/avif" />
  <source srcset="image.webp" type="image/webp" />
  <img src="image.jpg" alt="Fallback" loading="lazy" />
</picture>

<!-- Preload critical fonts -->
<link rel="preload" href="/fonts/Inter-Variable.woff2" as="font"
      type="font/woff2" crossorigin />

<!-- Prevent CLS: Always set dimensions on images/video -->
<img src="photo.webp" width="800" height="600" alt="Photo"
     style="aspect-ratio: 800/600; width: 100%; height: auto;" />
```

```css
/* Font display swap — prevents invisible text during load */
@font-face {
  font-family: 'Inter Variable';
  src: url('/fonts/Inter-Variable.woff2') format('woff2-variations');
  font-display: swap;
}

/* Content-visibility: skip rendering off-screen content */
.below-fold-section {
  content-visibility: auto;
  contain-intrinsic-size: 0 500px;    /* Estimated height */
}
```

**Islands Architecture**: Ship zero JavaScript for static components, hydrate only interactive portions. Frameworks like Astro implement this by default. A blog post might have a static article body (0 JS) and a dynamic comment section (with JS).

---

## 6. Design Systems

### 6.1 Token-Based Design Systems

**What it is**: Design tokens are the atomic values (colors, spacing, radii, typography) that define a design system. They serve as the single source of truth between design tools (Figma) and code.

**Three-tier token architecture**:

```css
/* Tier 1: Primitive tokens (raw values) */
:root {
  --blue-50: #eff6ff;
  --blue-100: #dbeafe;
  --blue-500: #3b82f6;
  --blue-600: #2563eb;
  --blue-900: #1e3a5f;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}

/* Tier 2: Semantic tokens (intent-based) */
:root {
  --color-primary: var(--blue-600);
  --color-primary-hover: var(--blue-700);
  --color-bg-page: var(--gray-50);
  --color-bg-card: #ffffff;
  --color-text-primary: var(--gray-900);
  --color-text-muted: var(--gray-500);
  --color-border: var(--gray-200);
}

/* Tier 3: Component tokens (scoped) */
.btn {
  --btn-bg: var(--color-primary);
  --btn-text: #ffffff;
  --btn-radius: var(--radius-md);
  --btn-padding-x: var(--space-4);
  --btn-padding-y: var(--space-2);

  background: var(--btn-bg);
  color: var(--btn-text);
  border-radius: var(--btn-radius);
  padding: var(--btn-padding-y) var(--btn-padding-x);
}
```

**Figma-to-code alignment**: Use Figma Variables for tokens. What you name in Figma is what developers import in code. Tools like Tokens Studio and Style Dictionary bridge the gap.

---

### 6.2 Shadcn/ui and the Headless UI Pattern

**What it is**: Shadcn/ui is NOT a traditional component library — it's a collection of copy-paste components built on Radix UI primitives + Tailwind CSS. You own the code. In 2026, it offers 1,300+ pre-designed, accessible "Blocks" that inherit project-specific design tokens.

**Why it's dominating**:
- Full ownership (no dependency updates breaking your UI)
- Accessible by default (Radix primitives)
- Customizable via CSS variables and Tailwind
- Can now toggle between Radix UI and Base UI primitives

**How it works**:

```bash
# Add a component to your project (copies source code)
npx shadcn@latest add button
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
```

```jsx
// The component is now YOUR code in components/ui/button.tsx
import { Button } from "@/components/ui/button";

function App() {
  return (
    <div>
      <Button variant="default">Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete</Button>
    </div>
  );
}
```

**Theming with CSS variables** (Shadcn approach):

```css
/* globals.css */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --border: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* ... dark mode overrides */
  }
}
```

---

### 6.3 Compound Component Pattern

**What it is**: Components that work together, sharing implicit state via Context. The parent manages state; children consume it.

```jsx
// Compound component API (dot notation)
<Select>
  <Select.Trigger>Choose a fruit</Select.Trigger>
  <Select.Content>
    <Select.Item value="apple">Apple</Select.Item>
    <Select.Item value="banana">Banana</Select.Item>
    <Select.Item value="cherry">Cherry</Select.Item>
  </Select.Content>
</Select>
```

**Implementation**:

```jsx
import { createContext, useContext, useState } from 'react';

const SelectContext = createContext(null);

function Select({ children, onValueChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState(null);

  const handleSelect = (val) => {
    setValue(val);
    setIsOpen(false);
    onValueChange?.(val);
  };

  return (
    <SelectContext.Provider value={{ isOpen, setIsOpen, value, handleSelect }}>
      <div className="select-root">{children}</div>
    </SelectContext.Provider>
  );
}

Select.Trigger = function Trigger({ children }) {
  const { isOpen, setIsOpen, value } = useContext(SelectContext);
  return (
    <button onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen}>
      {value || children}
    </button>
  );
};

Select.Content = function Content({ children }) {
  const { isOpen } = useContext(SelectContext);
  if (!isOpen) return null;
  return <ul role="listbox">{children}</ul>;
};

Select.Item = function Item({ value, children }) {
  const { handleSelect, value: selectedValue } = useContext(SelectContext);
  return (
    <li
      role="option"
      aria-selected={value === selectedValue}
      onClick={() => handleSelect(value)}
    >
      {children}
    </li>
  );
};
```

**When to use**: Any component with 3+ props controlling layout/content is a candidate for refactoring into compounds. Common examples: Tabs, Accordions, Selects, Menus, Dialogs.

---

### 6.4 React UI Library Landscape (2026)

| Library | Approach | Bundle Size | Best For |
|---------|----------|-------------|----------|
| **Shadcn/ui** | Copy-paste + Radix primitives | 0 (your code) | Full control, Tailwind projects |
| **Radix UI** | Headless primitives | ~5KB per component | Custom design systems |
| **Ark UI** | Headless, state machines | Varies | Complex interaction patterns |
| **Mantine** | Full-featured + hooks | Moderate | Rapid prototyping, dashboards |
| **MUI (Material UI)** | Full design system | Large | Enterprise, Material Design adherence |
| **Chakra UI** | Styled system + theme | Moderate | Themeable, consistent design |

**2026 recommendation**: Start with **Shadcn/ui** for new projects. Use **Radix** or **Ark UI** primitives if building a fully custom design system. Avoid heavy libraries like MUI unless your project specifically requires Material Design.

---

## 7. AI-Specific UI Patterns

### 7.1 Streaming Text Display

**What it is**: Displaying AI-generated text word-by-word or token-by-token as it arrives from the LLM, rather than waiting for the complete response. Users perceive streaming interfaces as 40% faster than buffered responses, even when total time is identical.

**Implementation with Vercel AI SDK**:

```jsx
// Next.js + Vercel AI SDK — streaming chat
'use client';
import { useChat } from 'ai/react';

function ChatInterface() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message message--${msg.role}`}>
            <div className="message__content">
              {msg.content}
              {/* Blinking cursor at end of streaming message */}
              {isLoading && msg.role === 'assistant' &&
                msg === messages[messages.length - 1] && (
                <span className="streaming-cursor" />
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="chat-input">
        <textarea
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message..."
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
    </div>
  );
}
```

```css
/* Streaming cursor animation */
.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1.2em;
  background: currentColor;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}
```

**Server-side (API route)**:

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
  });

  return result.toDataStreamResponse();
}
```

**Transport methods**: Server-Sent Events (SSE) and chunked HTTP responses are the two primary approaches. SSE is simpler; chunked responses offer more control.

---

### 7.2 AI Loading States

**What to use when**:

| State | Pattern | When to Use |
|-------|---------|-------------|
| **Waiting for first token** | Typing indicator (3 animated dots) | Short wait, conversational context |
| **Waiting for structured data** | Skeleton screen | When you know the output shape |
| **Multi-step processing** | Step indicator with labels | Agent workflows, tool use chains |
| **Unknown duration** | Shimmer + status text | "Searching...", "Analyzing...", "Writing..." |

```jsx
// AI Typing Indicator
function TypingIndicator() {
  return (
    <div className="typing-indicator" aria-label="AI is thinking">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}
```

```css
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  align-items: center;
}

.typing-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  animation: dotBounce 1.4s ease-in-out infinite;
}

.typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotBounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-8px); }
}
```

```jsx
// Multi-step AI processing indicator
function AIProcessingSteps({ currentStep, steps }) {
  return (
    <div className="ai-steps">
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={`ai-step ${
            i < currentStep ? 'ai-step--complete' :
            i === currentStep ? 'ai-step--active' :
            'ai-step--pending'
          }`}
        >
          <div className="ai-step__icon">
            {i < currentStep ? '✓' :
             i === currentStep ? <Spinner size="sm" /> :
             '○'}
          </div>
          <span className="ai-step__label">{step.label}</span>
        </div>
      ))}
    </div>
  );
}

// Usage:
<AIProcessingSteps
  currentStep={1}
  steps={[
    { id: 'search', label: 'Searching documents...' },
    { id: 'analyze', label: 'Analyzing results...' },
    { id: 'generate', label: 'Writing response...' },
  ]}
/>
```

---

### 7.3 Prompt Input Design

**Best practices for AI input fields**:

```jsx
function PromptInput({ onSubmit, isLoading, suggestions }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [input]);

  return (
    <div className="prompt-input-wrapper">
      {/* Suggestion chips — shown when input is empty */}
      {!input && suggestions?.length > 0 && (
        <div className="suggestion-chips">
          {suggestions.map((s) => (
            <button
              key={s}
              className="chip"
              onClick={() => { setInput(s); textareaRef.current?.focus(); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="prompt-input">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything..."
          rows={1}
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (input.trim()) onSubmit(input);
              setInput('');
            }
          }}
        />
        <button
          onClick={() => { if (input.trim()) onSubmit(input); setInput(''); }}
          disabled={!input.trim() || isLoading}
          className="send-btn"
          aria-label="Send message"
        >
          <ArrowUpIcon />
        </button>
      </div>

      <p className="prompt-disclaimer">
        AI can make mistakes. Verify important information.
      </p>
    </div>
  );
}
```

**Key design principles**:
- Auto-expanding textarea (up to a max-height)
- Enter to send, Shift+Enter for new line
- Suggestion chips when empty (helps first-time users)
- Disable send when empty or loading
- Clear disclaimer about AI limitations
- File upload attachment capability
- Character/token count for long inputs

---

### 7.4 Multi-Turn Conversation UI

**Layout patterns**:

```css
/* Chat message layout */
.message {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  max-width: 768px;
  margin: 0 auto;
}

.message--user {
  flex-direction: row-reverse;
}

.message__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
}

.message__content {
  flex: 1;
  min-width: 0;
}

/* Differentiate user vs assistant */
.message--user .message__bubble {
  background: var(--color-primary);
  color: white;
  border-radius: 18px 18px 4px 18px;
}

.message--assistant .message__bubble {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 18px 18px 18px 4px;
}

/* Timestamps — show on hover */
.message__time {
  font-size: 0.75rem;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.2s;
}

.message:hover .message__time {
  opacity: 1;
}

/* Code blocks inside messages */
.message__content pre {
  background: #1e1e2e;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  font-size: 0.875rem;
}

.message__content pre code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
```

**Design patterns for conversation UI**:
- Clear sender differentiation using both alignment AND color (not color alone — accessibility)
- Relative timestamps ("2 min ago") that expand to absolute on hover
- Markdown rendering in assistant messages (headers, lists, code blocks, tables)
- Copy button on code blocks
- Reaction/feedback buttons (thumbs up/down) on assistant messages
- Message editing capability for user messages
- Regenerate button on assistant messages
- Branching/forking conversations

---

### 7.5 Tool Use / Function Calling Visualization

**What it is**: When an AI agent calls external tools (search, code execution, API calls), the UI should show what's happening transparently.

```jsx
// Tool call visualization component
function ToolCallDisplay({ toolCall }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="tool-call">
      <button
        className="tool-call__header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="tool-call__icon">
          {toolCall.status === 'running' ? <Spinner size="sm" /> : '🔧'}
        </span>
        <span className="tool-call__name">{toolCall.name}</span>
        <span className="tool-call__status">
          {toolCall.status === 'running' ? 'Running...' :
           toolCall.status === 'success' ? 'Complete' :
           'Failed'}
        </span>
        <ChevronIcon expanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="tool-call__details">
          <div className="tool-call__section">
            <h4>Input</h4>
            <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
          </div>
          {toolCall.result && (
            <div className="tool-call__section">
              <h4>Output</h4>
              <pre>{JSON.stringify(toolCall.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

```css
.tool-call {
  margin: 8px 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.875rem;
}

.tool-call__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  width: 100%;
  background: var(--bg-secondary);
  border: none;
  cursor: pointer;
  text-align: left;
}

.tool-call__name {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
}

.tool-call__details {
  padding: 12px;
  border-top: 1px solid var(--border-color);
}

.tool-call__details pre {
  background: #1e1e2e;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.8rem;
}
```

---

### 7.6 Confidence / Uncertainty Visualization

**What it is**: Visual indicators showing how certain the AI is about its output. Critical for building user trust and appropriate reliance.

**Color-coded confidence levels**:

| Level | Score | Color | User Action |
|-------|-------|-------|-------------|
| High | 85%+ | Green (`#16a34a`) | Trust, minimal review |
| Medium | 60-84% | Yellow/Amber (`#d97706`) | Review recommended |
| Low | <60% | Red (`#dc2626`) | Verify externally |

```jsx
// Confidence badge component
function ConfidenceBadge({ score, label }) {
  const level = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low';

  const colors = {
    high:   { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
    medium: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
    low:    { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  };

  return (
    <span
      className="confidence-badge"
      style={{
        background: colors[level].bg,
        color: colors[level].text,
        border: `1px solid ${colors[level].border}`,
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 500,
      }}
      title={`Confidence: ${score}%`}
    >
      {label || `${score}% confidence`}
    </span>
  );
}

// Inline confidence indicators in AI responses
function AIResponseWithConfidence({ segments }) {
  return (
    <div className="ai-response">
      {segments.map((segment, i) => (
        <span
          key={i}
          className={`segment segment--${segment.confidenceLevel}`}
          title={`Confidence: ${segment.confidence}%`}
        >
          {segment.text}
        </span>
      ))}
    </div>
  );
}
```

**Best practices**:
- Show confidence as a range/spectrum, not a single number
- Provide "double-check" cues with source links for lower confidence
- Include what factors influence the score (sources used, model consistency)
- Never show confidence to end users as a raw percentage without context

---

### 7.7 Human-in-the-Loop UI Patterns

**What it is**: UI patterns for AI systems that require human approval before executing actions. The three primary patterns are pre-action approval, post-action review, and confidence-based routing.

```jsx
// Approval workflow component
function ApprovalCard({ action, context, onApprove, onReject, onModify }) {
  return (
    <div className="approval-card">
      <div className="approval-card__header">
        <span className="approval-card__badge">Needs Approval</span>
        <span className="approval-card__risk">
          Risk: {action.riskLevel}
        </span>
      </div>

      <div className="approval-card__body">
        <h3>The AI wants to: {action.description}</h3>

        {/* Show full context — prevent rubber-stamp approvals */}
        <details>
          <summary>View reasoning</summary>
          <div className="approval-card__context">
            <p><strong>Why:</strong> {action.reasoning}</p>
            <p><strong>Tool calls made:</strong></p>
            <ul>
              {context.toolHistory.map((tool, i) => (
                <li key={i}>{tool.name}: {tool.summary}</li>
              ))}
            </ul>
          </div>
        </details>

        {/* Editable parameters before approval */}
        {action.editable && (
          <div className="approval-card__params">
            <h4>Parameters (editable):</h4>
            {Object.entries(action.params).map(([key, val]) => (
              <label key={key}>
                {key}: <input defaultValue={val} name={key} />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="approval-card__actions">
        <button className="btn btn--approve" onClick={onApprove}>
          Approve
        </button>
        <button className="btn btn--modify" onClick={onModify}>
          Modify & Approve
        </button>
        <button className="btn btn--reject" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
```

**Critical design principle**: The quality of human review depends heavily on the information presented. A poor interface produces rubber-stamp approvals, which defeats the safety purpose entirely. Always expose: the pending action, the agent's reasoning, the tool call history, and the task context.

---

### 7.8 Generative UI

**What it is**: AI agents that generate or select UI components at runtime based on the conversation context, rather than returning only text.

**Three approaches (2026)**:

1. **Tool-based (controlled)**: Agent calls a tool, the tool maps to a pre-built React component. The agent never controls layout.

2. **Declarative (structured)**: Agent returns a JSON schema describing the UI (cards, lists, forms), and the frontend renders pre-built components from the schema.

3. **Fully generated**: Agent creates entirely new UI. Most experimental and least predictable.

**Standards to know**:
- **A2UI** (Google): JSONL-based declarative Generative UI spec for cross-platform agent interfaces
- **Open-JSON-UI**: Open standardization of OpenAI's declarative UI schema

```jsx
// Tool-based Generative UI with Vercel AI SDK
// The AI can "call" a UI component as a tool result
import { streamUI } from 'ai/rsc';

const result = await streamUI({
  model: openai('gpt-4o'),
  messages,
  tools: {
    showWeather: {
      description: 'Show weather for a location',
      parameters: z.object({ city: z.string() }),
      generate: async function* ({ city }) {
        yield <WeatherSkeleton />;          // Show loading state
        const data = await getWeather(city);
        return <WeatherCard data={data} />;  // Return full component
      },
    },
    showStockChart: {
      description: 'Show stock price chart',
      parameters: z.object({ symbol: z.string() }),
      generate: async function* ({ symbol }) {
        yield <ChartSkeleton />;
        const data = await getStockData(symbol);
        return <StockChart data={data} />;
      },
    },
  },
});
```

**Key frameworks**:
- **CopilotKit**: Full runtime for in-app AI copilots with generative UI
- **assistant-ui**: React components for AI chat with generative UI support
- **Vercel AI SDK**: `streamUI` for tool-based generative UI in Next.js

---

## Quick Reference: What to Use When

### Visual Style Decision Tree

| Project Type | Recommended Visual Approach |
|---|---|
| **SaaS / Productivity** | Clean minimalism, Shadcn defaults, subtle glass effects |
| **Creative / Agency** | Neubrutalism, kinetic typography, bold color |
| **Developer Tools** | Dark mode default, neon accents, monospace type, terminal aesthetics |
| **Consumer / Social** | Bento grids, gradient meshes, rounded everything, motion-heavy |
| **AI / LLM Products** | "Barely-there" minimal UI, streaming text, skeleton states, tool visualization |
| **Enterprise** | Token-based design system, high accessibility compliance, conservative animation |

### Animation Library Decision Tree

| Need | Use |
|---|---|
| React component animations | Motion (formerly Framer Motion) |
| Complex scroll-triggered sequences | GSAP + ScrollTrigger |
| Simple scroll effects | CSS scroll-driven animations |
| Page transitions | View Transitions API |
| Interactive icons/micro-interactions | Rive |
| Simple looping animations | Lottie |
| 3D in UI | React Three Fiber + Three.js |

### CSS Feature Readiness (2026)

| Feature | Status | Safe to Use? |
|---|---|---|
| Container Queries | Baseline | Yes |
| CSS Nesting | Baseline | Yes |
| `:has()` Selector | Baseline | Yes |
| View Transitions (same-doc) | Baseline (Oct 2025) | Yes |
| Scroll-Driven Animations | Cross-browser (2025) | Yes, with fallback |
| CSS Subgrid | All browsers (2023+) | Yes |
| Cascade Layers (@layer) | Universal (96%+) | Yes |
| Anchor Positioning | Chrome 125+ | Progressive enhancement only |
| CSS @scope | Emerging | With @supports guard |
| Scroll-State Queries | Emerging (2026) | Experimental only |

---

## Sources

### Visual Design Trends
- [15 Web Design Trends Shaping 2026 - Graphic Design Junction](https://graphicdesignjunction.com/2025/12/web-design-trends-of-2026/)
- [The 11 Biggest Web Design Trends of 2026 - Wix](https://www.wix.com/blog/web-design-trends)
- [Top Web Design Trends for 2026 - Figma](https://www.figma.com/resource-library/web-design-trends/)
- [8 Web Design Trends to Watch in 2026 - Webflow](https://webflow.com/blog/web-design-trends-2026)
- [Web Design Trends 2026 - Elementor](https://elementor.com/blog/web-design-trends-2026/)
- [Top Web Design Trends for 2026 - Designmodo](https://designmodo.com/web-design-trends/)
- [Getting Clarity on Apple's Liquid Glass - CSS-Tricks](https://css-tricks.com/getting-clarity-on-apples-liquid-glass/)
- [Apple's Liquid Glass UI Design + CSS Guide - DEV Community](https://dev.to/gruszdev/apples-liquid-glass-revolution-how-glassmorphism-is-shaping-ui-design-in-2025-with-css-code-1221)
- [Typography Trends 2026 - The Inkorporated](https://www.theinkorporated.com/insights/future-of-typography/)
- [Neobrutalism: Definition and Best Practices - NN/G](https://www.nngroup.com/articles/neobrutalism/)

### CSS & Layout
- [2026 CSS Features You Must Know - Riad Kilani](https://blog.riadkilani.com/2026-css-features-you-must-know/)
- [The State of CSS in 2026 - CoderCops](https://www.codercops.com/blog/state-of-css-2026)
- [What's New in CSS 2026 - modern.css](https://modern-css.com/whats-new-in-css-2026/)
- [Interop 2026 - CSS-Tricks](https://css-tricks.com/interop-2026/)
- [CSS Anchor Positioning Guide - CSS-Tricks](https://css-tricks.com/css-anchor-positioning-guide/)
- [CSS Cascade Layers Complete Guide - DevToolbox](https://devtoolbox.dedyn.io/blog/css-cascade-layers-complete-guide)
- [CSS Subgrid: The Complete Guide - DevToolbox](https://devtoolbox.dedyn.io/blog/css-subgrid-complete-guide)
- [Scroll-Driven Animations - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations)
- [What's New in View Transitions (2025) - Chrome Developers](https://developer.chrome.com/blog/view-transitions-in-2025)
- [Bringing Back Parallax With Scroll-Driven CSS Animations - CSS-Tricks](https://css-tricks.com/bringing-back-parallax-with-scroll-driven-css-animations/)

### React & React Native
- [React Stack Patterns 2026 - patterns.dev](https://www.patterns.dev/react/react-2026/)
- [React Server Components Streaming Performance Guide 2026 - SitePoint](https://www.sitepoint.com/react-server-components-streaming-performance-2026/)
- [React Design Patterns: Complete Guide 2026 - TurboDocx](https://www.turbodocx.com/blog/react-design-patterns)
- [Next.js View Transitions Guide](https://nextjs.org/docs/app/guides/view-transitions)
- [ViewTransition - React Docs](https://react.dev/reference/react/ViewTransition)
- [useOptimistic - React Docs](https://react.dev/reference/react/useOptimistic)
- [React UI Libraries 2025 Comparison - Makers' Den](https://makersden.io/blog/react-ui-libs-2025-comparing-shadcn-radix-mantine-mui-chakra)
- [Compound Component Pattern - patterns.dev](https://www.patterns.dev/react/compound-pattern/)
- [Best Mobile App UI/UX Design Trends for 2026 - Natively](https://natively.dev/blog/best-mobile-app-design-trends-2026)

### Animation & Motion
- [Motion (formerly Framer Motion) Docs](https://motion.dev/docs/react)
- [Official Motion Examples](https://examples.motion.dev/react)
- [CSS/JS Animation Trends 2026 - Web Peak](https://webpeak.org/blog/css-js-animation-trends/)
- [Comparing Best React Animation Libraries 2026 - LogRocket](https://blog.logrocket.com/best-react-animation-libraries/)
- [Motion UI Trends 2026 - Loma Technology](https://lomatechnology.com/blog/motion-ui-trends-2026/2911)
- [Rive vs Lottie Complete Comparison 2026 - Unicorn Icons](https://unicornicons.com/learn/rive-vs-lottie)
- [Rive vs Lottie in 2026 - Rive Masterclass](https://www.rivemasterclass.com/blog/rive-vs-lottie-in-20260why-interactive-logic-data-binding-scripting-make-rive-the-future-of-ui-animation)

### Accessibility & Performance
- [Design Accessible Animation and Movement - Pope Tech](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
- [prefers-reduced-motion - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [focus-visible - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:focus-visible)
- [Front-End Performance in 2026 - Vofox Solutions](https://vofoxsolutions.com/front-end-performance-in-2026)
- [Core Web Vitals and WCAG - Siteimprove](https://www.siteimprove.com/blog/core-web-vitals-wcag/)

### Design Systems
- [Building a Scalable Design System with Shadcn/UI - Medium](https://shadisbaih.medium.com/building-a-scalable-design-system-with-shadcn-ui-tailwind-css-and-design-tokens-031474b03690)
- [Modern UI Development Evolution & 2026 Frameworks - Zignuts](https://www.zignuts.com/blog/shadcn-future-of-ui-development)
- [14 Best React UI Component Libraries in 2026 - Untitled UI](https://www.untitledui.com/blog/react-component-libraries)

### AI-Specific UI Patterns
- [Beyond Chat: How AI is Transforming UI Design Patterns - Artium.AI](https://artium.ai/insights/beyond-chat-how-ai-is-transforming-ui-design-patterns)
- [UI/UX Design Trends for AI-First Apps in 2026 - GroovyWeb](https://www.groovyweb.co/blog/ui-ux-design-trends-ai-apps-2026)
- [Confidence Visualization UI Patterns - Agentic Design](https://agentic-design.ai/patterns/ui-ux-patterns/confidence-visualization-patterns)
- [Developer's Guide to Generative UI in 2026 - CopilotKit](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)
- [AI SDK UI: Generative User Interfaces - Vercel](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [Human-in-the-Loop Patterns for AI Agents 2026 - MyEngineeringPath](https://myengineeringpath.dev/genai-engineer/human-in-the-loop/)
- [Human-in-the-Loop for AI Agents - Permit.io](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [Streaming LLM Responses in React - AI Tool Pipelines](https://www.aitoolpipelines.com/articles/react-llm-streaming-api-guide)
- [Real-time AI in Next.js with Vercel AI SDK - LogRocket](https://blog.logrocket.com/nextjs-vercel-ai-sdk-streaming/)
- [A2UI: An Open Project for Agent-Driven Interfaces - Google](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
