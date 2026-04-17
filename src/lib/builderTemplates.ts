/**
 * Builder prompt templates — starting points for /build-page.
 *
 * These are curated seeds, not output. The user can still tweak after.
 * Each template has a concrete, high-signal brief — generic phrasing
 * produces generic pages, so the briefs carry enough specificity that
 * the first result is usable.
 */

export interface BuilderTemplate {
  id: string;
  category: 'landing' | 'personal' | 'launch' | 'utility';
  name: string;
  description: string;
  brief: string;
  icon?: string;
}

export const BUILDER_TEMPLATES: BuilderTemplate[] = [
  // Landing pages
  {
    id: 'saas-landing',
    category: 'landing',
    name: 'SaaS Landing',
    description: 'Hero + 3 feature blocks + pricing tiers + CTA',
    icon: '◈',
    brief: 'Landing page for a SaaS product. Include: hero section with headline + subhead + primary CTA, three-column feature grid with icons, pricing table with Free/Pro/Team tiers, social proof section (logos row + 1 testimonial), and a final CTA before the footer.',
  },
  {
    id: 'agency-site',
    category: 'landing',
    name: 'Agency Site',
    description: 'Bold hero, services, recent work, contact',
    icon: '◆',
    brief: 'Agency website with a bold typography-heavy hero, a services section listing 4 offerings, a recent-work grid with 6 project tiles (use CSS gradients as placeholders), a short about paragraph, and a contact form.',
  },
  {
    id: 'restaurant',
    category: 'landing',
    name: 'Restaurant',
    description: 'Menu highlights, hours, reservations',
    icon: '◎',
    brief: 'Website for a neighborhood restaurant. Warm color palette. Hero with a tagline, a menu highlights section (6 featured dishes with brief descriptions and prices), hours of operation, location map placeholder (styled div), and a reservations call-to-action.',
  },

  // Personal
  {
    id: 'dev-portfolio',
    category: 'personal',
    name: 'Dev Portfolio',
    description: 'Projects, stack, contact — terminal aesthetic',
    icon: '◉',
    brief: 'Developer portfolio with a terminal-inspired aesthetic (monospace fonts, subtle scanlines). About section with 2–3 lines, a stack/skills row, a projects grid with 4 projects (each with name, one-line description, and tags), a writing section with 3 recent posts as link-only entries, and contact links at the bottom.',
  },
  {
    id: 'photo-portfolio',
    category: 'personal',
    name: 'Photographer',
    description: 'Full-bleed gallery, minimal chrome',
    icon: '○',
    brief: 'Photographer portfolio. Minimalist black background, sparse chrome. A full-bleed hero image (use a gradient placeholder), a masonry-style gallery grid of 9 images with hover zoom, a short about paragraph, and a simple contact email.',
  },
  {
    id: 'writer-site',
    category: 'personal',
    name: 'Writer',
    description: 'Recent posts, bio, newsletter signup',
    icon: '◐',
    brief: 'Personal site for a writer. Serif typography, generous whitespace. A short bio at the top, a reverse-chronological list of 5 recent posts (title + date + 2-line excerpt), a newsletter signup form, and footer social links.',
  },

  // Launch / promo
  {
    id: 'coming-soon',
    category: 'launch',
    name: 'Coming Soon',
    description: 'Countdown, email capture, teaser',
    icon: '◌',
    brief: 'Pre-launch "coming soon" page. Dark, high-contrast aesthetic. A large headline teaser, a countdown-style date placeholder ("launching April 30"), a one-line value proposition, an email capture form with clear opt-in copy, and three bullet "what to expect" points.',
  },
  {
    id: 'event-page',
    category: 'launch',
    name: 'Event',
    description: 'Date, speakers, schedule, RSVP',
    icon: '◇',
    brief: 'One-page event site. Headline with event name and date, a venue/format line, speakers grid with 6 speakers (photo placeholder + name + one-line bio), a schedule as a vertical timeline, an RSVP form with name + email, and sponsors row at the bottom.',
  },
  {
    id: 'changelog',
    category: 'launch',
    name: 'Changelog',
    description: 'Release notes, versioned',
    icon: '▤',
    brief: 'Product changelog page. Reverse-chronological list of 6 versioned releases (each with version, date, a short headline, and 3–5 bullet-point changes grouped as Added / Changed / Fixed). Clean typography, no sidebar.',
  },

  // Utility
  {
    id: 'pricing-page',
    category: 'utility',
    name: 'Pricing Page',
    description: '3-tier comparison + FAQ',
    icon: '$',
    brief: 'Dedicated pricing page. Three pricing tiers side by side (Free / Pro / Business), a feature comparison table beneath listing 10 features with checkmarks/dashes, a 5-question FAQ accordion, and a contact-sales CTA at the bottom.',
  },
  {
    id: 'about-page',
    category: 'utility',
    name: 'About Page',
    description: 'Story, team, values',
    icon: '❖',
    brief: 'About page for a company. An origin story (2–3 paragraphs), a "how we work" section with 3 principle cards, a team grid with 6 people (avatar placeholder + name + role), and a values strip at the bottom.',
  },
  {
    id: 'docs-home',
    category: 'utility',
    name: 'Docs Home',
    description: 'Left nav, getting-started cards',
    icon: '≡',
    brief: 'Documentation home page. Sidebar navigation with 8 doc categories, main content area with a "getting started" hero, four quick-start cards (Install / Hello World / Configuration / Deploy), and a search input at the top of the sidebar.',
  },
];

export const BUILDER_TEMPLATE_CATEGORIES: Array<{ key: BuilderTemplate['category']; label: string }> = [
  { key: 'landing', label: 'LANDING' },
  { key: 'personal', label: 'PERSONAL' },
  { key: 'launch', label: 'LAUNCH' },
  { key: 'utility', label: 'UTILITY' },
];

export function templatesByCategory(cat: BuilderTemplate['category']): BuilderTemplate[] {
  return BUILDER_TEMPLATES.filter(t => t.category === cat);
}
