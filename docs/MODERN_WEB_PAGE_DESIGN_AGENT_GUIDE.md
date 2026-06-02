# Modern Web Page Design Agent Guide

**Last researched:** 2026-05-28

This guide tells contributing agents how to create modern web pages for The
Underground Circle and related developer-facing builds. It complements
`docs/UC_STYLE_GUIDE.md`, which owns the local UC visual tokens. Use this guide
for page structure, UX, responsiveness, accessibility, performance, and review
criteria before adding or changing web-facing UI.
For broader product design, design-system, UX writing, and automation UI rules,
also read `docs/DESIGN_AGENT_BEST_PRACTICES.md`.

Modern web design here does not mean trend-chasing. It means a page is useful,
fast, readable, accessible, responsive, visually coherent, and honest about what
the user can do.

## Design Order

Before touching code, answer these in plain terms:

1. Who is the page for?
2. What job should they complete on the first screen?
3. What is the primary action?
4. What information must be visible before that action makes sense?
5. What can be hidden, deferred, collapsed, or moved behind a secondary route?
6. What must still work at mobile width, 200 percent zoom, keyboard-only use,
   slow network, and reduced motion?

If the page is an app, tool, dashboard, editor, console, or workflow surface,
start with the working interface. Do not build a marketing landing page unless
the requested product surface is actually a landing page.

## Page-Type Defaults

| Page Type | Best Default | Avoid |
|---|---|---|
| App or tool | Direct workspace with navigation, primary controls, current state, and clear empty/loading/error states | Oversized hero sections, marketing copy, hidden controls |
| Dashboard | Dense but calm information hierarchy, filters near the data, compact cards or tables, visible status | Decorative cards that bury the actual metrics |
| Editor or builder | Full-height work area, stable toolbar, inspector/sidebar only when useful, clear save/export/proof states | Nested cards, shifting panels, ambiguous save status |
| Landing page | Strong first-viewport signal, real product/place/person imagery, one primary CTA, next section visible | Split hero cards, generic gradients, fake screenshots |
| Form | One clear path, persistent labels, inline validation, useful defaults, recoverable errors | Placeholder-only labels, hidden requirements, late validation |
| Documentation or wiki | Searchable structure, meaningful headings, examples, scan-friendly sections, source links | Long walls of undifferentiated text |

## Page Build Blueprint

Use this as the default mental model when an agent is asked to build a web page.
Adapt the details to the existing app framework and components.

```tsx
export function DeveloperPage() {
  return (
    <main>
      <header>
        <p>{/* small context label only when useful */}</p>
        <h1>{/* page purpose, not a slogan */}</h1>
        <p>{/* short value or state summary */}</p>
        <div>{/* primary action, secondary action */}</div>
      </header>

      <section aria-labelledby="current-state-heading">
        <h2 id="current-state-heading">Current State</h2>
        {/* most important status, data, or workflow controls */}
      </section>

      <section aria-labelledby="work-area-heading">
        <h2 id="work-area-heading">Work Area</h2>
        {/* the actual tool, form, table, editor, preview, or task list */}
      </section>

      <aside aria-label="Supporting details">
        {/* filters, history, proof, help, or metadata that should not block the primary task */}
      </aside>
    </main>
  );
}
```

The blueprint is not a visual template. It is a priority order:

- Page purpose and state first.
- Primary action visible before secondary content.
- The real work area in the first useful viewport for app/tool pages.
- Supporting detail nearby, but not competing with the main task.
- Empty/loading/error/success states designed as part of the page, not added
  after the fact.

## Responsive Layout Blueprint

Prefer component constraints over device guesses.

```css
.page-shell {
  width: min(100%, 1200px);
  margin-inline: auto;
  padding: clamp(16px, 3vw, 32px);
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

@media (min-width: 900px) {
  .workspace-grid {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
    align-items: start;
  }
}

.media-frame {
  aspect-ratio: 16 / 9;
  overflow: hidden;
}
```

Use container queries when a reusable component can appear in both narrow and
wide regions on the same page.

## Layout And Structure

- Use semantic structure first: header, nav, main, aside, section, article, form,
  footer, button, label, fieldset, and heading levels should describe the page.
