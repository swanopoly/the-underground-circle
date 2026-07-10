/**
 * chat-prompt-assembly-smoketest — verifies the W5 (P38) pure prompt-assembly
 * seam in `src/lib/chatPromptAssembly.ts`, the extracted core of
 * `buildSystemPromptAsync` (swanbot.ts).
 *
 * Covers:
 *   - complexity-tier context policy pins the exact legacy numbers
 *   - canonical section ordering (runtime_bundle first — the legacy unshift)
 *   - BYTE-IDENTITY: assemble+compose reproduces the legacy inline
 *     join/clip/boundary exactly, including the 0.7-lastBreak clip rule
 *   - empty/whitespace sections drop; no sections → base unchanged
 *   - clipped flag + rendered[] telemetry
 *   - cache boundary exact bytes
 *   - lane specs (stream thin-context, batch pre-resolve, v2 duplicate debt,
 *     lean build suppression)
 *
 * Run: npm run smoke:chat-prompt-assembly
 */

import {
  applyChatPromptComplexityFloor,
  assembleChatPromptExtras,
  composeChatSystemPrompt,
  omitChatPromptSections,
  resolveChatPromptContextPolicy,
  getChatPromptLaneSpec,
  CHAT_PROMPT_SECTION_ORDER,
  CHAT_PROMPT_SECTION_STABILITY,
  CHAT_PROMPT_CACHE_BOUNDARY,
  type ChatPromptSectionInput,
  type ChatPromptSectionKey,
  type ChatPromptComplexity,
} from '../src/lib/chatPromptAssembly';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

/** The legacy inline logic from buildSystemPromptAsync, verbatim, as the
 *  byte-identity oracle. Bodies are joined in EMIT order (the caller pushed
 *  in code order and unshifted the runtime bundle). */
function legacyCompose(base: string, extras: string[], maxExtrasChars: number): string {
  if (extras.length === 0) return base;
  const CACHE_BOUNDARY = '\n\n---\n<!-- dynamic context below — changes per turn -->\n';
  let combined = extras.join('\n\n');
  if (combined.length > maxExtrasChars) {
    combined = combined.slice(0, maxExtrasChars);
    const lastBreak = combined.lastIndexOf('\n');
    if (lastBreak > maxExtrasChars * 0.7) {
      combined = combined.slice(0, lastBreak);
    }
  }
  return base + CACHE_BOUNDARY + combined;
}

