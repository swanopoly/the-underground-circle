import type { SessionCodingProfile } from './chatSessionProfile';

export type SessionPromptAction = {
  id: string;
  label: string;
  prompt: string;
  color: string;
};

const MAIN_CHAT_ACTIONS: Record<SessionCodingProfile, SessionPromptAction[]> = {
  auto: [
    { id: 'auto-best-path', label: 'Best Path', prompt: 'Choose the right mode for this request automatically, then do the work in that mode.', color: '#22d3ee' },
    { id: 'auto-direct', label: 'Direct Answer', prompt: 'If this is a simple question, answer directly. If it needs building, debugging, review, or architecture work, choose that mode yourself and proceed.', color: '#06b6d4' },
    { id: 'auto-build-when-needed', label: 'Build If Needed', prompt: 'Decide whether this request needs implementation. If yes, build it cleanly. If not, keep the answer concise and direct.', color: '#14b8a6' },
    { id: 'auto-risk-first', label: 'Risk First', prompt: 'Auto-detect the right mode and lead with the most important risks or next actions for this request.', color: '#0ea5e9' },
  ],
  senior: [
    { id: 'build-plan', label: 'Build Plan', prompt: 'Build this end-to-end with the cleanest architecture and start implementing it.', color: '#22c55e' },
    { id: 'ship-feature', label: 'Ship Feature', prompt: 'Implement this feature fully, integrate it cleanly, and tell me what changed.', color: '#16a34a' },
    { id: 'create-room', label: 'Make Sandbox', prompt: 'Build the code and give me a room sandbox preview I can iterate on.', color: '#38bdf8' },
    { id: 'tighten-ux', label: 'Tighten UX', prompt: 'Audit this flow and improve the UX, architecture, and implementation quality.', color: '#a855f7' },
  ],
  review: [
    { id: 'deep-review', label: 'Deep Review', prompt: 'Do a deep code review. Lead with findings, risks, regressions, and missing tests.', color: '#f59e0b' },
    { id: 'security-audit', label: 'Security', prompt: 'Audit this for security issues and rank findings by severity with fixes.', color: '#ef4444' },
    { id: 'arch-audit', label: 'Architecture', prompt: 'Audit the architecture and identify the biggest structural bottlenecks and cleanup path.', color: '#38bdf8' },
    { id: 'test-gaps', label: 'Test Gaps', prompt: 'Review this like a principal engineer and identify the missing tests and risky paths.', color: '#eab308' },
  ],
  debug: [
    { id: 'root-cause', label: 'Root Cause', prompt: 'Debug this systematically and identify the root cause before proposing a fix.', color: '#ef4444' },
    { id: 'repro-plan', label: 'Repro Plan', prompt: 'Give me a concrete repro and verification plan for this bug, then fix it.', color: '#f97316' },
    { id: 'stabilize', label: 'Stabilize', prompt: 'Trace the failure path, fix the bug, and harden the surrounding integration points.', color: '#fb7185' },
    { id: 'perf-debug', label: 'Perf Debug', prompt: 'Investigate why this feels slow and fix the bottleneck with evidence.', color: '#f59e0b' },
  ],
  architect: [
    { id: 'system-design', label: 'System Design', prompt: 'Design the cleanest architecture for this and explain the boundaries and contracts.', color: '#38bdf8' },
    { id: 'extract-service', label: 'Extract Service', prompt: 'Refactor this toward shared services and cleaner boundaries, then implement it.', color: '#0ea5e9' },
    { id: 'integration-plan', label: 'Integration', prompt: 'Make sure this integrates the best way possible with the current architecture.', color: '#60a5fa' },
    { id: 'control-plane', label: 'Control Plane', prompt: 'Turn this into a more session-first, artifact-first control surface instead of generic chat.', color: '#22d3ee' },
  ],
  research: [
    { id: 'research-landscape', label: 'Landscape', prompt: 'Map the landscape, compare the strongest options, and recommend the best path with reasons.', color: '#a855f7' },
    { id: 'research-tradeoffs', label: 'Tradeoffs', prompt: 'Do a research-grade tradeoff analysis with evidence, risks, and a final recommendation.', color: '#9333ea' },
    { id: 'research-sources', label: 'Source Pack', prompt: 'Investigate this and return a structured findings report with citations and source-backed conclusions.', color: '#c084fc' },
    { id: 'research-brief', label: 'Exec Brief', prompt: 'Research this deeply and compress it into an executive brief with the decision I should make next.', color: '#7c3aed' },
  ],
  design: [
    { id: 'design-direction', label: 'Direction', prompt: 'Define the strongest UI/UX direction for this with layout, hierarchy, interaction, and handoff detail.', color: '#ec4899' },
    { id: 'design-polish', label: 'Polish UX', prompt: 'Audit the user experience and improve flow, clarity, hierarchy, motion, and accessibility.', color: '#db2777' },
    { id: 'design-system', label: 'Design System', prompt: 'Turn this into a cleaner design system direction with reusable components, tokens, and interaction patterns.', color: '#f472b6' },
    { id: 'design-preview', label: 'Previewable', prompt: 'Produce a design-led solution that is concrete enough to preview or hand off directly.', color: '#fb7185' },
  ],
  support: [
    { id: 'support-unblock', label: 'Unblock Me', prompt: 'Troubleshoot this and give me the fastest correct path to get unblocked.', color: '#3b82f6' },
    { id: 'support-diagnose', label: 'Diagnose', prompt: 'Diagnose the issue, isolate the likely causes, and tell me exactly what to check next.', color: '#2563eb' },
    { id: 'support-setup', label: 'Setup Help', prompt: 'Walk me through setup or configuration in the right order and call out missing prerequisites.', color: '#60a5fa' },
    { id: 'support-recover', label: 'Recovery', prompt: 'Help me recover from this failure safely, including the quickest rollback or workaround if needed.', color: '#1d4ed8' },
  ],
};

