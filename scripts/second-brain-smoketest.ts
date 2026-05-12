import assert from 'node:assert/strict';
import {
  buildSecondBrainPromptContext,
  buildSecondBrainTitle,
  extractSecondBrainTags,
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

console.log('second-brain smoketest passed');
