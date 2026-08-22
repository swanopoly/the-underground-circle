/**
 * Pure, prose-independent completion accounting for one bounded OpenSwan turn.
 *
 * The runtime owns evidence records. An action report may claim a prior evidence
 * id, but it cannot invent evidence or reuse one across actions. This module
 * intentionally knows nothing about provider text, React, Supabase, or tools.
 */

export const OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS = Object.freeze({
  minActions: 2,
  maxActions: 3,
  maxEvidenceRecords: 24,
  maxEvidenceIdsPerReport: 8,
  maxEvidenceIdChars: 160,
  maxToolNameChars: 128,
  maxArtifactKindChars: 64,
  maxSequence: 2_147_483_647,
} as const);

const OPEN_SWAN_MULTI_ACTION_MUTATION_VERB_RE = /\b(?:activate|add|apply|archive|assign|attach|book|build|call|cancel|change|clear|click|close|complete|convert|create|delete|deploy|disable|download|draft|drag|edit|email|enable|enter|erase|execute|export|fill|focus|generate|grant|import|install|kill|launch|make|mark|message|move|notify|open|paste|pay|post|press|publish|purchase|purge|remove|rename|reorder|reserve|reset|revoke|run|save|schedule|scroll|select|send|set|start|stop|submit|tap|toggle|trash|type|unarchive|uninstall|unpublish|update|upload|wipe|write)\b/i;
const OPEN_SWAN_MULTI_ACTION_DESTRUCTIVE_VERB_RE = /\b(?:cancel|clear|delete|disable|erase|kill|purge|remove|reset|revoke|trash|uninstall|unpublish|wipe)\b/i;
const OPEN_SWAN_MULTI_ACTION_EXTERNAL_SIDE_EFFECT_RE = /\b(?:archive|attach|book|cancel|checkout|delete|disable|email|erase|grant|kill|message|notify|pay|post|publish|purchase|purge|remove|reserve|reset|revoke|schedule|send|submit|trash|unarchive|unpublish|upload|wipe)\b/i;

export type OpenSwanMultiActionOperationClassification = Readonly<{
  requiresMutation: boolean;
  destructive: boolean;
  externalSideEffect: boolean;
}>;

/**
 * Canonical conservative operation vocabulary shared by Chat preflight and
 * the OpenSwan evidence runtime. It deliberately treats destructive verbs as
 * mutations even when the child planner exposes only read helpers. The one
 * ambiguous word, `open`, remains read-only when it is an adjective in a
 * request such as "list the open tasks".
 */
export function classifyOpenSwanMultiActionOperation(
  input: unknown,
): OpenSwanMultiActionOperationClassification {
  const text = typeof input === 'string' ? input.slice(0, 1600) : '';
  const withoutReadOnlyOpenAdjective = text.replace(
    /\b(?:list|show|find|get|read|search|count|summarize|describe)\b[\s\S]{0,50}\bopen\b/gi,
    (match) => match.replace(/\bopen\b/i, ''),
  );
  const destructive = OPEN_SWAN_MULTI_ACTION_DESTRUCTIVE_VERB_RE.test(withoutReadOnlyOpenAdjective);
  const externalSideEffect = destructive
    || OPEN_SWAN_MULTI_ACTION_EXTERNAL_SIDE_EFFECT_RE.test(withoutReadOnlyOpenAdjective);
  return Object.freeze({
    requiresMutation: OPEN_SWAN_MULTI_ACTION_MUTATION_VERB_RE.test(withoutReadOnlyOpenAdjective),
    destructive,
    externalSideEffect,
  });
}

export type OpenSwanMultiActionId = 'A1' | 'A2' | 'A3';

