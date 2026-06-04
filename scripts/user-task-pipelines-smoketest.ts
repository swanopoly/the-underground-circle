/**
 * user-task-pipelines-smoketest — verifies the shared chat/OpenSwan
 * pipeline taxonomy catches the high-value user requests that used to
 * fall through to generic model answers.
 *
 * Run: npx tsx scripts/user-task-pipelines-smoketest.ts
 */

import {
  buildUserTaskPipelinePromptBlock,
  buildUserTaskPipelineDecision,
  getBestUserTaskPipeline,
  rankUserTaskPipelines,
} from '../src/lib/userTaskPipelines';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assertPipeline(input: string, expectedId: string) {
  const match = getBestUserTaskPipeline(input, { includeFallback: false });
  if (match?.pipeline.id === expectedId) {
    pass(`${expectedId}: ${input}`);
    return;
  }
  const ranked = rankUserTaskPipelines(input, { limit: 4, includeFallback: false })
    .map((item) => `${item.pipeline.id}:${item.confidence.toFixed(2)}`)
    .join(', ');
  fail(`${input} expected ${expectedId}, got ${match?.pipeline.id || 'none'} [${ranked}]`);
}

function assertDecisionIncludes(input: string, expectedIds: string[]) {
  const decision = buildUserTaskPipelineDecision(input, { limit: 5, includeFallback: false });
  const actual = [
    decision?.primary.id,
    ...(decision?.supporting.map((item) => item.id) || []),
  ].filter(Boolean);
  const missing = expectedIds.filter((id) => !actual.includes(id as any));
  if (decision && missing.length === 0) {
    pass(`decision: ${input} → ${actual.join(', ')} (${decision.pattern})`);
    return;
  }
  fail(`${input} missing ${missing.join(', ')} from decision [${actual.join(', ') || 'none'}]`);
}

function assertPromptIncludes(input: string, expected: string[]) {
  const block = buildUserTaskPipelinePromptBlock(input, { limit: 4 }) || '';
  const missing = expected.filter((item) => !block.includes(item));
  if (missing.length === 0) {
    pass(`prompt requirements: ${input}`);
    return;
  }
  fail(`${input} prompt missing ${missing.join(', ')}\n${block}`);
}

