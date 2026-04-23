/**
 * computerUseTemplates — curated starting-point prompts for the Computer
 * Use agent. Shown in the BrowserTaskModal as one-tap shortcuts and in
 * post-completion follow-up suggestions.
 *
 * Each template names the concrete expected outcome so users don't have
 * to draft a brief from scratch. Phrasing is optimized for the agent's
 * structured-findings behavior — templates that ask for lists will
 * produce clickable cards; single-answer templates won't.
 */

export interface ComputerUseTemplate {
  /** Internal key, stable across UI moves. */
  id: string;
  /** Short label shown on the chip. */
  label: string;
  /** One-sentence description shown below the label / in tooltip. */
  description: string;
  /** The actual task text submitted to the agent. Can include `{{query}}`
   *  if `needsInput` is true; the UI fills it in. */
  prompt: string;
  /** True → the chip prefills the prompt but leaves a blank where the
   *  user types their query. False → submits immediately. */
  needsInput: boolean;
  /** Which category — drives icon + color. */
  category: 'research' | 'compare' | 'find' | 'extract' | 'monitor' | 'post' | 'files' | 'apps' | 'hybrid';
}

export const COMPUTER_USE_TEMPLATES: ComputerUseTemplate[] = [
  {
    id: 'research-topic',
    label: 'Research a topic',
    description: 'Deep-dive and summarize with sources',
    prompt: 'Research "{{query}}" and give me a concise summary with 5 key findings, each with a source link.',
    needsInput: true,
    category: 'research',
  },
  {
    id: 'find-top-products',
    label: 'Top products',
    description: 'Find the best-rated products in a category',
    prompt: 'Find the top 5 {{query}} and return a structured list with name, price, rating, and a one-sentence note for each.',
    needsInput: true,
    category: 'find',
  },
  {
    id: 'compare-options',
    label: 'Compare options',
    description: 'Side-by-side comparison of alternatives',
    prompt: 'Compare {{query}} — strengths, weaknesses, pricing, and which one fits which use case.',
    needsInput: true,
    category: 'compare',
  },
  {
    id: 'summarize-article',
    label: 'Summarize an article',
    description: 'TL;DR a URL in your own words',
    prompt: 'Go to {{query}} and summarize the article in 5 bullet points, flagging any claims worth verifying.',
    needsInput: true,
    category: 'extract',
  },
  {
    id: 'latest-news',
    label: 'Latest news',
    description: 'Top recent stories on a topic',
    prompt: 'Find the top 5 news stories from the last 7 days about "{{query}}", each with a headline, source, one-line summary, and link.',
    needsInput: true,
    category: 'research',
  },
  {
    id: 'price-check',
    label: 'Price check',
    description: 'Find current price of a specific product',
    prompt: 'Look up the current retail price of "{{query}}" at 3 major retailers. Report price, availability, and direct link per retailer.',
    needsInput: true,
    category: 'find',
  },
  {
    id: 'extract-contacts',
    label: 'Extract contacts',
    description: 'Pull emails / contacts from a site',
    prompt: 'Visit {{query}} and extract any public contact emails, support addresses, or contact-form URLs. Do not attempt to bypass login walls.',
    needsInput: true,
    category: 'extract',
  },
  {
    id: 'monitor-status',
    label: 'Check a status page',
    description: 'Current status of a service',
    prompt: 'Go to the status page for "{{query}}" and report the current system status, any ongoing incidents, and the timestamp of the report.',
    needsInput: true,
    category: 'monitor',
  },
];

// Follow-up suggestions shown after a run completes, based on category.
// Each suggestion is a short phrase the user can tap to kick off a new
// run with follow-up context — the agent already has the previous
// summary + findings in its 30-min follow-up window.
export const FOLLOW_UP_SUGGESTIONS: Record<ComputerUseTemplate['category'], string[]> = {
  research: [
    'Dig deeper on the most important finding',
    'Find conflicting viewpoints',
    'Who are the key people / organizations behind this?',
  ],
  find: [
    'Which is the cheapest?',
    'Which has the best reviews?',
    'Tell me more about #1',
  ],
  compare: [
    'Which one would you pick for a beginner?',
    'What would change your recommendation?',
  ],
  extract: [
    'Verify the top 3 claims',
    'Find the original sources',
  ],
  monitor: [
    'Set up a follow-up check in 30 minutes',
    'What caused the latest incident?',
  ],
  post: [
    'Post a follow-up',
  ],
  files: [
    'Search for a narrower file name',
    'Open the most relevant match',
    'Summarize what you found',
  ],
  apps: [
    'Take the next step in the app',
    'Show me the important fields',
    'Summarize what changed',
  ],
  hybrid: [
    'Continue with the next surface',
    'Summarize what was completed so far',
    'Tell me what access is still needed',
  ],
};

export function renderTemplate(t: ComputerUseTemplate, query: string): string {
  if (!t.needsInput) return t.prompt;
  return t.prompt.replace(/\{\{query\}\}/g, query.trim());
}