- Keep one clear `h1`. Use headings to communicate structure, not just visual
  size.
- Let content define breakpoints. A component should reflow when its content no
  longer fits, not only at generic device widths.
- Prefer responsive grids, flexible columns, `minmax`, `clamp`, `max-width`,
  `aspect-ratio`, and container-aware components.
- Reserve cards for repeated items, framed tools, modals, and genuinely grouped
  content. Do not put cards inside cards.
- Keep page sections as full-width bands or unframed layouts with constrained
  inner content.
- Use stable dimensions for boards, grids, media, toolbars, counters, buttons,
  and tiles so loading, hover, or dynamic text does not shift layout.
- Make the next step visually obvious without needing explanatory text about how
  the interface works.

## Visual Hierarchy

- Give every screen a single dominant task. Secondary actions should be
  available but visually quieter.
- Use scale, weight, spacing, alignment, and contrast before adding decoration.
- Match type size to context. Hero-scale type belongs in real heroes; compact
  panels, sidebars, cards, and toolbars need tighter type.
- Do not scale font size directly with viewport width.
- Use letter spacing of `0` unless the local design system already specifies a
  different token.
- Keep text inside buttons, tabs, chips, cards, and table cells from overflowing
  at mobile widths and with long words.
- Use icons for familiar actions when a strong icon exists. Pair icons with
  labels when the action is unfamiliar or risky.
- Use color as a signal, not decoration. Do not rely on color alone to convey
  status.

## Accessibility Baseline

Target WCAG 2.2 AA unless the user explicitly requests a stricter standard.

- All interactive elements must be reachable and usable by keyboard.
- Visible focus states must be clear and not hidden by custom styling.
- Inputs need persistent labels; placeholders are examples, not labels.
- Error messages should identify the field, explain the problem, and tell the
  user how to recover.
- Text and key UI controls need sufficient contrast in every state.
- Touch and pointer targets should be large enough to use reliably.
- Do not trap focus except in intentional modals, and restore focus when a modal
  closes.
- Respect reduced-motion settings. Motion should clarify state changes, not
  become required for understanding.
- Support browser zoom and text resizing without overlapping content.

## Performance Baseline

Design affects performance. Do not treat performance as a build-step-only
concern.

- Use Core Web Vitals as the web performance floor: strong Largest Contentful
  Paint, Interaction to Next Paint, and Cumulative Layout Shift.
- Do not lazy-load the likely Largest Contentful Paint image or primary hero
  content.
- Set image width, height, or `aspect-ratio` to prevent layout shift.
- Use responsive images and compress assets. Do not ship oversized decorative
  images.
- Keep initial JavaScript small. Avoid adding heavy animation, chart, editor, or
  3D libraries unless the page actually needs them.
- Prefer CSS layout and browser-native features before custom JavaScript.
- Render useful skeleton, empty, loading, and error states instead of blank
  panels.

## Responsive Rules

- Check at least small mobile, large mobile, tablet, laptop, and wide desktop
  widths.
- On mobile, primary content should come before secondary navigation and
  supporting panels.
- Avoid horizontal scrolling except for explicit data tables, timelines, code
  blocks, or canvases.
- Use container queries or component-level constraints when a component can
  appear in multiple page widths.
- Do not hide essential actions only behind hover. Touch users must have the
  same path.
- Ensure sticky headers, toolbars, bottom bars, and modals do not cover content
  or keyboard-focused fields.

## Forms And Workflow UX

- Ask only for the fields needed to complete the task.
- Group fields by user intent, not by database shape.
- Use sensible defaults and remembered preferences when safe.
- Mark required and optional fields explicitly when both appear.
- Validate as early as helpful, but avoid noisy errors before the user has a
  chance to complete the field.
- Show progress for multi-step flows.
- Save draft state for long or high-effort forms when possible.
- Keep destructive actions separated, labeled, confirmed, and recoverable when
  practical.
- For AI-assisted workflows, show approvals, proof, blockers, and next actions;
  hide raw implementation detail unless the user asks for debug information.

## Media, Imagery, And Motion

