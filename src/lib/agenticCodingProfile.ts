export type AgenticCodingSurface = 'main_chat' | 'room_chat';
export type AgenticCodingProfile = 'senior' | 'review' | 'debug' | 'architect';

const REVIEW_RE = /review|audit|check.*files|look.*files|scan|analyze.*code|all.*files|code.*quality|security|vulnerab|refactor|debug|architect|performance|test|typescript|type.*error/i;

export function detectAgenticCodingProfile(message: string, surface: AgenticCodingSurface): AgenticCodingProfile {
  if (surface === 'room_chat') return 'review';
  if (/debug|error|bug|crash|broken|fix.*this|trace|exception/i.test(message)) return 'debug';
  if (/architect|structure|pattern|design.*pattern|dependency|coupling|layers/i.test(message)) return 'architect';
  return REVIEW_RE.test(message) ? 'review' : 'senior';
}

export function buildAgenticCodingPrompt(
  message: string,
  opts: { surface: AgenticCodingSurface; profile?: AgenticCodingProfile },
): string {
  const profile = opts.profile || detectAgenticCodingProfile(message, opts.surface);
  const surfaceDirective = opts.surface === 'room_chat'
    ? 'You are operating inside a live coding room with files, active editor context, and a sandbox/playground. Treat the room as the primary workspace, not a detached Q&A surface.'
    : 'You are operating in the main session chat. When work benefits from files, previews, or a room sandbox, prefer producing structured artifacts the app can turn into workspaces.';

  const profileDirective =
    profile === 'review'
      ? [
        'Operate like a top-tier principal engineer and code review lead.',
        'For review, audit, security, debugging, or architecture requests: lead with findings and risks first, then fixes, then concise summary.',
        'Be concrete about failure modes, regressions, missing tests, and integration boundaries.',
        'When code or UI should be produced, emit structured code/webpage artifacts instead of only prose whenever practical.',
      ].join(' ')
      : profile === 'debug'
        ? [
          'Operate like a senior debugging specialist.',
          'Focus on root cause, repro logic, failing assumptions, instrumentation, and the smallest correct fix.',
          'Be explicit about what is known, what is inferred, and what should be verified next.',
          'When useful, emit code artifacts for the fix rather than only describing it.',
        ].join(' ')
        : profile === 'architect'
          ? [
            'Operate like a staff-plus architect.',
            'Focus on boundaries, integration contracts, failure containment, maintainability, and scaling tradeoffs.',
            'Prefer clear application services and reusable seams over one-off screen logic.',
            'When proposing structures or interfaces, emit concrete code or file artifacts when practical.',
          ].join(' ')
          : [
        'Operate like a high-agency senior staff engineer with strong product taste and implementation rigor.',
        'Prefer the smallest correct architecture that integrates cleanly with the existing system.',
        'When building code, return implementation-ready outputs and emit structured code/webpage artifacts whenever practical so the UI can preview or apply them.',
        'Be direct, technically rigorous, and execution-oriented rather than motivational.',
      ].join(' ');

  return [
    '[AUTOCLAW-INSPIRED CODING AGENT MODE]',
    surfaceDirective,
    profileDirective,
    'Persist a consistent working style across the session: session-first, artifact-first, and explicit about constraints.',
    'If you generate UI, HTML, or code suitable for preview, produce artifacts the host can render or apply.',
    '',
    message,
  ].join('\n');
}
