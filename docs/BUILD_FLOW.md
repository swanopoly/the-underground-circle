# Building Pages & Code in Chat — How It Works

_Written for users. Last updated 2026-04-20._

## Two ways to start a build

### 1. Just talk to the agent (recommended)

Say what you want in plain English. Examples that trigger discovery:

> *"I want to build a landing page for my AI agent"*
> *"Let's build a portfolio site"*
> *"Help me make a dashboard for my ops team"*

What happens next:

1. An **amber "Exploring build"** chip appears above the composer.
2. The agent asks **one focused clarifying question** per turn — about purpose, audience, key sections, style.
3. After 2-4 exchanges the chip turns **green "Brief proposed"** and shows the exact brief it plans to use.
4. Tap **Start** (or reply *"yes"* / *"go"* / *"ship it"*) to launch the build.
5. Tap **Cancel** any time to drop discovery and go back to normal chat.

The agent reaches for Claude Opus 4.7 during the `converging` phase specifically — that's where reasoning matters — and drops back to Sonnet/Haiku for casual chat. You don't have to pick a model.

### 2. Slash command (for when you already know what you want)

If your brief is very detailed (structure + purpose + style all specified), type:

```
/build-page dark-mode landing page for my AI agent SaaS with hero (bold headline + waitlist CTA), 3 feature tiles, pricing tier comparison, testimonials, FAQ, and footer — brutalist aesthetic with neon accents
```

- Detailed briefs fire the build stream directly.
- Thin briefs (*"/build-page app"*) drop into the same discovery flow as option 1.

Aliases: `/build <brief>`, `/build-page <brief>`, `/code <brief>`.

## Where the files go

When a build finishes, the agent posts a "Where this lives" message with three destinations:

| Destination | What it does | How |
|---|---|---|
| **Build Studio** (default) | Saves the HTML to this thread's local build history, survives reloads on this device. | Opens automatically in the sidecar when you build. |
| **Save to GitHub** | Commits the HTML to a repo branch you pick. | Build Studio → "GitHub Save" button. Requires GitHub connected (Marketplace → GitHub). |
| **Deploy to Netlify** | Publishes the page live on a Netlify URL. | Build Studio → "Deploy" button. Requires Netlify connected. |
| **Download HTML** | Downloads the file to your machine. | Build Studio → ⋯ menu → "Download". |

Every revision is kept — you can revert, regenerate, and compare inside the Build Studio.

## Editing after a build

Once a page exists in the Build Studio:

- **Quick tweaks** — type things like *"make the hero darker"* or *"add a section about pricing"* into chat. The agent regenerates with the tweak applied.
- **Click-to-edit** — click an element in the preview and describe the change.
- **Regenerate** — tap the "Regenerate" button in the sidecar.

## What triggers discovery vs. direct build

| Input | Route |
|---|---|
| *"build a tool"* | Discovery |
| *"I want to build a landing page"* | Discovery |
| *"/build-page app"* | Discovery (brief too thin) |
| *"/build-page landing page"* | Discovery |
| *"/build-page dark-mode landing page for my AI agent SaaS with hero, features, pricing, testimonials, FAQ, and CTA — brutalist aesthetic"* | Direct build |
| *"make me smarter"* (meta-conversation) | Plain chat — no build |
| *"what is Next.js"* (question) | Plain chat |
| Template card tap | Direct build (you already picked) |

## Cancelling or exiting discovery

- Tap **Cancel** on the chip.
- Start talking about something else — the agent detects the pivot and drops build mode.
- Wait 24 hours — stale discovery states auto-reset.