assertPipeline('How good are you at Photoshop?', 'capability_explanation');
assertPipeline('Tell me all the tabs I have open in Chrome right now', 'desktop_awareness');
assertPipeline('The desktop/browser_tabs endpoint returns 404 in the local bridge', 'bridge_troubleshooting');
assertPipeline('Extract product prices from https://example.com into JSON', 'browser_data_retrieval');
assertPipeline('Fill out this signup form and submit it after I approve', 'browser_form_submission');
assertPipeline('Start 10 separate Codex sessions in my terminal', 'terminal_agents');
assertPipeline('Find the saved WordPress password in the vault', 'vault_credentials');
assertPipeline('Draft and publish a WordPress blog post', 'wordpress_cms');
assertPipeline('Log into Shopify and update this product page after I approve', 'website_platform_admin');
assertPipeline('Use Webflow to edit the landing page headline', 'website_platform_admin');
assertPipeline('Fix this React console error: TypeError failed to load resource 500', 'debug_fix');
assertPipeline('Review the recent changes and make sure it is ready to go live', 'code_review');
assertPipeline('Make sure user API keys are secure and not shared with other users', 'security_privacy');
assertPipeline('Why am I getting extra Anthropic API charges every day?', 'performance_cost');
assertPipeline('Remember that I prefer Codex for code changes', 'memory_second_brain');
assertPipeline('Add Brave Search as a marketplace integration and connect it to chat', 'integrations_models');
assertPipeline('Set up a daily cron to research AI news', 'schedule_automation');
assertPipeline('Show pending approvals and approve the safe ones', 'governance_approvals');
assertPipeline('The website is showing a Cloudflare human verification screen', 'human_verification');
assertPipeline('Triage support tickets and draft replies for angry customers', 'customer_support_crm');
assertPipeline('Find 20 SaaS leads and add them to the CRM with outreach drafts', 'sales_leads_outreach');
assertPipeline('Build a weekly KPI dashboard from conversion metrics', 'analytics_reporting');
assertPipeline('Schedule a meeting with the design team and send calendar invites', 'meetings_calendar_email');
assertPipeline('Import this CSV into Supabase and map the columns', 'data_import_export');
assertPipeline('Create an invoice and reconcile this customer payment', 'finance_billing');
assertPipeline('Extract the signed date and renewal clause from this contract PDF', 'document_intelligence');
assertPipeline('Run regression tests on the login flow and capture screenshots', 'qa_testing');
assertPipeline('Provision Slack and Jira access for a new teammate', 'it_support_ops');
assertPipeline('Build a SOC 2 evidence checklist for the security audit', 'compliance_monitoring');
assertPipeline('Create a new hire onboarding checklist for next Monday', 'hr_onboarding');
assertPipeline('Plan a newsletter campaign and segment the audience', 'marketing_campaigns');
assertPipeline('Make changes in InDesign for a marketing banner with different layers', 'creative_layout_design');
assertPipeline('Open Illustrator and update this logo then export SVG', 'adobe_creative_cloud');
assertPipeline('Open Adobe Audition and clean this podcast audio before exporting WAV', 'adobe_creative_cloud');
assertPipeline('Record this browser workflow and turn it into a reusable automation', 'workflow_recording_replay');
assertPipeline('Book a flight to New York next Friday under $500', 'travel_booking');
assertPipeline('Compare vendors and buy five software licenses after approval', 'procurement_shopping');
assertPipeline('Check AWS logs and rollback the failed deploy after approval', 'cloud_devops');
assertPipeline('Moderate Discord comments and draft community replies', 'social_community');
assertPipeline('Summarize unread emails and prioritize Slack alerts', 'inbox_notifications');
assertPipeline('Teach me Supabase RLS and make a quiz', 'learning_training');
assertPipeline('Should I take this medication if I have chest pain?', 'high_stakes_advice');

assertDecisionIncludes('Research Browserbase Stagehand and build the implementation plan', ['live_research', 'coding_build']);
assertDecisionIncludes('Login to WordPress with my saved vault credentials and draft a post', ['wordpress_cms', 'vault_credentials', 'browser_form_submission']);
assertDecisionIncludes('Use my saved credentials to log into Shopify and update a product page', ['website_platform_admin', 'vault_credentials']);
assertDecisionIncludes('Why can you not see my Chrome tabs when the desktop bridge says CORS blocked x-uc-desktop-token?', ['bridge_troubleshooting', 'desktop_awareness']);
assertDecisionIncludes('Review the app loading slow and fix extra API cost usage', ['performance_cost', 'code_review']);
assertDecisionIncludes('Open Photoshop and edit this image after I approve desktop control', ['creative_image_design', 'desktop_app_control']);
assertDecisionIncludes('Open this InDesign banner package, update the headline layer, replace the image, and export a proof PDF', ['creative_layout_design']);
assertDecisionIncludes('Open After Effects and render the active comp to MP4 after approval', ['adobe_creative_cloud']);
assertDecisionIncludes('Import this CSV, clean it, and build a KPI report', ['data_import_export', 'analytics_reporting']);
assertDecisionIncludes('Research leads, add them to CRM, and draft outreach emails', ['sales_leads_outreach', 'content_generation']);
assertDecisionIncludes('Triage support tickets, update HubSpot, and draft customer replies', ['customer_support_crm', 'content_generation']);
assertDecisionIncludes('Extract invoice PDFs, reconcile payments, and export exceptions', ['document_intelligence', 'finance_billing', 'data_import_export']);
assertDecisionIncludes('Record the checkout flow, replay it nightly, and file bugs on failures', ['workflow_recording_replay', 'qa_testing']);
assertDecisionIncludes('Prepare onboarding, provision app access, and schedule the first-day meeting', ['hr_onboarding', 'it_support_ops', 'meetings_calendar_email']);
assertDecisionIncludes('Book a hotel, add the itinerary to my calendar, and email the team', ['travel_booking', 'meetings_calendar_email']);
assertDecisionIncludes('Upload the image from my Desktop to Shopify product page after I approve', ['website_platform_admin', 'local_files']);
assertDecisionIncludes('Download the orders CSV from Shopify and save it to Downloads', ['data_import_export', 'website_platform_admin', 'local_files']);
assertDecisionIncludes('Summarize unread emails, create tasks, and draft replies', ['inbox_notifications', 'tasks_missions', 'content_generation']);
assertDecisionIncludes('Investigate the Cloudflare outage, inspect logs, and create follow-up tasks', ['cloud_devops', 'tasks_missions']);

