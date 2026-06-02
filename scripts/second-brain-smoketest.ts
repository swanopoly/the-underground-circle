import assert from 'node:assert/strict';
import { buildDigitalBrainSystemMap, DIGITAL_BRAIN_DB_TABLES } from '../src/lib/digitalBrainSystemMap';
import {
  buildNextSecondBrainReviewMetadata,
  buildSecondBrainAgentBrief,
  buildSecondBrainBaseViews,
  buildSecondBrainPromptContext,
  buildSecondBrainTitle,
  extractSecondBrainTags,
  getSecondBrainReviewState,
  scoreSecondBrainConnection,
  summarizeSecondBrainContent,
  type SecondBrainPromptNote,
} from '../src/lib/secondBrainCore';

function note(partial: Partial<SecondBrainPromptNote> & { id?: string }): SecondBrainPromptNote & { id: string } {
  return {
    id: partial.id || 'note-1',
    status: partial.status || 'processed',
    note_kind: partial.note_kind || 'note',
    title: partial.title || 'Untitled',
    content: partial.content || '',
    summary: partial.summary || null,
    tags: partial.tags || [],
    importance: partial.importance ?? 0.5,
    source_memory_id: partial.source_memory_id ?? null,
    metadata: partial.metadata || {},
    created_at: partial.created_at || '2026-05-01T12:00:00Z',
    updated_at: partial.updated_at || '2026-05-01T12:00:00Z',
  };
}

const tags = extractSecondBrainTags('Save #wordpress login flow and #AI automation notes for Browserbase form posting.');
assert(tags.includes('wordpress'), 'extracts explicit tags');
assert(tags.includes('ai'), 'normalizes explicit tag case');
assert(tags.includes('browserbase'), 'extracts useful keywords');

const title = buildSecondBrainTitle('\n# Customer CRM automation plan\n\nBody');
assert.equal(title, 'Customer CRM automation plan');

const summary = summarizeSecondBrainContent('This is a long research note. '.repeat(40), 90);
assert(summary.length <= 91, 'summary respects cap');
assert(summary.endsWith('...') || summary.endsWith('…'), 'summary marks truncation');

const first = note({
  id: 'a',
  title: 'WordPress posting automation',
  content: 'Use browser automation to login, draft, edit, and publish WordPress posts.',
  tags: ['wordpress', 'automation', 'browser'],
});
const second = note({
  id: 'b',
  title: 'WordPress form workflow',
  content: 'Browser agents need vault-backed login and posting permissions.',
  tags: ['wordpress', 'automation', 'vault'],
});
const unrelated = note({
  id: 'c',
  title: 'Solana trading risk',
  content: 'Track drawdown and position sizing.',
  tags: ['solana', 'trading'],
});

assert(scoreSecondBrainConnection(first, second) > scoreSecondBrainConnection(first, unrelated), 'related notes score higher');

const context = buildSecondBrainPromptContext([first, second], [{
  title: 'User preference',
  content: 'Prefer private keys and circle-specific memories.',
  memory_kind: 'preference',
  scope: 'user',
}]);
assert(context.includes('Circle Digital Brain Context'), 'context has heading');
assert(context.includes('WordPress posting automation'), 'context includes notes');
assert(context.includes('User preference'), 'context includes memories');

const now = new Date('2026-05-13T12:00:00Z').getTime();
const dueNote = note({
  id: 'due',
  status: 'inbox',
  title: 'Inbox clip',
  content: 'Needs review for the agent brief.',
  metadata: { reviewDueAt: '2026-05-12T12:00:00Z', reviewIntervalDays: 1 },
  updated_at: '2026-05-11T12:00:00Z',
});
const review = getSecondBrainReviewState(dueNote, now);
assert.equal(review.urgency, 'due', 'review state finds due notes');

const nextReview = buildNextSecondBrainReviewMetadata(dueNote, 'reviewed', now);
assert.equal(nextReview.reviewCount, 1, 'review metadata increments count');
assert.equal(nextReview.lastReviewAction, 'reviewed', 'review metadata stores action');

const bases = buildSecondBrainBaseViews([first, second, dueNote], now);
assert(bases.find((view) => view.id === 'review-due')?.noteIds.includes('due'), 'base views include review due');
assert(bases.find((view) => view.id === 'agent-context'), 'base views include agent context view');

const brief = buildSecondBrainAgentBrief([first, second, dueNote], [{
  title: 'Automation rule',
  content: 'Review due notes before using them as durable automation context.',
  memory_kind: 'rule',
  scope: 'circle',
}]);
assert(brief.includes('.web Digital Brain Agent Brief'), 'agent brief has heading');
assert(brief.includes('Priority notes'), 'agent brief includes priority notes');

const systemMap = buildDigitalBrainSystemMap({
  notes: [{
    id: 'brain-note-1',
    circle_id: 'circle-1',
    created_by: 'user-1',
    source_memory_id: 'memory-1',
    parent_note_id: null,
    status: 'processed',
    note_kind: 'memory_digest',
    visibility: 'private',
    title: 'Synced memory note',
    content: 'A synced memory note.',
    summary: 'A synced memory note.',
    tags: ['memory'],
    aliases: [],
    importance: 0.7,
    metadata: {},
    created_at: '2026-05-13T12:00:00Z',
    updated_at: '2026-05-13T12:00:00Z',
  }],
  memories: [{
    id: 'memory-1',
    scope: 'user',
    circle_id: 'circle-1',
    memory_kind: 'fact',
    title: 'System memory',
    content: 'The Digital Brain maps memory movement through the system.',
    is_active: true,
    visibility: 'private',
    importance: 0.8,
    created_at: '2026-05-13T12:00:00Z',
    source_surface: 'main_chat',
  }],
  dbStats: {
    memory_entries: { table: 'memory_entries', label: 'Memories', count: 1, ok: true },
  },
});
assert(systemMap.nodes.some(node => node.id === 'backpack-brain'), 'system map includes digital brain node');
assert(systemMap.nodes.some(node => node.id === 'memory-memory-1'), 'system map includes memory nodes');
assert(systemMap.edges.some(edge => edge.kind === 'memory'), 'system map includes memory flow edges');
assert(DIGITAL_BRAIN_DB_TABLES.some(table => table.table === 'circle_second_brain_notes'), 'db table catalog includes brain notes');

console.log('second-brain smoketest passed');