const ROOM_CHAT_ACTIONS: Record<SessionCodingProfile, SessionPromptAction[]> = {
  auto: [
    { id: 'auto-room-best-path', label: 'Best Path', prompt: 'Choose the right room mode automatically: review, debug, architect, or implement, based on the request and room context.', color: '#22d3ee' },
    { id: 'auto-room-fix', label: 'Fix If Needed', prompt: 'If this room request is a bug or failure, debug and fix it. If it is architectural, review structure first. Otherwise implement directly.', color: '#06b6d4' },
    { id: 'auto-room-review', label: 'Review If Risky', prompt: 'If the room changes look risky, review first. If the path is clear, implement directly.', color: '#14b8a6' },
    { id: 'auto-room-ship', label: 'Ship Smart', prompt: 'Auto-select the right mode for this room task and produce the strongest result with the least unnecessary process.', color: '#0ea5e9' },
  ],
  senior: [
    { id: 'implement-room', label: 'Implement', prompt: 'Implement the requested code changes directly against this room and generate the needed files.', color: '#22c55e' },
    { id: 'build-ui', label: 'Build UI', prompt: 'Build the UI in this room and produce code artifacts I can open in the playground.', color: '#38bdf8' },
    { id: 'polish-room', label: 'Polish', prompt: 'Improve this codebase in the room like a senior engineer and keep the architecture clean.', color: '#a855f7' },
    { id: 'tests-room', label: 'Add Tests', prompt: 'Generate the tests this room needs and create the test files directly.', color: '#eab308' },
  ],
  review: [
    { id: 'review-room', label: 'Review Room', prompt: '[CODE REVIEW MODE] Review all files in this room for correctness, bugs, and code quality.', color: '#6366f1' },
    { id: 'security-room', label: 'Security', prompt: '[SECURITY AUDIT MODE] Analyze all files for security vulnerabilities.', color: '#ef4444' },
    { id: 'perf-room', label: 'Performance', prompt: '[PERFORMANCE REVIEW MODE] Analyze all files for performance issues.', color: '#f59e0b' },
    { id: 'arch-room', label: 'Architecture', prompt: '[ARCHITECTURE REVIEW MODE] Analyze the room architecture and identify the highest-leverage refactors.', color: '#38bdf8' },
  ],
  debug: [
    { id: 'debug-room', label: 'Debug', prompt: '[DEBUG MODE] Help diagnose and fix issues in this room systematically.', color: '#ef4444' },
    { id: 'trace-room', label: 'Trace', prompt: '[DEBUG MODE] Trace the likely failure path across the active file and related room files.', color: '#f97316' },
    { id: 'fix-room', label: 'Fix It', prompt: '[DEBUG MODE] Find the bug, generate the fix, and create the updated room files.', color: '#fb7185' },
    { id: 'test-debug', label: 'Repro Test', prompt: '[DEBUG MODE] Create a minimal repro or test that proves the bug and the fix.', color: '#eab308' },
  ],
  architect: [
    { id: 'design-room', label: 'Design', prompt: '[ARCHITECTURE REVIEW MODE] Review this room like an architect and propose the cleanest structure.', color: '#38bdf8' },
    { id: 'refactor-room', label: 'Refactor', prompt: '[REFACTOR MODE] Suggest and implement the highest-leverage structural refactor in this room.', color: '#0ea5e9' },
    { id: 'split-room', label: 'Split Files', prompt: '[ARCHITECTURE REVIEW MODE] Decompose this room into better modules and create the new files.', color: '#60a5fa' },
    { id: 'integrate-room', label: 'Integrate', prompt: '[ARCHITECTURE REVIEW MODE] Tighten the integration boundaries and state/data flow in this room.', color: '#22d3ee' },
  ],
  research: [
    { id: 'research-room', label: 'Investigate', prompt: '[DEEP RESEARCH MODE] Investigate this room deeply and compare the strongest solution paths.', color: '#a855f7' },
    { id: 'research-room-risks', label: 'Risks', prompt: '[DEEP RESEARCH MODE] Research the hidden risks, edge cases, and tradeoffs in this room before changes are made.', color: '#9333ea' },
    { id: 'research-room-brief', label: 'Brief', prompt: '[DEEP RESEARCH MODE] Produce a room-specific brief with findings, options, and the best next move.', color: '#c084fc' },
    { id: 'research-room-sources', label: 'Evidence', prompt: '[DEEP RESEARCH MODE] Gather evidence from the room context and produce a cited recommendation.', color: '#7c3aed' },
  ],
  design: [
    { id: 'design-room-ui', label: 'UI Direction', prompt: '[DESIGN MODE] Improve the UI/UX direction of this room with layout, hierarchy, and interaction specifics.', color: '#ec4899' },
    { id: 'design-room-preview', label: 'Preview Design', prompt: '[DESIGN MODE] Produce a previewable design-forward solution for this room.', color: '#db2777' },
    { id: 'design-room-system', label: 'Systemize', prompt: '[DESIGN MODE] Turn this room into a more consistent design system with stronger reuse and accessibility.', color: '#f472b6' },
    { id: 'design-room-polish', label: 'Polish', prompt: '[DESIGN MODE] Audit the room experience and tighten the roughest UX edges first.', color: '#fb7185' },
  ],
  support: [
    { id: 'support-room-unblock', label: 'Unblock', prompt: '[SUPPORT MODE] Help me get unblocked in this room with the shortest correct troubleshooting path.', color: '#3b82f6' },
    { id: 'support-room-diagnose', label: 'Diagnose', prompt: '[SUPPORT MODE] Diagnose the room issue and tell me the exact next checks to run.', color: '#2563eb' },
    { id: 'support-room-setup', label: 'Setup', prompt: '[SUPPORT MODE] Walk through the setup or integration prerequisites for this room.', color: '#60a5fa' },
    { id: 'support-room-recover', label: 'Recover', prompt: '[SUPPORT MODE] Give me the safest recovery path for this room, including workarounds and rollback options.', color: '#1d4ed8' },
  ],
};

export function getMainChatSessionActions(profile: SessionCodingProfile): SessionPromptAction[] {
  return MAIN_CHAT_ACTIONS[profile] || MAIN_CHAT_ACTIONS.senior;
}

export function getRoomChatSessionActions(profile: SessionCodingProfile): SessionPromptAction[] {
  return ROOM_CHAT_ACTIONS[profile] || ROOM_CHAT_ACTIONS.review;
}