export type OpenSwanMultiActionLedgerAction = Readonly<{
  id: OpenSwanMultiActionId;
  ordinal: 1 | 2 | 3;
  dependsOnActionIds: ReadonlyArray<OpenSwanMultiActionId>;
  /** Runtime-planned tools that are relevant to this action. Completion
   * evidence must come from this allowlist; provider-chosen unrelated tools
   * cannot satisfy an A# merely because the model cited their ids. */
  evidenceToolNames?: ReadonlyArray<string>;
  /** Assistant-authored deliverables use a separate proof boundary. The
   * runtime accepts only one of these kinds after an exact canonical artifact
   * insert bound to this A#; another read/tool call cannot stand in for it. */
  evidenceArtifactKinds?: ReadonlyArray<string>;
  /** A completed report must cite a tool whose runtime policy confirms a real
   * state mutation. Read/preflight helpers cannot stand in for a requested
   * write merely because they were part of the same child plan. */
  evidenceRequiresMutation?: boolean;
  /** When the planner extracted an explicit target (for example a task title),
   * the runtime must confirm that target is present in the sealed tool input. */
  evidenceRequiresTargetBinding?: boolean;
  /** The runtime found no authoritative evidence surface for this action.
   * Such an action may remain pending, but can never become verified from
   * provider prose or an unrelated successful call. */
  evidenceUnavailable?: boolean;
}>;

export type OpenSwanMultiActionCompletionLedger = Readonly<{
  schemaVersion: 1;
  dispatchMode: 'single_openswan_turn';
  /** A1 is also used for a single attachment-bound Chat turn so source reads
   * and derived output cannot bypass the authoritative receipt boundary. */
  actionCount: 1 | 2 | 3;
  actions: ReadonlyArray<OpenSwanMultiActionLedgerAction>;
}>;

export type OpenSwanMultiActionEvidenceStatus = 'succeeded' | 'blocked' | 'failed';

type OpenSwanMultiActionEvidenceBase = Readonly<{
  /** Runtime-owned tool-use or artifact id. Never provider prose. */
  evidenceId: string;
  /** Monotonic position in the current turn's trusted event stream. */
  sequence: number;
  status: OpenSwanMultiActionEvidenceStatus;
}>;

export type OpenSwanMultiActionToolEvidenceRecord = OpenSwanMultiActionEvidenceBase & Readonly<{
  kind: 'tool';
  tool: string;
  /** Runtime-owned policy facts. They are value-free and never supplied by
   * provider prose or by run.report_action_outcomes. */
  mutatesState?: boolean;
  targetBound?: boolean;
}>;

export type OpenSwanMultiActionArtifactEvidenceRecord = OpenSwanMultiActionEvidenceBase & Readonly<{
  kind: 'artifact';
  /** Exact ledger owner established from the validated publication input,
   * never inferred from provider prose or display order. */
  actionId: OpenSwanMultiActionId;
  artifactKind: string;
  /** Runtime-owned facts minted only after a non-empty bounded artifact was
   * inserted and the returned row matched the active run. */
  contentPresent: boolean;
  durablyRecorded: boolean;
}>;

/** Value-free evidence: ids, ordering, status, and source kind only. */
export type OpenSwanMultiActionEvidenceRecord =
  | OpenSwanMultiActionToolEvidenceRecord
  | OpenSwanMultiActionArtifactEvidenceRecord;

export type OpenSwanMultiActionReportStatus = 'completed' | 'pending' | 'blocked' | 'failed';

export type OpenSwanMultiActionReport = Readonly<{
  actionId: OpenSwanMultiActionId;
  status: OpenSwanMultiActionReportStatus;
  /** Sequence of the reporting event; every claimed evidence record must be earlier. */
  reportedAtSequence: number;
  evidenceIds: ReadonlyArray<string>;
}>;

export type OpenSwanMultiActionCompletionInput = Readonly<{
  ledger: OpenSwanMultiActionCompletionLedger;
  evidence: ReadonlyArray<OpenSwanMultiActionEvidenceRecord>;
  reports: ReadonlyArray<OpenSwanMultiActionReport>;
}>;

export type OpenSwanMultiActionCompletionDisposition =
  | 'verified'
  | 'incomplete'
  | 'blocked'
  | 'failed';

