import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = '/Users/cswanson/the-underground-circle';
const srcFile = path.join(repoRoot, 'src/lib/conversationalBuild.ts');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-convo-build-'));
const outFile = path.join(tmpDir, 'conversationalBuild.js');

const source = fs.readFileSync(srcFile, 'utf8');
const transpiled = ts.transpileModule(
  source.replace(
    /import\s+\{\s*Platform\s*\}\s+from\s+['"]react-native['"];?/,
    'const Platform = { OS: "web" };',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: srcFile,
  },
).outputText;
fs.writeFileSync(outFile, transpiled, 'utf8');

const mod = await import(pathToFileURL(outFile).href);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const idle = { state: 'idle', updatedAt: new Date(0).toISOString() };

assert(mod.hasBuildIntentHint('I want to build a SaaS landing page') === true, 'should detect build intent');
assert(mod.hasBuildIntentHint('what is a monad?') === false, 'should not detect normal question as build intent');

const exploring = mod.advanceOnUserMessage(idle, 'I want to build a dark-mode landing page for my AI agent app');
assert(exploring.state === 'exploring', 'build intent should enter exploring');

const marker = mod.extractBuildMarker('Here is the brief.\n<BUILD_READY>{"brief":"Dark landing page with hero, pricing, testimonials."}</BUILD_READY>');
assert(marker?.brief?.includes('pricing'), 'should parse BUILD_READY brief');
assert(!marker?.cleanedText?.includes('BUILD_READY'), 'cleaned text should remove marker');

const tooEarly = mod.advanceOnAssistantMessage(exploring, marker, 'Here is the brief.');
assert(tooEarly.state === 'exploring', 'assistant marker should be ignored before discovery');

const questioned = mod.advanceOnAssistantMessage(exploring, null, 'Who is this for and what sections do you need?');
assert(questioned.state === 'exploring', 'clarifying question should keep exploring');
assert(questioned.assistantQuestionCount === 1, 'clarifying question should increment assistant question count');

const userDetails = mod.advanceOnUserMessage(questioned, 'It is for my AI agent app and needs hero, features, pricing, testimonials.');
assert(userDetails.userTurnCount >= 2, 'follow-up answer should increment user turn count');

const converging = mod.advanceOnAssistantMessage(userDetails, marker, 'Sounds good.');
assert(converging.state === 'converging', 'assistant marker should enter converging after discovery');

const confirmed = mod.advanceOnUserMessage(converging, 'yes');
assert(confirmed.state === 'confirmed', 'yes should confirm converging brief');

const refreshed = mod.advanceOnUserMessage(converging, 'actually add testimonials and a FAQ');
assert(refreshed.state === 'converging', 'build edits should stay converging');
assert(refreshed.topic?.toLowerCase().includes('testimonials'), 'topic should refresh from latest build detail');

const pivoted = mod.advanceOnUserMessage(converging, 'hey what is a monad?');
assert(pivoted.state === 'idle', 'off-topic pivot should drop build mode');

console.log('check-conversational-build: ok');
