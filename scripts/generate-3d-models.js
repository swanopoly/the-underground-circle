#!/usr/bin/env node
/**
 * generate-3d-models.js
 *
 * Batch-generates 3D models via Meshy AI text-to-3D API.
 * Downloads GLB files to assets/models/.
 *
 * Usage:
 *   MESHY_API_KEY=msy_xxx node scripts/generate-3d-models.js
 *   MESHY_API_KEY=msy_xxx node scripts/generate-3d-models.js --only=server-rack,arcade
 *   MESHY_API_KEY=msy_xxx node scripts/generate-3d-models.js --refine
 *
 * Requires Node 18+ (built-in fetch).
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const API_KEY = process.env.MESHY_API_KEY;
const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'models');

if (!API_KEY) {
  console.error('Error: MESHY_API_KEY environment variable is required');
  process.exit(1);
}

// ─── Model Definitions ──────────────────────────────────────────────────────

const MODELS = [
  // Realistic furniture
  {
    name: 'server-rack',
    prompt: 'Server rack with blinking LED lights, dark metal finish, cable management, data center equipment',
    target_polycount: 20000,
    style: 'realistic',
  },
  {
    name: 'arcade',
    prompt: 'Retro arcade cabinet with glowing screen, joystick and buttons, classic 80s design',
    target_polycount: 15000,
    style: 'realistic',
  },
  {
    name: 'plant',
    prompt: 'Potted monstera office plant in ceramic planter, lush green leaves',
    target_polycount: 10000,
    style: 'realistic',
  },
  {
    name: 'trophy',
    prompt: 'Trophy shelf display case with golden cups and medals on dark wood',
    target_polycount: 15000,
    style: 'realistic',
  },
  {
    name: 'coffee',
    prompt: 'Professional espresso coffee machine, stainless steel, coffee shop quality',
    target_polycount: 15000,
    style: 'realistic',
  },
  {
    name: 'safe',
    prompt: 'Steel safe vault with combination dial lock, heavy duty, matte black finish',
    target_polycount: 10000,
    style: 'realistic',
  },
  {
    name: 'lamp',
    prompt: 'Modern standing floor lamp with warm ambient glow, minimalist metal design',
    target_polycount: 8000,
    style: 'realistic',
  },
  {
    name: 'tv',
    prompt: 'Large flatscreen monitor on adjustable stand, thin bezels, glowing display',
    target_polycount: 10000,
    style: 'realistic',
  },
  // Stylized models
  {
    name: 'thinking-brain',
    prompt: 'Low-poly glowing brain with circuit board patterns, purple and blue neon, sci-fi game prop',
    target_polycount: 8000,
    style: 'lowpoly',
  },
  {
    name: 'trophy-bronze',
    prompt: 'Low-poly bronze star trophy, geometric faceted, warm metallic glow, game reward',
    target_polycount: 5000,
    style: 'lowpoly',
  },
  {
    name: 'trophy-silver',
    prompt: 'Low-poly silver shield trophy with diamond center, metallic sheen, game reward',
    target_polycount: 5000,
    style: 'lowpoly',
  },
  {
    name: 'trophy-gold',
    prompt: 'Low-poly golden crown trophy with colorful gems, ornate, epic glow, game reward',
    target_polycount: 6000,
    style: 'lowpoly',
  },
  {
    name: 'mascot',
    prompt: 'Low-poly friendly robot companion with glowing visor, purple accent lights, sci-fi character',
    target_polycount: 10000,
    style: 'lowpoly',
  },
];

// ─── CLI Flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const onlyFlag = args.find(a => a.startsWith('--only='));
const doRefine = args.includes('--refine');
const onlyNames = onlyFlag ? onlyFlag.split('=')[1].split(',') : null;

const modelsToGenerate = onlyNames
  ? MODELS.filter(m => onlyNames.includes(m.name))
  : MODELS;

if (modelsToGenerate.length === 0) {
  console.error('No models matched the --only filter');
  process.exit(1);
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

async function createTask(model) {
  const body = {
    mode: 'preview',
    prompt: model.prompt,
    ai_model: 'meshy-5',
    topology: 'triangle',
    target_polycount: model.target_polycount,
  };

  console.log(`  Creating task for "${model.name}"...`);
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create task failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.result; // task ID
}

async function getTask(taskId) {
  const res = await fetch(`${API_BASE}/${taskId}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get task failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function pollUntilDone(taskId, modelName, timeoutMs = 600000) {
  const start = Date.now();
  let lastProgress = -1;

  while (Date.now() - start < timeoutMs) {
    const task = await getTask(taskId);
    const status = task.status;
    const progress = task.progress || 0;

    if (progress !== lastProgress) {
      console.log(`  [${modelName}] Status: ${status} — ${progress}%`);
      lastProgress = progress;
    }

    if (status === 'SUCCEEDED') return task;
    if (status === 'FAILED') throw new Error(`Task failed: ${JSON.stringify(task)}`);
    if (status === 'CANCELED') throw new Error(`Task was canceled`);

    // Wait 10s before polling again
    await new Promise(r => setTimeout(r, 10000));
  }

  throw new Error(`Task timed out after ${timeoutMs / 1000}s`);
}

async function downloadGlb(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  const sizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`  Downloaded: ${outputPath} (${sizeKB} KB)`);
}

async function createRefineTask(previewTaskId) {
  const body = {
    mode: 'refine',
    preview_task_id: previewTaskId,
    enable_pbr: true,
  };

  const res = await fetch(API_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refine task failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function generateModel(model) {
  const outputPath = path.join(OUTPUT_DIR, `${model.name}.glb`);

  // Skip if already exists (use --force to regenerate)
  if (fs.existsSync(outputPath) && !args.includes('--force')) {
    console.log(`  [${model.name}] Already exists, skipping (use --force to regenerate)`);
    return { name: model.name, status: 'skipped' };
  }

  try {
    // Step 1: Create preview task
    const taskId = await createTask(model);
    console.log(`  [${model.name}] Task ID: ${taskId}`);

    // Step 2: Poll until done
    const result = await pollUntilDone(taskId, model.name);

    // Step 3: Download GLB
    const glbUrl = result.model_urls?.glb;
    if (!glbUrl) throw new Error('No GLB URL in result');
    await downloadGlb(glbUrl, outputPath);

    // Step 4: Optionally refine
    if (doRefine) {
      console.log(`  [${model.name}] Starting refine...`);
      const refineId = await createRefineTask(taskId);
      const refined = await pollUntilDone(refineId, `${model.name}-refine`);
      const refinedGlb = refined.model_urls?.glb;
      if (refinedGlb) {
        await downloadGlb(refinedGlb, outputPath); // overwrite with refined
      }
    }

    // Save thumbnail
    if (result.thumbnail_url) {
      const thumbPath = path.join(OUTPUT_DIR, `${model.name}-thumb.png`);
      try {
        await downloadGlb(result.thumbnail_url, thumbPath);
      } catch (e) {
        console.log(`  [${model.name}] Thumbnail download failed (non-critical)`);
      }
    }

    return { name: model.name, status: 'success', taskId };
  } catch (err) {
    console.error(`  [${model.name}] ERROR: ${err.message}`);
    return { name: model.name, status: 'error', error: err.message };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     Meshy 3D Model Generator                    ║');
  console.log('║     The Underground Circle                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log(`Models to generate: ${modelsToGenerate.length}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Refine mode: ${doRefine ? 'ON' : 'OFF'}`);
  console.log();

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];

  // Process sequentially to respect rate limits
  for (let i = 0; i < modelsToGenerate.length; i++) {
    const model = modelsToGenerate[i];
    console.log(`\n[${i + 1}/${modelsToGenerate.length}] Generating: ${model.name} (${model.style})`);
    const result = await generateModel(model);
    results.push(result);

    // Rate limit: wait 2s between API calls
    if (i < modelsToGenerate.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Write manifest
  const manifest = {
    generated_at: new Date().toISOString(),
    models: results.map(r => ({
      name: r.name,
      file: `${r.name}.glb`,
      status: r.status,
      taskId: r.taskId || null,
    })),
  };
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;
  console.log(`  Success: ${success}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);
  if (errors > 0) {
    results.filter(r => r.status === 'error').forEach(r => {
      console.log(`    - ${r.name}: ${r.error}`);
    });
  }
  console.log(`\nManifest: ${manifestPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