export type OpenSwanMultiActionCompletionActionStatus =
  | 'completed'
  | 'pending'
  | 'missing'
  | 'blocked'
  | 'failed'
  | 'invalid';

export type OpenSwanMultiActionCompletionIssueCode =
  | 'invalid_input'
  | 'invalid_ledger'
  | 'invalid_evidence'
  | 'duplicate_evidence_id'
  | 'invalid_report'
  | 'unknown_report_action'
  | 'duplicate_report_action'
  | 'duplicate_evidence_ref'
  | 'unknown_evidence_ref'
  | 'evidence_cross_owned'
  | 'future_evidence_ref'
  | 'status_evidence_mismatch'
  | 'evidence_not_relevant'
  | 'evidence_not_mutating'
  | 'evidence_target_mismatch'
  | 'artifact_content_missing'
  | 'artifact_persistence_unverified'
  | 'completion_evidence_unavailable'
  | 'dependency_inversion'
  | 'missing_action_report'
  | 'pending_action';

export type OpenSwanMultiActionCompletionIssue = Readonly<{
  code: OpenSwanMultiActionCompletionIssueCode;
  actionId?: OpenSwanMultiActionId;
  evidenceId?: string;
}>;

export type OpenSwanMultiActionCompletionAction = Readonly<{
  actionId: OpenSwanMultiActionId;
  status: OpenSwanMultiActionCompletionActionStatus;
  /** Evidence ids uniquely claimed by this report; never raw evidence values. */
  evidenceIds: ReadonlyArray<string>;
}>;

export type OpenSwanMultiActionCompletionOutcome = Readonly<{
  schemaVersion: 1;
  disposition: OpenSwanMultiActionCompletionDisposition;
  completionVerified: boolean;
  /** False means the structured contract/report/evidence input failed closed. */
  inputValid: boolean;
  actions: ReadonlyArray<OpenSwanMultiActionCompletionAction>;
  unresolvedActionIds: ReadonlyArray<OpenSwanMultiActionId>;
  issues: ReadonlyArray<OpenSwanMultiActionCompletionIssue>;
}>;

