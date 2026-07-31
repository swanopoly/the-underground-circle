/**
 * computerSequenceProgramCore — compile a deterministic desktop ask into a
 * LITERAL tool program the agent loop executes in order, instead of asking
 * the model to improvise a plan against the full evidence-contract prose.
 *
 * Motivation (2026-07-31): "Open Photoshop and start a new project 600 x 600"
 * failed for days because the model had to reconstruct a 4-call sequence from
 * a multi-KB advisory context and kept stalling on observe-first guidance
 * that does not apply to from-scratch creation. The planner already PARSES
 * the ask deterministically — this core finishes the job by emitting the
 * exact calls. The model's only role is sequencing and honest reporting;
 * every call still runs through the normal typed-tool approval/proof path.
 *
 * Deliberately NARROW: only task families whose steps map 1:1 onto typed
 * bridge tools compile; anything else returns null and the normal planning
 * flow runs unchanged. Pure + tsx-loadable
 * (smoke: scripts/computer-sequence-program-core-smoketest.ts).
 */

export interface ComputerSequenceProgramStep {
  tool: string;
  args: Record<string, unknown>;
  note: string;
}

export interface ComputerSequenceProgram {
  id: string;
  title: string;
  steps: ComputerSequenceProgramStep[];
  promptBlock: string;
}

const MAX_DIMENSION = 30000;

/** "600 x 600", "600x600", "600 by 600", "600×600" (+ optional px/pixels). */
const DIMENSIONS_RE = /(\d{1,5})\s*(?:x|×|by)\s*(\d{1,5})\s*(?:px|pixels?)?/i;

const PHOTOSHOP_RE = /\bphoto\s*shop\b|\bphotoshop\b/i;

/** Creation wording — must be a NEW artifact, not an edit of an existing one.
 *  "resize the image to 600x600" or "crop to 600 x 600" must NOT compile. */
const NEW_DOC_RE = /\b(?:new|blank|fresh)\b[\s\S]{0,40}?\b(?:project|document|doc|file|canvas|image|composition)\b|\b(?:start|create|make|open)\s+(?:up\s+)?a\s+(?:new\s+)?(?:photoshop\s+)?(?:project|document|doc|canvas)\b/i;

const EDIT_EXISTING_RE = /\b(?:resize|crop|scale|shrink|enlarge|export|convert|save)\b/i;

function clampDimension(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) return null;
  return value;
}

function formatStep(index: number, step: ComputerSequenceProgramStep): string {
  return `${index + 1}. ${step.tool} ${JSON.stringify(step.args)} — ${step.note}`;
}

function buildPromptBlock(program: Omit<ComputerSequenceProgram, 'promptBlock'>): string {
  return [
    '## EXACT TOOL PROGRAM (execute this, in order — do not re-plan)',
    `Task family: ${program.title}. The steps below are the complete, pre-approved`,
    'plan for this request. Call each tool exactly as written, one per step,',
    'then report the verified result. Rules:',
    '- Do NOT call file_search, file_stat, screenshot, a11y, menu, or any',
    '  coordinate/keyboard tool for this task — there is no source file and no',
    '  dialog to drive; the scripted tools below are the whole job.',
    '- This is FROM-SCRATCH creation: "no active document" is the expected',
    '  starting state, not a blocker. Document-inventory guidance is satisfied',
    '  by the status calls in this program.',
    '- If a status step reports the app is not running or not yet scriptable,',
    '  wait ~10 seconds and repeat that status step (up to 4 tries — a cold',
    '  Photoshop launch takes a minute) before moving on.',
    '- If a step fails after its retries, stop and report that exact step and',
    '  the tool error text. Do not improvise an alternative route.',
    '',
    ...program.steps.map((step, index) => formatStep(index, step)),
  ].join('\n');
}

/** Photoshop from-scratch document creation: "open photoshop and start a new
 *  project 600 x 600" and phrasing variants. */
function compilePhotoshopNewDocument(task: string): ComputerSequenceProgram | null {
  if (!PHOTOSHOP_RE.test(task)) return null;
  if (!NEW_DOC_RE.test(task)) return null;
  if (EDIT_EXISTING_RE.test(task)) return null;
  const dims = task.match(DIMENSIONS_RE);
  if (!dims) return null;
  const widthPx = clampDimension(dims[1]);
  const heightPx = clampDimension(dims[2]);
  if (widthPx === null || heightPx === null) return null;

  const steps: ComputerSequenceProgramStep[] = [
    {
      tool: 'desktop.photoshop_document_status',
      args: {},
      note: 'Observe: is Photoshop running, and what documents are open? (appRunning:false is fine — next step launches it.)',
    },
    {
      tool: 'desktop.launch_app',
      args: { appName: 'Photoshop' },
      note: 'Only if step 1 reported the app is not running; skip when already running.',
    },
    {
      tool: 'desktop.photoshop_document_status',
      args: {},
      note: 'Wait for scriptability after a launch — repeat per the cold-start rule until appRunning:true.',
    },
    {
      tool: 'desktop.photoshop_create_document',
      args: { widthPx, heightPx },
      note: 'Create the new document at the exact requested pixel size.',
    },
    {
      tool: 'desktop.photoshop_document_status',
      args: {},
      note: `Verify: the active document reports ${widthPx}x${heightPx}. Report its name and size as proof.`,
    },
  ];
  const base = {
    id: 'photoshop_new_document',
    title: `Photoshop new ${widthPx}x${heightPx} document`,
    steps,
  };
  return { ...base, promptBlock: buildPromptBlock(base) };
}

/**
 * Compile a task message into a deterministic tool program, or null when the
 * ask is not one of the supported 1:1 families (normal planning then runs).
 * Total: never throws on any input.
 */
export function compileComputerSequenceProgram(
  task: string | null | undefined,
): ComputerSequenceProgram | null {
  try {
    const text = String(task || '').trim();
    if (!text || text.length > 4000) return null;
    return compilePhotoshopNewDocument(text);
  } catch {
    return null;
  }
}
