/**
 * computer-sequence-program-core-smoketest — pins the deterministic tool
 * program compiler: the exact user phrasings that must compile, the edit/
 * ambiguous phrasings that must NOT, and the program contents (tool names,
 * exact args, forbidden-tool rules) the agent loop depends on.
 *
 * Run: npm run smoke:computer-sequence-program-core
 */

import { compileComputerSequenceProgram } from '../src/lib/computerSequenceProgramCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed += 1; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

// ── The exact ask that motivated this core ──────────────────────────────────
{
  const program = compileComputerSequenceProgram('Open Photoshop and start a new project 600 x 600');
  assert(!!program, 'the motivating ask compiles');
  assert(program?.id === 'photoshop_new_document', 'family id pinned');
  assert(program?.authorization.mode === 'direct_user_request', 'bounded unsaved draft is authorized by the current direct request');
  const tools = (program?.steps || []).map((step) => step.tool);
  assert(tools.join(' → ') === [
    'desktop.photoshop_document_status',
    'desktop.launch_app',
    'desktop.photoshop_document_status',
    'desktop.photoshop_create_document',
    'desktop.photoshop_document_status',
  ].join(' → '), `observe → launch → wait → create → verify (got ${tools.join(' → ')})`);
  const create = program?.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  assert(create?.args.widthPx === 600 && create?.args.heightPx === 600, 'create carries the exact 600x600');
  const launch = program?.steps.find((step) => step.tool === 'desktop.launch_app');
  assert(launch?.args.appName === 'Photoshop', 'launch targets Photoshop');
}

// ── Phrasing variants ───────────────────────────────────────────────────────
{
  for (const [task, w, h] of [
    ['Open Photoshop and start a new project with 600 x 600 pixels', 600, 600],
    ['open photoshop and create a new document 1080x1080', 1080, 1080],
    ['make a new 1920 by 1080 canvas in Photoshop', 1920, 1080],
    ['photoshop: new blank document 300×250', 300, 250],
    ['Start a new Photoshop project 512 x 512 px', 512, 512],
    ['Can you open Photoshop and start a new project 600 x 600?', 600, 600],
    ['Could you open Photoshop and start a new project 640 x 480?', 640, 480],
    ['Would you open Photoshop and start a new project 800 x 600?', 800, 600],
    ['I need you to open Photoshop and start a new project 1024 x 768', 1024, 768],
    ['Can you open Photoshop and create a 600 x 600 document?', 600, 600],
    ['I need you to open Photoshop and create a 600 by 600 document', 600, 600],
  ] as const) {
    const program = compileComputerSequenceProgram(task);
    const create = program?.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
    assert(create?.args.widthPx === w && create?.args.heightPx === h, `variant compiles ${w}x${h}: "${task}"`);
  }
}

// ── Must NOT compile ────────────────────────────────────────────────────────
{
  for (const task of [
    'resize the image to 600 x 600 in photoshop',            // edit, not create
    'crop the photo to 600x600 in Photoshop',                // edit
    'export the document as 600 x 600 from photoshop',       // edit/export
    'open photoshop',                                        // no dimensions
    'start a new project 600 x 600',                         // no app named
    'open illustrator and start a new project 600 x 600',    // wrong app
    'convert this to a 600x600 png in photoshop',            // convert
    'open photoshop and create a new document 600x600 then save it',
    'open photoshop and create a new document 600x600 then export it',
    'open photoshop and create a new document 600x600 and overwrite test.psd',
    'open photoshop and create a new document 600x600 then delete a layer',
    'open photoshop and create a new document 600x600 then log in',
    'open photoshop and create a new document 600x600 then purchase credits',
    'open photoshop and create a new document 600x600 then add text',
    'open photoshop and create a new document 600x600 then place an asset',
    'open photoshop and create a new document 600x600 then rotate it',
    'open photoshop and create a new document 600x600 then frobnicate it',
    '',                                                      // empty
  ]) {
    assert(compileComputerSequenceProgram(task) === null, `does not compile: "${task || '(empty)'}"`);
  }
}

// ── Dimension bounds ────────────────────────────────────────────────────────
{
  assert(compileComputerSequenceProgram('open photoshop and create a new document 0 x 600') === null, 'zero width rejected');
  assert(compileComputerSequenceProgram('open photoshop and create a new document 99999 x 600') === null, 'oversize rejected (dimension regex caps at 5 digits, clamp at 30000)');
  const max = compileComputerSequenceProgram('open photoshop and create a new document 30000 x 30000');
  const createMax = max?.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  assert(createMax?.args.widthPx === 30000, 'max dimension 30000 accepted');
  assert(max?.authorization.mode === 'chat_plan_approval', 'resource-heavy exact allocation retains a Chat plan approval');
  assert(
    compileComputerSequenceProgram('open photoshop and create a new document 4096 x 4096')?.authorization.mode === 'direct_user_request',
    '4096x4096 remains inside the direct-request resource bound',
  );
  assert(
    compileComputerSequenceProgram('open photoshop and create a new document 4097 x 4096')?.authorization.mode === 'chat_plan_approval',
    'one dimension beyond 4096 requires Chat plan approval',
  );
  assert(compileComputerSequenceProgram('open photoshop and create a new document 30001 x 600') === null, '30001 rejected');
}

// ── Prompt block contract ───────────────────────────────────────────────────
{
  const program = compileComputerSequenceProgram('Open Photoshop and start a new project 600 x 600');
  const block = program?.promptBlock || '';
  assert(block.startsWith('## EXACT TOOL PROGRAM'), 'prompt block leads with the program heading');
  assert(block.includes('desktop.photoshop_create_document {"widthPx":600,"heightPx":600}'), 'prompt block spells the exact create call');
  assert(/do not re-plan/i.test(block), 'prompt block forbids re-planning');
  assert(/no active document/i.test(block) && /expected[\s\S]{0,6}starting[\s\S]{0,6}state/i.test(block), 'prompt block neutralizes the no-document blocker');
  assert(/file_search|file_stat/.test(block) && /Do NOT call/.test(block), 'prompt block forbids the noise tools');
  assert(/wait ~10 seconds/i.test(block), 'prompt block carries the cold-start retry rule');
  assert(/direct command authorizes/i.test(block), 'prompt block records direct-request authority');
  assert(block.length < 2600, `prompt block stays compact (${block.length} chars)`);
}

// ── Totality ────────────────────────────────────────────────────────────────
{
  for (const hostile of [null, undefined, 123 as any, { toString() { throw new Error('boom'); } } as any, 'x'.repeat(5000)]) {
    let ok = true;
    try { compileComputerSequenceProgram(hostile); } catch { ok = false; }
    assert(ok, `total on hostile input (${typeof hostile === 'string' ? 'long string' : String(hostile && typeof hostile)})`);
  }
}

console.log(`\n${passed} assertions passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('All computer-sequence-program-core smoke cases passed — the ask compiles to the exact calls.');