type ParsedLedger = {
  actions: OpenSwanMultiActionLedgerAction[];
  actionById: Map<OpenSwanMultiActionId, OpenSwanMultiActionLedgerAction>;
};

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_KIND_RE = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const EVIDENCE_KEYS = new Set([
  'evidenceId',
  'sequence',
  'status',
  'kind',
  'tool',
  'artifactKind',
  'actionId',
  'contentPresent',
  'durablyRecorded',
  'mutatesState',
  'targetBound',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOwn(value: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return value[key];
}

function isSafeToken(value: unknown, maxChars: number, pattern = SAFE_ID_RE): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxChars
    && value === value.trim()
    && pattern.test(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) <= OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxSequence;
}

function actionIdForOrdinal(ordinal: number): OpenSwanMultiActionId | null {
  if (ordinal === 1) return 'A1';
  if (ordinal === 2) return 'A2';
  if (ordinal === 3) return 'A3';
  return null;
}

function isActionId(value: unknown): value is OpenSwanMultiActionId {
  return value === 'A1' || value === 'A2' || value === 'A3';
}

function parseLedger(value: unknown): ParsedLedger | null {
  if (!isRecord(value)) return null;
  if (readOwn(value, 'schemaVersion') !== 1) return null;
  if (readOwn(value, 'dispatchMode') !== 'single_openswan_turn') return null;

  const actionCount = readOwn(value, 'actionCount');
  const rawActions = readOwn(value, 'actions');
  if ((actionCount !== 1 && actionCount !== 2 && actionCount !== 3) || !Array.isArray(rawActions)) return null;
  if (rawActions.length !== actionCount) return null;

  const actions: OpenSwanMultiActionLedgerAction[] = [];
  const actionById = new Map<OpenSwanMultiActionId, OpenSwanMultiActionLedgerAction>();
  for (let index = 0; index < rawActions.length; index += 1) {
    const rawAction = rawActions[index];
    if (!isRecord(rawAction)) return null;
    const expectedOrdinal = index + 1;
    const expectedId = actionIdForOrdinal(expectedOrdinal);
    const id = readOwn(rawAction, 'id');
    const ordinal = readOwn(rawAction, 'ordinal');
    const rawDependencies = readOwn(rawAction, 'dependsOnActionIds');
    const rawEvidenceToolNames = readOwn(rawAction, 'evidenceToolNames');
    const rawEvidenceArtifactKinds = readOwn(rawAction, 'evidenceArtifactKinds');
    const rawEvidenceRequiresMutation = readOwn(rawAction, 'evidenceRequiresMutation');
    const rawEvidenceRequiresTargetBinding = readOwn(rawAction, 'evidenceRequiresTargetBinding');
    const rawEvidenceUnavailable = readOwn(rawAction, 'evidenceUnavailable');
    if (!expectedId || id !== expectedId || ordinal !== expectedOrdinal) return null;
    if (!Array.isArray(rawDependencies) || rawDependencies.length > index) return null;

    const dependencies: OpenSwanMultiActionId[] = [];
    const seenDependencies = new Set<OpenSwanMultiActionId>();
    for (const rawDependency of rawDependencies) {
      if (!isActionId(rawDependency) || seenDependencies.has(rawDependency)) return null;
      const dependencyOrdinal = Number(rawDependency.slice(1));
      if (dependencyOrdinal >= expectedOrdinal) return null;
      seenDependencies.add(rawDependency);
      dependencies.push(rawDependency);
    }

    let evidenceToolNames: string[] | undefined;
    if (rawEvidenceToolNames !== undefined) {
      if (!Array.isArray(rawEvidenceToolNames) || rawEvidenceToolNames.length === 0 || rawEvidenceToolNames.length > 16) {
        return null;
      }
      evidenceToolNames = [];
      const seenToolNames = new Set<string>();
      for (const rawToolName of rawEvidenceToolNames) {
        if (!isSafeToken(
          rawToolName,
          OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxToolNameChars,
          SAFE_KIND_RE,
        ) || seenToolNames.has(rawToolName)) {
          return null;
        }
        seenToolNames.add(rawToolName);
        evidenceToolNames.push(rawToolName);
      }
    }

    let evidenceArtifactKinds: string[] | undefined;
    if (rawEvidenceArtifactKinds !== undefined) {
      if (
        !Array.isArray(rawEvidenceArtifactKinds)
        || rawEvidenceArtifactKinds.length === 0
        || rawEvidenceArtifactKinds.length > 8
      ) return null;
      evidenceArtifactKinds = [];
      const seenArtifactKinds = new Set<string>();
      for (const rawArtifactKind of rawEvidenceArtifactKinds) {
        if (!isSafeToken(
          rawArtifactKind,
          OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxArtifactKindChars,
          SAFE_KIND_RE,
        ) || seenArtifactKinds.has(rawArtifactKind)) return null;
        seenArtifactKinds.add(rawArtifactKind);
        evidenceArtifactKinds.push(rawArtifactKind);
      }
    }

    if (
      rawEvidenceRequiresMutation !== undefined
      && typeof rawEvidenceRequiresMutation !== 'boolean'
    ) return null;
    if (
      rawEvidenceRequiresTargetBinding !== undefined
      && typeof rawEvidenceRequiresTargetBinding !== 'boolean'
    ) return null;
    if (rawEvidenceUnavailable !== undefined && typeof rawEvidenceUnavailable !== 'boolean') return null;
    if (
      rawEvidenceUnavailable === true
      && (
        evidenceToolNames !== undefined
        || evidenceArtifactKinds !== undefined
        || rawEvidenceRequiresMutation === true
        || rawEvidenceRequiresTargetBinding === true
      )
    ) return null;

    const action = Object.freeze({
      id: expectedId,
      ordinal: expectedOrdinal as 1 | 2 | 3,
      dependsOnActionIds: Object.freeze(dependencies),
      ...(evidenceToolNames ? { evidenceToolNames: Object.freeze(evidenceToolNames) } : {}),
      ...(evidenceArtifactKinds
        ? { evidenceArtifactKinds: Object.freeze(evidenceArtifactKinds) }
        : {}),
      ...(rawEvidenceRequiresMutation === true ? { evidenceRequiresMutation: true } : {}),
      ...(rawEvidenceRequiresTargetBinding === true ? { evidenceRequiresTargetBinding: true } : {}),
      ...(rawEvidenceUnavailable === true ? { evidenceUnavailable: true } : {}),
    });
    actions.push(action);
    actionById.set(expectedId, action);
  }
  return { actions, actionById };
}

function hasOnlyEvidenceKeys(value: Record<string, unknown>, kind: 'tool' | 'artifact'): boolean {
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return false;
  }
  if (keys.some((key) => !EVIDENCE_KEYS.has(key))) return false;
  if (kind === 'tool') return !keys.includes('artifactKind')
    && !keys.includes('actionId')
    && !keys.includes('contentPresent')
    && !keys.includes('durablyRecorded');
  return !keys.includes('tool')
    && !keys.includes('mutatesState')
    && !keys.includes('targetBound');
}

