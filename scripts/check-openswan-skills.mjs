#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: projectRoot, stdio: 'pipe', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-openswan-skills-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

const runnerSource = `
import { resolveOpenSwanSkillsFromCatalog } from '../src/lib/openswanSkillResolution';
import type { Skill } from '../src/lib/skillRegistry';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];

const skills: Skill[] = [
  { id: '1', name: 'bug_hunt', displayName: 'Bug Hunt', description: 'Debug root cause and validate the fix.', category: 'coding', promptFragment: 'Find the likely root cause before proposing the patch.', requiredTools: ['code.inspect'], costTier: 'light' },
  { id: '2', name: 'test_writer', displayName: 'Test Writer', description: 'Add or define regression checks.', category: 'coding', promptFragment: 'Always define the regression proof path.', requiredTools: ['verification.tests'], costTier: 'light' },
  { id: '3', name: 'critique_pr', displayName: 'Critique PR', description: 'Review changes with findings first.', category: 'review', promptFragment: 'Lead with the highest-severity findings.', requiredTools: ['code.review'], costTier: 'light' },
  { id: '4', name: 'research_topic', displayName: 'Research Topic', description: 'Investigate and compare options.', category: 'research', promptFragment: 'State findings, tradeoffs, and recommendation.', requiredTools: ['fetch_url'], costTier: 'heavy' },
  { id: '5', name: 'summarize_thread', displayName: 'Summarize Thread', description: 'Condense long threads into actionable summaries.', category: 'analysis', promptFragment: 'Preserve decisions and open questions.', requiredTools: [], costTier: 'free' },
  { id: '6', name: 'refactor', displayName: 'Refactor', description: 'Reshape code while preserving behavior.', category: 'coding', promptFragment: 'Prefer smaller safe transformations.', requiredTools: ['code.generate'], costTier: 'light' },
];

const debugResolution = resolveOpenSwanSkillsFromCatalog({
  enabledSkills: [skills[0]],
  allSkills: skills,
  recommendedSkillNames: [],
  mode: 'support',
  taskKind: 'debug',
  query: 'Fix the broken auth flow and add a regression test.',
});

if (debugResolution.skills.length < 2) failures.push('debug resolution should blend enabled and inferred skills');
if (!debugResolution.skills.some((skill) => skill.name === 'bug_hunt' && skill.source === 'enabled')) {
  failures.push('enabled skills should stay active in the resolution');
}
if (!debugResolution.skills.some((skill) => skill.name === 'test_writer')) {
  failures.push('debug resolution should pull in test_writer for regression coverage');
}
if (!/OpenSwan Active Skills/.test(debugResolution.promptBlock)) {
  failures.push('resolution should produce a structured skills prompt block');
}
if (!/Execution pattern:/.test(debugResolution.promptBlock)) {
  failures.push('resolution prompt should include playbook execution guidance');
}
if (!/Avoid:/.test(debugResolution.promptBlock)) {
  failures.push('resolution prompt should include anti-pattern guidance');
}
if (!debugResolution.skills.find((skill) => skill.name === 'bug_hunt')?.playbook?.executionPattern?.length) {
  failures.push('resolved skills should carry local playbooks when available');
}

const researchResolution = resolveOpenSwanSkillsFromCatalog({
  enabledSkills: [],
  allSkills: skills,
  recommendedSkillNames: [],
  mode: 'research',
  taskKind: 'research',
  query: 'Research the tradeoffs between two queueing approaches and recommend one.',
});

if (!researchResolution.skills.some((skill) => skill.name === 'research_topic')) {
  failures.push('research resolution should infer research_topic');
}
if (!researchResolution.skills.some((skill) => skill.name === 'summarize_thread')) {
  failures.push('research resolution should include summarization support');
}

const reviewResolution = resolveOpenSwanSkillsFromCatalog({
  enabledSkills: [],
  allSkills: skills,
  recommendedSkillNames: [],
  mode: 'review',
  taskKind: 'review',
  query: 'Review this PR for regressions and missing tests.',
});

if (!reviewResolution.skills.some((skill) => skill.name === 'critique_pr')) {
  failures.push('review resolution should prioritize critique_pr');
}
if (reviewResolution.skills[0]?.source === 'inferred' && reviewResolution.skills[0]?.name !== 'critique_pr') {
  failures.push('review resolution should keep the most relevant review skill near the top');
}

if (failures.length) {
  console.error('OpenSwan skills failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('OpenSwan skills checks passed.');
`;

  const tsconfigSource = JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      rootDir: projectRoot,
      outDir,
    },
    include: [
      runnerPath,
      path.join(projectRoot, 'src/lib/openswanSkillResolution.ts'),
      path.join(projectRoot, 'src/lib/skillRegistry.ts'),
    ],
  }, null, 2);

  await fs.writeFile(runnerPath, runnerSource, 'utf8');
  await fs.writeFile(tsconfigPath, tsconfigSource, 'utf8');

  const tscBin = require.resolve('typescript/bin/tsc');
  try {
    await run(process.execPath, [tscBin, '-p', tsconfigPath]);
    const compiledRunner = path.join(outDir, path.relative(projectRoot, runnerPath)).replace(/\.ts$/, '.js');
    const { stdout } = await run(process.execPath, [compiledRunner]);
    process.stdout.write(stdout);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
