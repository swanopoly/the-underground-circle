import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const source = readFileSync('scripts/export-traces.ts', 'utf8');

assert(source.includes("from('agent_runs')"), 'export-traces should query agent_runs');
assert(source.includes('input_tokens, output_tokens, cached_tokens'), 'export-traces should select canonical agent_runs token columns');
assert(!source.includes('cache_read_tokens, cache_creation_tokens, final_stop_reason'), 'export-traces should not select claude_api_usage cache columns from agent_runs');
assert(source.includes('--source <source>'), 'export-traces help should keep source filter documented');
assert(source.includes(".eq('metadata->>version', args.source)"), 'export-traces should apply source filtering in the agent_runs query before pagination');

console.log('export-traces-smoketest passed');