function parseEvidence(value: unknown): OpenSwanMultiActionEvidenceRecord | null {
  if (!isRecord(value)) return null;
  const evidenceId = readOwn(value, 'evidenceId');
  const sequence = readOwn(value, 'sequence');
  const status = readOwn(value, 'status');
  const kind = readOwn(value, 'kind');
  if (!isSafeToken(evidenceId, OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxEvidenceIdChars)) return null;
  if (!isSequence(sequence)) return null;
  if (status !== 'succeeded' && status !== 'blocked' && status !== 'failed') return null;

  if (kind === 'tool') {
    const tool = readOwn(value, 'tool');
    const mutatesState = readOwn(value, 'mutatesState');
    const targetBound = readOwn(value, 'targetBound');
    if (!hasOnlyEvidenceKeys(value, kind)) return null;
    if (!isSafeToken(tool, OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxToolNameChars, SAFE_KIND_RE)) return null;
    if (mutatesState !== undefined && typeof mutatesState !== 'boolean') return null;
    if (targetBound !== undefined && typeof targetBound !== 'boolean') return null;
    return Object.freeze({
      evidenceId,
      sequence,
      status,
      kind,
      tool,
      ...(typeof mutatesState === 'boolean' ? { mutatesState } : {}),
      ...(typeof targetBound === 'boolean' ? { targetBound } : {}),
    });
  }
  if (kind === 'artifact') {
    const actionId = readOwn(value, 'actionId');
    const artifactKind = readOwn(value, 'artifactKind');
    const contentPresent = readOwn(value, 'contentPresent');
    const durablyRecorded = readOwn(value, 'durablyRecorded');
    if (!hasOnlyEvidenceKeys(value, kind)) return null;
    if (!isActionId(actionId)) return null;
    if (!isSafeToken(
      artifactKind,
      OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxArtifactKindChars,
      SAFE_KIND_RE,
    )) return null;
    if (typeof contentPresent !== 'boolean' || typeof durablyRecorded !== 'boolean') return null;
    return Object.freeze({
      evidenceId,
      sequence,
      status,
      kind,
      actionId,
      artifactKind,
      contentPresent,
      durablyRecorded,
    });
  }
  return null;
}

function isReportStatus(value: unknown): value is OpenSwanMultiActionReportStatus {
  return value === 'completed' || value === 'pending' || value === 'blocked' || value === 'failed';
}