function main() {
  // ─── Case 1: context policy pins the exact legacy tier numbers ─────────
  {
    const tiers: Array<[ChatPromptComplexity, boolean, boolean, boolean, boolean, boolean, number, number, number]> = [
      // tier, loadMemory, loadWisdom, loadRetrieval, loadMissions, loadSkills, budget, count, maxChars
      ['trivial', false, false, false, false, false, 600, 3, 1200],
      ['simple', true, false, true, false, true, 600, 3, 3000],
      ['moderate', true, true, true, true, true, 1200, 6, 5500],
      ['complex', true, true, true, true, true, 2500, 12, 8000],
    ];
    for (const [tier, mem, wis, ret, mis, ski, budget, count, maxChars] of tiers) {
      const p = resolveChatPromptContextPolicy(tier);
      assert(p.loadProfile === true, `case1: ${tier} always loads profile`);
      assert(p.loadMemory === mem, `case1: ${tier} loadMemory=${mem}`);
      assert(p.loadWisdom === wis, `case1: ${tier} loadWisdom=${wis}`);
      assert(p.loadRetrieval === ret, `case1: ${tier} loadRetrieval=${ret}`);
      assert(p.loadMissions === mis, `case1: ${tier} loadMissions=${mis}`);
      assert(p.loadSkills === ski, `case1: ${tier} loadSkills=${ski}`);
      assert(p.retrievalBudget === budget, `case1: ${tier} retrievalBudget=${budget}`);
      assert(p.retrievalCount === count, `case1: ${tier} retrievalCount=${count}`);
      assert(p.maxExtrasChars === maxChars, `case1: ${tier} maxExtrasChars=${maxChars}`);
    }
  }

  // ─── Case 2: canonical order — registry shape ──────────────────────────
  {
    assert(CHAT_PROMPT_SECTION_ORDER[0] === 'runtime_bundle',
      'case2: runtime_bundle is FIRST (the legacy unshift)');
    assert(CHAT_PROMPT_SECTION_ORDER[CHAT_PROMPT_SECTION_ORDER.length - 1] === 'last_session',
      'case2: last_session is LAST');
    assert(CHAT_PROMPT_SECTION_ORDER.length === 32, 'case2: 32 canonical sections',
      `got ${CHAT_PROMPT_SECTION_ORDER.length}`);
    assert(new Set(CHAT_PROMPT_SECTION_ORDER).size === CHAT_PROMPT_SECTION_ORDER.length,
      'case2: no duplicate keys in canonical order');
    // Relative-order pins for the load-bearing neighborhoods.
    const idx = (k: ChatPromptSectionKey) => CHAT_PROMPT_SECTION_ORDER.indexOf(k);
    assert(idx('task_pipeline') < idx('computer_request_route'),
      'case2: task_pipeline precedes computer_request_route');
    assert(idx('computer_receipt') < idx('collab_manifest'),
      'case2: computer/design ladder precedes collaboration blocks');
    assert(idx('collab_manifest') < idx('collab_note') && idx('collab_note') < idx('blackswan_grounding'),
      'case2: collab manifest → note → grounding order');
    assert(idx('user_chat_profile') < idx('memory_user_notes'),
      'case2: chat profile precedes memory stores');
    assert(idx('memory_user_notes') < idx('memory_user_profile'),
      'case2: P43 — user-authored notes precede the inferred profile (highest signal first)');
    assert(idx('memory_user_profile') < idx('memory_runtime') && idx('memory_runtime') < idx('memory_working'),
      'case2: memory stores keep userProfile → runtime → working order');
    assert(idx('soul_wisdom') < idx('turn_retrieval') && idx('turn_retrieval') < idx('wiki_context'),
      'case2: wisdom → retrieval → wiki order');
    assert(idx('skills') < idx('agent_identity') && idx('agent_identity') < idx('missions'),
      'case2: skills → identity → missions order');
    assert(idx('missions') < idx('circle_snapshot') && idx('circle_snapshot') < idx('last_session'),
      'case2: missions → snapshot → last_session order');
    // Every key has a stability tag; all current sections live in the turn tail.
    for (const key of CHAT_PROMPT_SECTION_ORDER) {
      if (CHAT_PROMPT_SECTION_STABILITY[key] !== 'turn') {
        fail(`case2: ${key} expected stability 'turn'`);
      }
    }
    pass('case2: every section carries a turn stability tag');
  }

  // ─── Case 3: ordering — shuffled input emits in canonical order ────────
  {
    const shuffled: ChatPromptSectionInput[] = [
      { key: 'last_session', body: 'SESSION' },
      { key: 'missions', body: 'MISSIONS' },
      { key: 'runtime_bundle', body: 'BUNDLE' },
      { key: 'task_pipeline', body: 'PIPELINE' },
      { key: 'memory_working', body: 'WORKING' },
      { key: 'memory_user_profile', body: 'PROFILE_MEM' },
    ];
    const out = assembleChatPromptExtras(shuffled, { maxExtrasChars: 8000 });
    assert(out.text === 'BUNDLE\n\nPIPELINE\n\nPROFILE_MEM\n\nWORKING\n\nMISSIONS\n\nSESSION',
      'case3: shuffled sections emit in canonical order');
    assert(out.rendered.map(r => r.key).join(',') ===
      'runtime_bundle,task_pipeline,memory_user_profile,memory_working,missions,last_session',
      'case3: rendered[] telemetry matches emit order');
    assert(out.clipped === false, 'case3: under budget → not clipped');
  }

  // ─── Case 4: BYTE-IDENTITY vs the legacy inline compose ────────────────
  {
    const base = 'You are the AI assistant inside The Underground Circle.\n\n## Personality\n- steady';
    // Emit-order bodies exactly as the legacy caller would have pushed them
    // (runtime bundle unshifted to front).
    const bodies = {
      runtime_bundle: '## Runtime\nAGENTS/IDENTITY bundle',
      task_pipeline: '## Task Pipeline\nsteps',
      computer_request_route: '## Computer Route\nroute',
      memory_user_profile: '<untrusted>profile</untrusted>',
      soul_wisdom: '## Wisdom\ndistilled',
      missions: '## Active Missions\n- ship it — 40%',
      last_session: '## Last Session\npicked up here',
    };
    const legacyExtras = [
      bodies.runtime_bundle, bodies.task_pipeline, bodies.computer_request_route,
      bodies.memory_user_profile, bodies.soul_wisdom, bodies.missions, bodies.last_session,
    ];
    const sections: ChatPromptSectionInput[] = [
      // pushed in swanbot.ts CODE order (bundle late, like the old unshift site)
      { key: 'task_pipeline', body: bodies.task_pipeline },
      { key: 'computer_request_route', body: bodies.computer_request_route },
      { key: 'memory_user_profile', body: bodies.memory_user_profile },
      { key: 'soul_wisdom', body: bodies.soul_wisdom },
      { key: 'runtime_bundle', body: bodies.runtime_bundle },
      { key: 'missions', body: bodies.missions },
      { key: 'last_session', body: bodies.last_session },
    ];
    for (const maxChars of [1200, 3000, 5500, 8000, 90, 40]) {
      const assembled = assembleChatPromptExtras(sections, { maxExtrasChars: maxChars });
      const mine = composeChatSystemPrompt(base, assembled.text);
      const legacy = legacyCompose(base, legacyExtras, maxChars);
      assert(mine === legacy, `case4: byte-identical to legacy at budget ${maxChars}`,
        `lens ${mine.length} vs ${legacy.length}`);
    }
    // Clip flag reflects truncation.
    const clippedOut = assembleChatPromptExtras(sections, { maxExtrasChars: 60 });
    assert(clippedOut.clipped === true, 'case4: over budget → clipped=true');
  }

  // ─── Case 5: the 0.7-lastBreak clip rule, both branches ────────────────
  {
    // Newline PAST 70% of budget → back off to it.
    const bodyA = 'x'.repeat(80) + '\n' + 'y'.repeat(40);
    const outA = assembleChatPromptExtras(
      [{ key: 'runtime_bundle', body: bodyA }], { maxExtrasChars: 100 });
    const legacyA = legacyCompose('B', [bodyA], 100).slice('B'.length + CHAT_PROMPT_CACHE_BOUNDARY.length);
    assert(outA.text === legacyA, 'case5: lastBreak>70% branch matches legacy');
    assert(outA.text.length === 80, 'case5: backed off to the newline at 80');
    // Newline BEFORE 70% of budget → keep the hard slice.
    const bodyB = 'x'.repeat(20) + '\n' + 'y'.repeat(200);
    const outB = assembleChatPromptExtras(
      [{ key: 'runtime_bundle', body: bodyB }], { maxExtrasChars: 100 });
    const legacyB = legacyCompose('B', [bodyB], 100).slice('B'.length + CHAT_PROMPT_CACHE_BOUNDARY.length);
    assert(outB.text === legacyB, 'case5: lastBreak<70% branch matches legacy');
    assert(outB.text.length === 100, 'case5: kept the hard slice at 100');
  }

  // ─── Case 6: empty behaviors ───────────────────────────────────────────
  {
    const none = assembleChatPromptExtras([], { maxExtrasChars: 8000 });
    assert(none.text === '' && none.rendered.length === 0 && none.clipped === false,
      'case6: no sections → empty result');
    assert(composeChatSystemPrompt('BASE', '') === 'BASE',
      'case6: empty extras → base returned unchanged (no boundary)');
    const ws = assembleChatPromptExtras(
      [{ key: 'missions', body: '   \n ' }, { key: 'skills', body: '' }],
      { maxExtrasChars: 8000 });
    assert(ws.text === '' && ws.rendered.length === 0,
      'case6: whitespace-only sections drop cleanly');
    assert(composeChatSystemPrompt('BASE', 'TAIL') === 'BASE' + CHAT_PROMPT_CACHE_BOUNDARY + 'TAIL',
      'case6: compose = base + boundary + tail');
  }

  // ─── Case 7: cache boundary exact bytes ────────────────────────────────
  {
    assert(CHAT_PROMPT_CACHE_BOUNDARY === '\n\n---\n<!-- dynamic context below — changes per turn -->\n',
      'case7: cache boundary bytes are the legacy marker exactly');
  }

  // ─── Case 8: lane specs encode the mapped divergences ──────────────────
  {
    const stream = getChatPromptLaneSpec('stream');
    assert(!stream.providesCollaborationPlan && !stream.providesMemoryStores,
      'case8: stream lane enters thin (no collab plan, no pre-resolved memory)');
    assert(stream.duplicateSectionDebt.length === 0, 'case8: stream lane has no duplicate debt');

    const batch = getChatPromptLaneSpec('batch');
    assert(batch.providesCollaborationPlan && batch.providesMemoryStores,
      'case8: batch lane pre-resolves collaboration + memory');

    const v2 = getChatPromptLaneSpec('openswan_v2');
    assert(v2.duplicateSectionDebt.includes('computer_request_route')
      && v2.duplicateSectionDebt.includes('design_execution_pipeline')
      && v2.duplicateSectionDebt.includes('blackswan_grounding'),
      'case8: v2 lane carries the duplicated computer/design ladder as typed debt');
    assert(v2.providesMemoryStores === true,
      'case8: v2 lane pre-resolves memory (assembler must not recall twice)');
    for (const key of v2.duplicateSectionDebt) {
      if (!CHAT_PROMPT_SECTION_ORDER.includes(key)) fail(`case8: debt key ${key} not in registry`);
    }
    pass('case8: every v2 debt key is a registry key');

    const build = getChatPromptLaneSpec('conversational_build');
    assert(build.suppressesCollaboration === true,
      'case8: lean build lane suppresses the collaboration menu');
    assert(v2.duplicateSectionDebt.includes('task_pipeline'),
      'case8: task_pipeline is v2 debt (ladder builds it at limit 3, assembler would duplicate at limit 2)');
  }

  // ─── Case 9: omitChatPromptSections — the X1 lane dedupe ────────────────
  {
    const sections: ChatPromptSectionInput[] = [
      { key: 'runtime_bundle', body: 'BUNDLE' },
      { key: 'task_pipeline', body: 'PIPELINE' },
      { key: 'computer_request_route', body: 'ROUTE' },
      { key: 'memory_user_profile', body: 'MEM' },
      { key: 'missions', body: 'MISSIONS' },
    ];
    const v2Debt = getChatPromptLaneSpec('openswan_v2').duplicateSectionDebt;
    const deduped = omitChatPromptSections(sections, v2Debt);
    assert(deduped.map(s => s.key).join(',') === 'runtime_bundle,memory_user_profile,missions',
      'case9: v2 debt keys dropped, everything else survives in order');
    const assembledDeduped = assembleChatPromptExtras(deduped, { maxExtrasChars: 8000 });
    assert(assembledDeduped.text === 'BUNDLE\n\nMEM\n\nMISSIONS',
      'case9: deduped sections assemble without the ladder duplicates');
    assert(omitChatPromptSections(sections, []).length === 5
      && omitChatPromptSections(sections, null).length === 5
      && omitChatPromptSections(sections, undefined).length === 5,
      'case9: empty/null/undefined omit list is a no-op copy');
    const copy = omitChatPromptSections(sections, undefined);
    assert(copy !== sections, 'case9: no-op still returns a fresh array (non-mutating)');
    assert(sections.length === 5, 'case9: input array untouched');
  }

  // ─── Case 10: complexity floor (P44) ────────────────────────────────────
  {
    assert(applyChatPromptComplexityFloor('trivial', 'moderate') === 'moderate',
      'case10: trivial floors up to moderate');
    assert(applyChatPromptComplexityFloor('simple', 'moderate') === 'moderate',
      'case10: simple floors up to moderate');
    assert(applyChatPromptComplexityFloor('moderate', 'moderate') === 'moderate',
      'case10: at-floor detection unchanged');
    assert(applyChatPromptComplexityFloor('complex', 'moderate') === 'complex',
      'case10: above-floor detection unchanged (floor never lowers)');
    assert(applyChatPromptComplexityFloor('trivial', null) === 'trivial'
      && applyChatPromptComplexityFloor('trivial', undefined) === 'trivial',
      'case10: no floor → detection verbatim');
    assert(applyChatPromptComplexityFloor('complex', 'trivial') === 'complex',
      'case10: low floor never demotes');
  }

  console.log(failures === 0 ? '\nchat-prompt-assembly smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
