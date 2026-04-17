# Dynamic OG Image Design — Future Phase

> **Status: Not built. Roadmap doc only.**
>
> This describes how to add per-resource social preview images (different
> `og:image` per mission/circle) when we're ready to invest the day or two.
> The blocker is that the current Expo Web build is a plain SPA — every URL
> serves the same `web/index.html` with hardcoded meta tags. Social crawlers
> (Twitter, LinkedIn, Slack, iMessage) never see resource-specific previews.

## What "good" looks like

When someone shares `https://app.chrisswanson.xyz/join/ABC123?mission=xyz` on Twitter:

- Twitter crawler hits the URL.
- Server returns HTML with `<meta property="og:image" content="…/og?mission=xyz">`.
- The `og:image` URL hits a function that renders a PNG with:
  - The mission title (large)
  - Mission progress (X/Y tasks done)
  - The circle name + member count
  - The inviter's display name + avatar ("Chris invited you")
  - The Underground Circle logo / wordmark
- Twitter caches the image and shows a beautiful preview card.

Compare to today: same generic preview for every URL.

## The two pieces

### Piece 1 — meta tag injection per route (the harder one)

The crawler needs to see the right meta tags. Three options, ranked best to worst:

#### Option A — Netlify Edge Function with route-level prerender (recommended)

A Netlify Edge Function intercepts crawler requests, fetches the resource (mission, circle), injects fresh meta tags into `index.html`, and returns the modified HTML. Real users (non-crawler) get a 30x to the SPA without modification.

```ts
// netlify/edge-functions/og-meta.ts
import type { Context } from "https://edge.netlify.com";

const CRAWLER_UAS = /bot|crawler|spider|facebookexternalhit|twitterbot|slackbot|linkedinbot|whatsapp|discordbot/i;

export default async function (request: Request, ctx: Context) {
  const ua = request.headers.get("user-agent") || "";
  if (!CRAWLER_UAS.test(ua)) return ctx.next(); // pass through to SPA for real users

  const url = new URL(request.url);
  const missionMatch = url.pathname.match(/^\/mission\/([^/]+)/);
  const inviteParam = url.searchParams.get("mission");
  const missionId = missionMatch?.[1] || inviteParam;

  // Fetch the mission/circle metadata via Supabase REST API (anon)
  // → build title, description, image URL
  const meta = await fetchMeta(missionId);

  // Read the static index.html and rewrite meta tags
  const original = await fetch(new URL("/index.html", request.url)).then(r => r.text());
  const rewritten = original
    .replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`)
    .replace(/property="og:title" content=".*?"/, `property="og:title" content="${meta.title}"`)
    .replace(/property="og:description" content=".*?"/, `property="og:description" content="${meta.description}"`)
    .replace(/property="og:image" content=".*?"/, `property="og:image" content="${meta.imageUrl}"`);

  return new Response(rewritten, { headers: { "content-type": "text/html" } });
}

export const config = {
  path: ["/mission/*", "/join/*", "/circle/*"],
};
```

Pros: Real users untouched (no SSR cost on every page load). Crawlers get the right tags. Works with the existing SPA.

Cons: Crawler UA detection is a slight cat-and-mouse. Requires Netlify Edge Functions enabled.

#### Option B — Prerender.io (paid SaaS)

A third-party service that headless-renders your SPA and serves cached HTML to crawlers. Zero code; just add `X-Prerender-Token` to Netlify and configure a redirect.

Pros: Zero engineering. Pros if SEO is a priority.

Cons: $90+/mo at scale. Vendor dependency.

#### Option C — Switch to Next.js / Remix

Nuclear option: migrate the web build off Expo Web onto a real SSR framework. Months of work; not worth it just for OG images.

**Verdict: Option A.**

### Piece 2 — dynamic image generation (the smaller one)

A Supabase Edge Function (or Netlify Edge Function) that returns a PNG when called.

#### Recommended stack: Satori + resvg-js on Edge

[Satori](https://github.com/vercel/satori) renders JSX/HTML to SVG without a browser. [resvg-js](https://github.com/yisibl/resvg-js) converts SVG → PNG. Both run in a Cloudflare Worker / Netlify Edge / Deno environment with no node/canvas dependency.

```ts
// supabase/functions/og-image/index.ts
import satori from "https://esm.sh/satori@0.10";
import { Resvg } from "https://esm.sh/@resvg/resvg-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const missionId = url.searchParams.get("mission");
  const meta = await fetchMissionMeta(missionId); // title, progress, inviter, etc.

  const svg = await satori(
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", width: 1200, height: 630, background: "#0a0a0f", padding: 60, color: "white", fontFamily: "Inter" },
        children: [
          { type: "div", props: { style: { fontSize: 24, opacity: 0.6 }, children: meta.circleName } },
          { type: "div", props: { style: { fontSize: 64, fontWeight: 800, marginTop: 20 }, children: meta.title } },
          { type: "div", props: { style: { fontSize: 28, marginTop: 40 }, children: `${meta.tasksDone}/${meta.tasksTotal} tasks complete` } },
          { type: "div", props: { style: { marginTop: "auto", fontSize: 22, opacity: 0.7 }, children: `${meta.inviterName} invited you to ship together` } },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "Inter", data: await fetch(INTER_FONT_URL).then(r => r.arrayBuffer()), weight: 800, style: "normal" }],
    }
  );

  const png = new Resvg(svg).render().asPng();

  return new Response(png, {
    headers: {
      "content-type": "image/png",
      // 1-hour cache so Twitter doesn't hammer the function
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
});
```

Pros: Pure SVG/PNG pipeline, no browser, no headless Chrome. Sub-second cold start.

Cons: Need to host the font file (Inter or whatever). Satori has style-prop limitations (CSS subset only).

## Asset prep

- Pick one font for OG cards. Inter or JetBrains Mono. Self-host the .ttf in `assets/og/` or use a CDN mirror.
- Design the OG card layout in Figma first. 1200×630 is the canonical Twitter/Facebook dimension. Get sign-off before building.
- Pre-generate a fallback PNG for when the function errors so the meta tag never points at a 500.

## Cache strategy

- Function returns `Cache-Control: public, max-age=3600`.
- Mission/circle changes are infrequent — 1h is fine.
- For per-mission cards: cache key = mission ID + last_updated_at. When mission updates, the URL embeds a timestamp param so the crawler refetches.

## Phasing

If/when we do this:

1. **Day 1** — meta tag injection (Option A). Get the right tags rendered for crawlers, even with a placeholder image. Test with the Twitter Card Validator + LinkedIn Post Inspector.
2. **Day 2** — Satori PNG generation. Mission card layout. Wire `og:image` URL to the function.
3. **Day 3** — Circle card layout, invite card layout, tuning.

## Why we deferred

- The product has bigger gaps right now (Stripe checkout, landing page, claim-mode UI for Codex's work).
- OG image generation is highest ROI **after** there's something worth sharing — i.e., after the marketing site + onboarding are tightened. Sharing leaky early-stage links hurts more than it helps.
- The current `?mission=xyz` deep-link in the share URL works fine for the recipient experience; it's only the crawler preview that's missing.

## File map (when ready to build)

| Concern | File |
|---|---|
| Edge function: meta injection | `netlify/edge-functions/og-meta.ts` |
| Edge function config | `netlify.toml` (add `[[edge_functions]]` block) |
| OG image generator | `supabase/functions/og-image/index.ts` |
| Card layout helpers | `supabase/functions/og-image/layouts/{mission,circle,invite}.ts` |
| Fonts | `assets/og/Inter-Bold.ttf` (or CDN) |
| Fallback image | `web/og-fallback.png` |