function parseReport(value: unknown): OpenSwanMultiActionReport | null {
  if (!isRecord(value)) return null;
  const actionId = readOwn(value, 'actionId');
  const status = readOwn(value, 'status');
  const reportedAtSequence = readOwn(value, 'reportedAtSequence');
  const rawEvidenceIds = readOwn(value, 'evidenceIds');
  if (!isActionId(actionId) || !isReportStatus(status) || !isSequence(reportedAtSequence)) return null;
  if (
    !Array.isArray(rawEvidenceIds)
    || rawEvidenceIds.length > OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxEvidenceIdsPerReport
  ) return null;

  const evidenceIds: string[] = [];
  for (const rawEvidenceId of rawEvidenceIds) {
    if (!isSafeToken(rawEvidenceId, OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxEvidenceIdChars)) return null;
    evidenceIds.push(rawEvidenceId);
  }
  return Object.freeze({
    actionId,
    status,
    reportedAtSequence,
    evidenceIds: Object.freeze(evidenceIds),
  });
}

function issue(
  code: OpenSwanMultiActionCompletionIssueCode,
  actionId?: OpenSwanMultiActionId,
  evidenceId?: string,
): OpenSwanMultiActionCompletionIssue {
  return Object.freeze({
    code,
    ...(actionId ? { actionId } : {}),
    ...(evidenceId ? { evidenceId } : {}),
  });
}

function freezeOutcome(args: {
  disposition: OpenSwanMultiActionCompletionDisposition;
  inputValid: boolean;
  actions: OpenSwanMultiActionCompletionAction[];
  issues: OpenSwanMultiActionCompletionIssue[];
}): OpenSwanMultiActionCompletionOutcome {
  const frozenActions = Object.freeze(args.actions.map((action) => Object.freeze({
    ...action,
    evidenceIds: Object.freeze([...action.evidenceIds]),
  })));
  const unresolvedActionIds = Object.freeze(frozenActions
    .filter((action) => action.status !== 'completed')
    .map((action) => action.actionId));
  return Object.freeze({
    schemaVersion: 1 as const,
    disposition: args.disposition,
    completionVerified: args.inputValid && args.disposition === 'verified',
    inputValid: args.inputValid,
    actions: frozenActions,
    unresolvedActionIds,
    issues: Object.freeze([...args.issues]),
  });
}

function invalidOutcome(
  actions: OpenSwanMultiActionCompletionAction[],
  issues: OpenSwanMultiActionCompletionIssue[],
): OpenSwanMultiActionCompletionOutcome {
  // A malformed or unverifiable accounting envelope is not proof that the
  // user's requested work itself failed. Keep it non-terminal/incomplete so
  // callers can ask for reconciliation without publishing a false failure.
  return freezeOutcome({ disposition: 'incomplete', inputValid: false, actions, issues });
}

/**
 * Validate action reports against a bounded ledger and trusted earlier evidence.
 * Provider prose is not accepted as input and therefore cannot affect success.
 */