assertPromptIncludes('Book a flight to New York next Friday under $500', ['Execution requirements:', 'Explicit approval before booking']);
assertPromptIncludes('Check AWS logs and rollback the failed deploy after approval', ['Execution requirements:', 'Read-only diagnostics before mutations']);
assertPromptIncludes('Should I take this medication if I have chest pain?', ['Execution requirements:', 'Do not diagnose']);
assertPromptIncludes('Log into Shopify and update this product page after I approve', ['Recommended tools:', 'Vault credential grant resolved']);
assertPromptIncludes('Make changes in InDesign for a marketing banner with different layers', ['Recommended tools:', 'desktop.indesign_document_status', 'desktop.indesign_package_document']);
assertPromptIncludes('Open Photoshop and edit this image after I approve desktop control', ['Recommended tools:', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state']);
assertPromptIncludes('Open Premiere Pro and export this sequence after approval', ['Adobe Creative Cloud App Automation', 'agent.build_app_capability']);

// ── P4.3: no/weak pipeline match → gap-fill (candidates + recall/clarify) ──────
function assertGapFill(input: string, expect: 'present' | 'absent', opts: { reasonIncludes?: string; minCandidates?: number } = {}) {
  const decision = buildUserTaskPipelineDecision(input, { limit: 5, includeFallback: true });
  const gap = decision?.gapFill || null;
  if (expect === 'absent') {
    if (gap) { fail(`${input} expected no gapFill, got "${gap.reason}"`); return; }
    pass(`gapFill absent: ${input}`);
    return;
  }
  if (!gap) { fail(`${input} expected gapFill present (primary=${decision?.primary.id}, conf=${decision?.confidence})`); return; }
  if (opts.reasonIncludes && !gap.reason.includes(opts.reasonIncludes)) { fail(`${input} gapFill reason missing "${opts.reasonIncludes}": ${gap.reason}`); return; }
  if (opts.minCandidates !== undefined && gap.candidates.length < opts.minCandidates) { fail(`${input} gapFill expected >=${opts.minCandidates} candidates, got ${gap.candidates.length}`); return; }
  if (!gap.recallHint || !gap.suggestedClarification) { fail(`${input} gapFill missing recall/clarification trigger`); return; }
  pass(`gapFill present: ${input}`);
}

// Plain questions answer directly — no gap-fill noise.
assertGapFill('What is the capital of France?', 'absent');
// A confident pipeline match needs no gap-fill.
assertGapFill('Set up a daily cron job to research AI news every morning', 'absent');
// A true no-match (fallback) surfaces the gap-fill trigger with no candidates.
assertGapFill('Frobnicate the gadget per the usual arrangement', 'present', { reasonIncludes: 'No task pipeline matched' });
// A weak, non-question actionable request surfaces candidate approaches.
assertGapFill('Make it nicer for me', 'present', { minCandidates: 1 });
// The prompt block surfaces the candidates + recall/clarify trigger.
assertPromptIncludes('Make it nicer for me', ['Approach confidence is low', 'Gap-fill:', 'Recall first:']);

if (failures > 0) {
  console.error(`\n${failures} user task pipeline smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll user task pipeline smoke cases passed.');