- Use visual assets when building websites, product pages, games, portfolios,
  venue pages, or object-focused pages.
- Use real or generated bitmap imagery that reveals the product, place, object,
  gameplay, person, or state. Avoid generic blurred backgrounds and decorative
  blobs.
- Do not use SVG hero illustrations when a real or generated image would make
  the subject clearer.
- Keep animations brief, purposeful, and interruptible. Use motion for spatial
  continuity, loading feedback, or state confirmation.
- Never let motion, parallax, hover effects, or decorative overlays make text
  harder to read.

## UC Product UI Rules

- Follow `docs/UC_STYLE_GUIDE.md` for local color, typography, radius, button,
  card, and input tokens.
- UC app surfaces should feel like product software: quiet, useful, and built
  for repeated work.
- Prefer compact, scan-friendly layouts for operational tools such as chat,
  Office, agents, runs, bridges, dashboards, settings, and automation consoles.
- Do not overuse purple, blue gradients, beige/cream palettes, dark slate
  monotones, or decorative effects that make the app feel one-note.
- Avoid visible in-app instructions about obvious UI mechanics. The UI should
  make the next action clear through layout and controls.
- Use copy to name outcomes and risks, not to explain every component.

## Agent Build Checklist

Before implementation:

- Read the existing screen/component patterns and `docs/UC_STYLE_GUIDE.md`.
- Search for an existing page, layout, card, toolbar, form, modal, or status
  pattern that already solves the same job.
- Identify the page type, primary user job, primary action, and required states.
- Decide which existing components, tokens, icons, and layouts should be reused.
- Sketch the responsive structure in words: mobile order, desktop columns, and
  any sticky or scroll areas.

During implementation:

- Use semantic elements and accessible names.
- Build empty, loading, success, error, disabled, and permission states.
- Keep dimensions stable for media, grids, buttons, and dynamic labels.
- Use real data contracts or typed mock data that matches the future contract.
- Keep visual choices tied to the page type and the user's task.
- Keep developer/debug detail available behind an explicit debug, details, or
  inspect affordance instead of making it the default reading path.

Before handoff:

- Inspect mobile and desktop layouts.
- Check keyboard navigation and focus states.
- Check text wrapping, long labels, and browser zoom behavior.
- Check color contrast for text and controls.
- Check that images have useful alt text or are marked decorative.
- Run the relevant typecheck or smoke test for touched code.
- Run `git diff --check`.

## Review Checklist

Flag these during review:

- A tool or app request implemented as a marketing landing page.
- A first screen that hides the real workflow behind explanation.
- Missing labels, focus states, keyboard paths, alt text, or error recovery.
- Cards nested inside cards or page sections styled as floating cards.
- Decorative gradients, blobs, or abstract art carrying the main page.
- Layout shift from images, dynamic text, loading states, or hover states.
- Text overflow on mobile or long labels.
- Essential actions available only on hover.
- UI colors that form a one-note palette or ignore the local style guide.
- Slow pages caused by unnecessary libraries, heavy media, or client JavaScript.

## Sources To Recheck

- [web.dev responsive design basics](https://web.dev/responsive-web-design-basics/)
  and [Learn Design](https://web.dev/learn/design/) for responsive layout
  principles.
- [web.dev Core Web Vitals](https://web.dev/articles/vitals) for LCP, INP, CLS,
  and performance thresholds.
- [web.dev form accessibility](https://web.dev/learn/forms/accessibility) for
  labeling and assistive-technology-friendly forms.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and
  [W3C WAI design tips](https://www.w3.org/WAI/tips/designing/) for accessible
  web design.
- [W3C WAI forms tutorial](https://www.w3.org/WAI/tutorials/forms/) and
  [W3C form error guidance](https://design-system.w3.org/styles/form-errors.html)
  for labels, instructions, and recoverable validation.
- [MDN CSS layout](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout)
  and [MDN CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries)
  for modern layout mechanics.
- [MDN media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_Queries)
  for viewport, device, and user-preference responsive behavior.
- [Nielsen Norman Group usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
  for interaction review.
- [Material Design accessibility](https://m3.material.io/foundations/accessible-design/overview)
  for system-level accessible UI thinking.