export function evaluateOpenSwanMultiActionCompletion(
  input: unknown,
): OpenSwanMultiActionCompletionOutcome {
  try {
    if (!isRecord(input)) return invalidOutcome([], [issue('invalid_input')]);
    const ledger = parseLedger(readOwn(input, 'ledger'));
    if (!ledger) return invalidOutcome([], [issue('invalid_ledger')]);

    const rawEvidence = readOwn(input, 'evidence');
    const rawReports = readOwn(input, 'reports');
    if (
      !Array.isArray(rawEvidence)
      || rawEvidence.length > OPEN_SWAN_MULTI_ACTION_COMPLETION_LIMITS.maxEvidenceRecords
    ) return invalidOutcome([], [issue('invalid_evidence')]);
    if (!Array.isArray(rawReports) || rawReports.length > ledger.actions.length) {
      return invalidOutcome([], [issue('invalid_report')]);
    }

    const evidenceById = new Map<string, OpenSwanMultiActionEvidenceRecord>();
    for (const rawRecord of rawEvidence) {
      const record = parseEvidence(rawRecord);
      if (!record) return invalidOutcome([], [issue('invalid_evidence')]);
      if (evidenceById.has(record.evidenceId)) {
        return invalidOutcome([], [issue('duplicate_evidence_id', undefined, record.evidenceId)]);
      }
      evidenceById.set(record.evidenceId, record);
    }

    const reports = new Map<OpenSwanMultiActionId, OpenSwanMultiActionReport>();
    for (const rawReport of rawReports) {
      const report = parseReport(rawReport);
      if (!report) return invalidOutcome([], [issue('invalid_report')]);
      if (!ledger.actionById.has(report.actionId)) {
        return invalidOutcome([], [issue('unknown_report_action', report.actionId)]);
      }
      if (reports.has(report.actionId)) {
        return invalidOutcome([], [issue('duplicate_report_action', report.actionId)]);
      }
      reports.set(report.actionId, report);
    }

    const issues: OpenSwanMultiActionCompletionIssue[] = [];
    const evidenceOwner = new Map<string, OpenSwanMultiActionId>();
    const claimedEvidence = new Map<OpenSwanMultiActionId, OpenSwanMultiActionEvidenceRecord[]>();
    const actions: OpenSwanMultiActionCompletionAction[] = ledger.actions.map((action) => ({
      actionId: action.id,
      status: reports.get(action.id)?.status ?? 'missing',
      evidenceIds: reports.get(action.id)?.evidenceIds ?? [],
    }));

    for (const action of ledger.actions) {
      const report = reports.get(action.id);
      if (!report) {
        issues.push(issue('missing_action_report', action.id));
        continue;
      }
      if (report.status === 'pending') issues.push(issue('pending_action', action.id));

      const seenRefs = new Set<string>();
      const records: OpenSwanMultiActionEvidenceRecord[] = [];
      for (const evidenceId of report.evidenceIds) {
        if (seenRefs.has(evidenceId)) {
          issues.push(issue('duplicate_evidence_ref', action.id, evidenceId));
          continue;
        }
        seenRefs.add(evidenceId);
        const owner = evidenceOwner.get(evidenceId);
        if (owner && owner !== action.id) {
          issues.push(issue('evidence_cross_owned', action.id, evidenceId));
          continue;
        }
        evidenceOwner.set(evidenceId, action.id);
        const record = evidenceById.get(evidenceId);
        if (!record) {
          issues.push(issue('unknown_evidence_ref', action.id, evidenceId));
          continue;
        }
        if (record.sequence >= report.reportedAtSequence) {
          issues.push(issue('future_evidence_ref', action.id, evidenceId));
        }
        records.push(record);
      }
      claimedEvidence.set(action.id, records);

      const expectedEvidenceStatus: OpenSwanMultiActionEvidenceStatus | null = report.status === 'completed'
        ? 'succeeded'
        : report.status === 'blocked' || report.status === 'failed'
          ? report.status
          : null;
      const dependencyStoppedBeforeAction = report.status === 'blocked'
        && action.dependsOnActionIds.some((dependencyId) => {
          const dependencyStatus = reports.get(dependencyId)?.status;
          return dependencyStatus === 'blocked' || dependencyStatus === 'failed';
        });
      const statusMatches = expectedEvidenceStatus === null
        ? records.length === 0
        : dependencyStoppedBeforeAction && records.length === 0
          ? true
        : records.length > 0 && records.every((record) => record.status === expectedEvidenceStatus);
      if (!statusMatches || records.length !== report.evidenceIds.length) {
        issues.push(issue('status_evidence_mismatch', action.id));
      }
      if (
        action.evidenceToolNames
        && (
          records.filter((record) => record.kind === 'tool').length === 0
          || records.some((record) => (
            record.kind === 'tool' && !action.evidenceToolNames!.includes(record.tool)
          ))
        )
      ) {
        issues.push(issue('evidence_not_relevant', action.id));
      }
      if (
        action.evidenceArtifactKinds
        && (
          records.filter((record) => record.kind === 'artifact').length === 0
          || records.some((record) => (
            record.kind === 'artifact'
            && (
              record.actionId !== action.id
              || !action.evidenceArtifactKinds!.includes(record.artifactKind)
            )
          ))
        )
      ) {
        issues.push(issue('evidence_not_relevant', action.id));
      }
      if (action.evidenceUnavailable && report.status === 'completed') {
        issues.push(issue('completion_evidence_unavailable', action.id));
      }
      if (
        action.evidenceRequiresMutation
        && report.status === 'completed'
        && (
          records.filter((record) => record.kind === 'tool').length === 0
          || records.some((record) => record.kind === 'tool' && record.mutatesState !== true)
        )
      ) {
        issues.push(issue('evidence_not_mutating', action.id));
      }
      if (
        action.evidenceRequiresTargetBinding
        && report.status === 'completed'
        && (
          records.filter((record) => record.kind === 'tool').length === 0
          || records.some((record) => record.kind === 'tool' && record.targetBound !== true)
        )
      ) {
        issues.push(issue('evidence_target_mismatch', action.id));
      }
      if (
        action.evidenceArtifactKinds
        && report.status === 'completed'
        && records.some((record) => record.kind === 'artifact' && record.contentPresent !== true)
      ) {
        issues.push(issue('artifact_content_missing', action.id));
      }
      if (
        action.evidenceArtifactKinds
        && report.status === 'completed'
        && records.some((record) => record.kind === 'artifact' && record.durablyRecorded !== true)
      ) {
        issues.push(issue('artifact_persistence_unverified', action.id));
      }
    }

    for (const action of ledger.actions) {
      const report = reports.get(action.id);
      if (!report || report.status === 'pending') continue;
      const actionEvidence = claimedEvidence.get(action.id) ?? [];
      const firstActionSequence = actionEvidence.reduce(
        (minimum, record) => Math.min(minimum, record.sequence),
        Number.POSITIVE_INFINITY,
      );
      for (const dependencyId of action.dependsOnActionIds) {
        const dependencyReport = reports.get(dependencyId);
        const dependencyEvidence = claimedEvidence.get(dependencyId) ?? [];
        const lastDependencySequence = dependencyEvidence.reduce(
          (maximum, record) => Math.max(maximum, record.sequence),
          Number.NEGATIVE_INFINITY,
        );
        const dependencyStopped = dependencyReport?.status === 'blocked'
          || dependencyReport?.status === 'failed';
        const causallyBlocked = report.status === 'blocked' && dependencyStopped;
        const orderedAfterDependency = dependencyEvidence.length > 0
          && (actionEvidence.length === 0 || lastDependencySequence < firstActionSequence);
        const validDependency = causallyBlocked
          ? orderedAfterDependency
          : dependencyReport?.status === 'completed'
            && dependencyEvidence.length > 0
            && actionEvidence.length > 0
            && lastDependencySequence < firstActionSequence;
        if (!validDependency) {
          issues.push(issue('dependency_inversion', action.id));
        }
      }
    }

    const invalidCodes = new Set<OpenSwanMultiActionCompletionIssueCode>([
      'invalid_input',
      'invalid_ledger',
      'invalid_evidence',
      'duplicate_evidence_id',
      'invalid_report',
      'unknown_report_action',
      'duplicate_report_action',
      'duplicate_evidence_ref',
      'unknown_evidence_ref',
      'evidence_cross_owned',
      'future_evidence_ref',
      'status_evidence_mismatch',
      'evidence_not_relevant',
      'evidence_not_mutating',
      'evidence_target_mismatch',
      'artifact_content_missing',
      'artifact_persistence_unverified',
      'completion_evidence_unavailable',
      'dependency_inversion',
    ]);
    if (issues.some((entry) => invalidCodes.has(entry.code))) {
      return invalidOutcome(
        actions.map((action) => ({ ...action, status: 'invalid' })),
        issues,
      );
    }

    const statuses = actions.map((action) => action.status);
    const disposition: OpenSwanMultiActionCompletionDisposition = statuses.includes('failed')
      ? 'failed'
      : statuses.includes('blocked')
        ? 'blocked'
        : statuses.every((status) => status === 'completed')
          ? 'verified'
          : 'incomplete';
    return freezeOutcome({ disposition, inputValid: true, actions, issues });
  } catch {
    return invalidOutcome([], [issue('invalid_input')]);
  }
}
