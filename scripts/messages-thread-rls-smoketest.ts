/**
 * Database-free contract smoke for 20260805_messages_thread_rls_and_reactions.
 *
 * Run:
 *   npx tsx scripts/messages-thread-rls-smoketest.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260805_messages_thread_rls_and_reactions.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function has(needle: string, message: string): void {
  check(sql.includes(needle), message);
}

function lacks(needle: string, message: string): void {
  check(!sql.includes(needle), message);
}

function section(start: string, end: string): string {
  const startIndex = sql.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = sql.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return sql.slice(startIndex, endIndex);
}

function assertBalancedSql(source: string): void {
  const dollarTags: string[] = [];
  let inSingleQuote = false;
  let inLineComment = false;
  let parens = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (!inSingleQuote && dollarTags.length === 0 && char === '-' && next === '-') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (dollarTags.length === 0 && char === "'") {
      if (inSingleQuote && next === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;
    if (char === '$') {
      const match = source.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (dollarTags.at(-1) === tag) dollarTags.pop();
        else if (dollarTags.length === 0) dollarTags.push(tag);
        index += tag.length - 1;
        continue;
      }
    }
    if (dollarTags.length > 0) continue;
    if (char === '(') parens += 1;
    if (char === ')') parens -= 1;
    if (parens < 0) {
      throw new Error(`messages-thread-rls smoke failed: SQL parentheses underflow at offset ${index}`);
    }
  }
  check(!inSingleQuote, 'SQL has no unterminated single-quoted literal');
  check(dollarTags.length === 0, 'SQL has no unterminated dollar-quoted block');
  check(parens === 0, 'SQL parentheses are balanced');
}

assertBalancedSql(sql);

// ─── One-time lineage convergence ───────────────────────────────────────────
has('ADD CONSTRAINT messages_thread_id_convergence_nn', 'convergence installs a new-row NULL guard before backfill');
has('CHECK (thread_id IS NOT NULL) NOT VALID;', 'legacy rows remain repairable while concurrent NULL inserts fail closed');
has('WHERE message.thread_id IS NULL', 'legacy NULL thread rows are explicitly scoped');
has("AND thread.visibility = 'circle';", 'legacy repair uses only the canonical circle thread');
has("RAISE EXCEPTION 'messages_thread_rls: legacy messages remain without a canonical circle thread'", 'unresolved NULL lineage aborts');
has("RAISE EXCEPTION 'messages_thread_rls: message/thread circle lineage mismatch'", 'existing cross-circle lineage aborts');
has("RAISE EXCEPTION 'messages_thread_rls: reply target is outside the message thread'", 'existing cross-thread replies abort');
has('ALTER COLUMN thread_id SET NOT NULL;', 'thread lineage becomes mandatory');
has('VALIDATE CONSTRAINT messages_thread_id_convergence_nn;', 'convergence guard is validated before native NOT NULL');
has('DROP CONSTRAINT messages_thread_id_convergence_nn;', 'temporary convergence constraint is removed after NOT NULL');
check(!/^LOCK TABLE/m.test(sql), 'migration remains runnable under psql autocommit');

const assignThread = section(
  'CREATE OR REPLACE FUNCTION public.assign_and_validate_message_thread()',
  'CREATE OR REPLACE FUNCTION public.message_reactions_are_self_only_change(',
);
check(assignThread.includes('IF NEW.thread_id IS NULL THEN'), 'legacy no-thread insert has one deterministic compatibility path');
check(assignThread.includes("thread.visibility = 'circle'"), 'default assignment cannot select private/shared threads');
check(assignThread.includes("RAISE EXCEPTION 'messages_thread_required'"), 'missing default fails closed');
check(assignThread.includes('thread.circle_id = NEW.circle_id'), 'trigger binds thread to exact circle');
check(assignThread.includes('parent.thread_id = NEW.thread_id'), 'trigger binds reply to exact thread');
check(assignThread.includes('BEFORE INSERT OR UPDATE OF circle_id, thread_id, reply_to'), 'lineage guard covers every writer including service role');

// ─── Policy convergence ────────────────────────────────────────────────────
for (const policyName of [
  'Circle members can read messages',
  'Circle members can insert messages',
  'Users can update message reactions',
  'circle members can read messages',
  'users can insert own messages',
  'users can update reactions',
  'users can delete own messages',
  'Enable read access for all users',
  'Enable insert for authenticated',
]) {
  has(`DROP POLICY IF EXISTS "${policyName}" ON public.messages;`, `explicitly drops legacy policy: ${policyName}`);
}
has("FROM pg_catalog.pg_policies", 'unknown policy drift is enumerated');
has("AND tablename = 'messages'", 'dynamic convergence is messages-only');
has("EXECUTE format('DROP POLICY %I ON public.messages'", 'every remaining permissive policy is dropped safely');

const policyNames = [
  'messages_select_thread_visible',
  'messages_insert_thread_visible',
  'messages_update_thread_visible',
  'messages_delete_creator_thread_visible',
];
for (const policyName of policyNames) {
  has(`CREATE POLICY ${policyName}`, `creates canonical policy ${policyName}`);
}
check((sql.match(/CREATE POLICY messages_/g) || []).length === 4, 'exactly four canonical messages policies remain');
lacks('USING (true)', 'no allow-all USING predicate');
lacks('WITH CHECK (true)', 'no allow-all WITH CHECK predicate');

const visibility = section(
  'CREATE OR REPLACE FUNCTION public.message_thread_visible_to_current_user(',
  'CREATE OR REPLACE FUNCTION public.message_reply_matches_thread(',
);
check(visibility.includes('membership.user_id = auth.uid()'), 'visibility always requires current circle membership');
check(visibility.includes('thread.id = p_thread_id'), 'visibility binds exact thread');
check(visibility.includes('thread.circle_id = p_circle_id'), 'visibility binds exact circle/thread pair');
check(visibility.includes("thread.visibility = 'circle'"), 'circle-wide thread mode is supported');
check(visibility.includes('thread.created_by = auth.uid()'), 'private creator is supported');
check(visibility.includes('thread_member.user_id = auth.uid()'), 'explicit shared/private member is supported');
check(visibility.includes('SET search_path = pg_catalog, public'), 'visibility helper pins search_path');

// ─── Canonical thread + invitation authority ───────────────────────────────
const legacyVisibilityHelpers = section(
  'CREATE OR REPLACE FUNCTION public.user_is_circle_member(p_circle_id uuid)',
  'CREATE OR REPLACE FUNCTION public.chat_thread_invitee_is_circle_member(',
);
check(legacyVisibilityHelpers.includes('membership.user_id = auth.uid()'), 'legacy circle-member helper is auth-bound');
check(legacyVisibilityHelpers.includes('SET search_path = pg_catalog, public'), 'legacy visibility helpers pin search_path');
check(legacyVisibilityHelpers.includes('message_thread_visible_to_current_user(thread.circle_id, thread.id)'), 'legacy thread helper delegates to canonical visibility');

const inviteHelper = section(
  'CREATE OR REPLACE FUNCTION public.chat_thread_invitee_is_circle_member(',
  'CREATE OR REPLACE FUNCTION public.validate_chat_thread_member()',
);
check(inviteHelper.includes('membership.user_id = p_user_id'), 'invite helper binds exact target user');
check(inviteHelper.includes('thread.created_by = auth.uid()'), 'only thread creator may invite');
check(inviteHelper.includes('message_thread_visible_to_current_user(thread.circle_id, thread.id)'), 'inviter must retain circle/thread access');
check(inviteHelper.includes('SET search_path = pg_catalog, public'), 'invite helper pins search_path');

const memberGuard = section(
  'CREATE OR REPLACE FUNCTION public.validate_chat_thread_member()',
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_chat_thread_mutation()',
);
check(memberGuard.includes('membership.circle_id = v_circle_id'), 'member trigger enforces target circle membership for every writer');
check(memberGuard.includes("NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM v_created_by"), 'member trigger forbids forged owner role');
check(memberGuard.includes("NEW.role = 'member' AND NEW.user_id = v_created_by"), 'thread creator cannot be downgraded to invited member');
check(memberGuard.includes('BEFORE INSERT OR UPDATE ON public.circle_chat_thread_members'), 'member invariant covers service and authenticated writes');

const threadGuard = section(
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_chat_thread_mutation()',
  'CREATE OR REPLACE FUNCTION public.cct_visibility_sync()',
);
check(threadGuard.includes("to_jsonb(NEW) - 'title' - 'default_model' - 'archived' - 'updated_at'"), 'direct thread updates use a narrow settings allowlist');
check(threadGuard.includes("- 'last_message_at'"), 'only nested trusted triggers may update activity fields');
check(threadGuard.includes("- 'last_message_preview'"), 'preview is a nested-trigger field, not client metadata');
check(threadGuard.includes("RAISE EXCEPTION 'chat_thread_immutable_identity'"), 'circle/creator/default/lineage/future columns fail closed');
check(threadGuard.includes('OLD.created_by IS DISTINCT FROM v_user_id'), 'creator-facing settings remain creator-only in nested paths');
check(threadGuard.includes("OLD.visibility = 'circle' AND NEW.archived IS TRUE"), 'default circle thread cannot be archived');
check(threadGuard.includes('pg_trigger_depth() <= 1'), 'direct visibility promotion/demotion is denied');
check(threadGuard.includes("WHEN v_other_member_count > 0 THEN 'shared'"), 'nested visibility promotion requires an active invited member');
check(threadGuard.includes("ELSE 'private'"), 'nested visibility demotion requires no active invited members');

const visibilitySync = section(
  'CREATE OR REPLACE FUNCTION public.cct_visibility_sync()',
  'ALTER TABLE public.circle_chat_threads ENABLE ROW LEVEL SECURITY;',
);
check(visibilitySync.includes('SECURITY DEFINER'), 'membership-derived visibility sync can demote when invitee leaves');
check(visibilitySync.includes('SET search_path = pg_catalog, public'), 'visibility sync pins search_path');
check(visibilitySync.includes('JOIN public.circle_members AS circle_member'), 'departed invitees do not count toward shared visibility');
check(visibilitySync.includes("SET visibility = 'shared'"), 'visibility sync promotes from membership');
check(visibilitySync.includes("SET visibility = 'private'"), 'visibility sync demotes from membership');

const messageTouch = section(
  'CREATE OR REPLACE FUNCTION public.circle_chat_threads_touch_on_message()',
  'ALTER TABLE public.circle_chat_threads ENABLE ROW LEVEL SECURITY;',
);
check(messageTouch.includes('SECURITY DEFINER'), 'message touch works for non-creator thread members');
check(messageTouch.includes('SET search_path = pg_catalog, public'), 'message touch pins search_path');
check(messageTouch.includes('WHERE id = NEW.thread_id'), 'message touch binds exact thread');
check(messageTouch.includes('AND circle_id = NEW.circle_id'), 'message touch binds exact circle');
check(messageTouch.includes('NEW.created_at >= last_message_at'), 'historical/imported messages cannot regress thread recency');
check(messageTouch.includes('REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM PUBLIC'), 'message touch is not directly callable');
check(messageTouch.includes('AFTER INSERT ON public.messages'), 'canonical message touch trigger is recreated');

const threadPolicies = section(
  'ALTER TABLE public.circle_chat_threads ENABLE ROW LEVEL SECURITY;',
  '-- Fill the legacy no-thread caller path',
);
for (const policyName of ['cct_read', 'cct_insert', 'cct_update', 'cct_delete']) {
  check(threadPolicies.includes(`CREATE POLICY ${policyName}`), `creates canonical thread policy ${policyName}`);
}
for (const policyName of ['cct_members_read', 'cct_members_insert', 'cct_members_delete']) {
  check(threadPolicies.includes(`CREATE POLICY ${policyName}`), `creates canonical membership policy ${policyName}`);
}
check(!threadPolicies.includes('CREATE POLICY cct_members_update'), 'authenticated users receive no membership UPDATE policy');
check(threadPolicies.includes("tablename = 'circle_chat_threads'"), 'unknown thread-policy drift is converged');
check(threadPolicies.includes("tablename = 'circle_chat_thread_members'"), 'unknown member-policy drift is converged');

const cctInsertPolicy = section(
  'CREATE POLICY cct_insert',
  'CREATE POLICY cct_update',
);
check(cctInsertPolicy.includes('created_by = auth.uid()'), 'direct thread INSERT binds creator');
check(cctInsertPolicy.includes("visibility = 'private'"), 'direct thread INSERT cannot forge shared/default visibility');
check(cctInsertPolicy.includes('user_is_circle_member(circle_id)'), 'direct thread INSERT requires circle membership');
check(cctInsertPolicy.includes('parent_thread_id IS NULL'), 'direct thread INSERT cannot forge parent lineage');
check(cctInsertPolicy.includes('lineage_root_id IS NULL'), 'direct thread INSERT cannot forge lineage root');
check(cctInsertPolicy.includes('archived IS FALSE'), 'direct thread INSERT cannot create hidden archived state');
check(cctInsertPolicy.includes('last_message_preview IS NULL'), 'direct thread INSERT cannot forge activity preview');
check(cctInsertPolicy.includes("created_at BETWEEN now() - interval '5 minutes'"), 'direct thread INSERT timestamps are bounded near server time');

const cctDeletePolicy = section(
  'CREATE POLICY cct_delete',
  'DROP POLICY IF EXISTS cct_members_read',
);
check(cctDeletePolicy.includes("visibility <> 'circle'"), 'default circle thread cannot be deleted');
check(cctDeletePolicy.includes('created_by = auth.uid()'), 'thread DELETE is creator-only');

const memberInsertPolicy = section(
  'CREATE POLICY cct_members_insert',
  'CREATE POLICY cct_members_delete',
);
check(memberInsertPolicy.includes("role = 'member'"), 'authenticated invite cannot forge owner role');
check(memberInsertPolicy.includes('added_by = auth.uid()'), 'invite provenance is caller-bound');
check(memberInsertPolicy.includes('user_id <> auth.uid()'), 'creator cannot add a parallel self-member row');
check(memberInsertPolicy.includes('chat_thread_invitee_is_circle_member(thread_id, user_id)'), 'invite target must be a current circle member');

const selectPolicy = section(
  'CREATE POLICY messages_select_thread_visible',
  'CREATE POLICY messages_insert_thread_visible',
);
check(selectPolicy.includes('TO authenticated'), 'SELECT is authenticated-only');
check(selectPolicy.includes('message_thread_visible_to_current_user(circle_id, thread_id)'), 'SELECT requires thread visibility');

const insertPolicy = section(
  'CREATE POLICY messages_insert_thread_visible',
  'CREATE POLICY messages_update_thread_visible',
);
check(insertPolicy.includes('user_id = auth.uid()'), 'INSERT binds creator identity');
check(insertPolicy.includes('message_thread_visible_to_current_user(circle_id, thread_id)'), 'INSERT requires thread visibility');
check(insertPolicy.includes('message_reply_matches_thread(reply_to, circle_id, thread_id)'), 'INSERT requires same-thread reply');
check(insertPolicy.includes("COALESCE(reactions, '{}'::jsonb) = '{}'::jsonb"), 'INSERT cannot forge reaction state');

const updatePolicy = section(
  'CREATE POLICY messages_update_thread_visible',
  'CREATE POLICY messages_delete_creator_thread_visible',
);
check(updatePolicy.includes('FOR UPDATE'), 'canonical UPDATE is command-scoped');
check(updatePolicy.includes('TO authenticated'), 'UPDATE is authenticated-only');
check((updatePolicy.match(/message_thread_visible_to_current_user/g) || []).length === 2, 'UPDATE USING and WITH CHECK both enforce visibility');

const deletePolicy = section(
  'CREATE POLICY messages_delete_creator_thread_visible',
  '-- Atomic self-reaction mutation.',
);
check(deletePolicy.includes('user_id = auth.uid()'), 'DELETE remains creator-only');
check(deletePolicy.includes('message_thread_visible_to_current_user(circle_id, thread_id)'), 'DELETE also requires current visibility');

// ─── Whole-row rewrite guard + compatibility boundary ─────────────────────
const mutationGuard = section(
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_message_mutation()',
  'ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;',
);
check(mutationGuard.includes("to_jsonb(NEW) - 'content' - 'reactions'"), 'all identity/thread/future columns are immutable to authenticated writers');
check(mutationGuard.includes('OLD.user_id IS DISTINCT FROM v_user_id'), 'content changes are creator-only');
check(mutationGuard.includes('message_reactions_are_self_only_change('), 'direct compatibility reactions get self-only validation');
check(mutationGuard.includes('IF v_user_id IS NULL THEN'), 'trusted service maintenance remains compatible');
check(mutationGuard.includes("IF TG_OP = 'INSERT' THEN"), 'authenticated inserts take the server timestamp path');
check(mutationGuard.includes('NEW.created_at := statement_timestamp()'), 'authenticated callers cannot forge message ordering timestamps');
check(mutationGuard.includes('BEFORE INSERT OR UPDATE ON public.messages'), 'timestamp and rewrite guards cover every client mutation');

has('current authenticated\n-- Chat clients create bot rows with user_id = auth.uid()', 'bot creator compatibility is explicitly documented');
has('Strict bot provenance requires a later\n-- trusted server/RPC write lane', 'residual bot provenance trust gap is explicit');
check(!insertPolicy.includes('is_bot = false'), 'current authenticated bot persistence remains deployable');

const reactionValidator = section(
  'CREATE OR REPLACE FUNCTION public.message_reactions_are_self_only_change(',
  'CREATE OR REPLACE FUNCTION public.guard_authenticated_message_mutation()',
);
check(reactionValidator.includes('WHERE item.value <> p_user_id::text'), 'other-user reaction membership is compared independently');
check(reactionValidator.includes('v_old_other IS DISTINCT FROM v_new_other'), 'other-user reaction changes fail closed');
check(reactionValidator.includes('v_new_count <> v_new_distinct_count'), 'new reaction arrays reject duplicates');
check(reactionValidator.includes("v_key IN ('__proto__', 'prototype', 'constructor')"), 'dangerous object keys are rejected');
check(reactionValidator.includes('ascii(substr(v_key, position.index, 1)) < 32'), 'reaction keys reject ASCII control characters without locale-sensitive regex');
check(reactionValidator.includes('v_new_count = 0'), 'new empty reaction keys are rejected');
check(reactionValidator.includes('v_new_count > 128'), 'direct compatibility update has the same total-key cap');
check(reactionValidator.includes('octet_length(v_new::text) > 65536'), 'direct compatibility update has a total JSON size cap');
check(reactionValidator.includes('v_changed_key_count > 1'), 'one direct update can toggle only one emoji key');

// ─── Narrow atomic reaction RPC ────────────────────────────────────────────
const reactionRpc = section(
  'CREATE OR REPLACE FUNCTION public.set_message_reaction(',
  "COMMENT ON FUNCTION public.set_message_reaction(uuid, text, boolean) IS",
);
check(reactionRpc.includes('SECURITY DEFINER'), 'reaction RPC is SECURITY DEFINER');
check(reactionRpc.includes('SET search_path = pg_catalog, public'), 'reaction RPC pins search_path');
check(reactionRpc.includes('v_user_id uuid := auth.uid()'), 'reaction RPC derives identity from auth, not arguments');
check(reactionRpc.includes('message_thread_visible_to_current_user('), 'reaction target must be visible');
check(reactionRpc.includes('FOR UPDATE'), 'reaction RPC locks exact row');
check(reactionRpc.includes('item.value = v_user_id::text'), 'add path checks only caller membership');
check(reactionRpc.includes('item.value <> v_user_id::text'), 'remove path strips only caller membership');
check(reactionRpc.includes('FROM jsonb_object_keys(v_reactions)'), 'reaction key count uses a standard PostgreSQL JSONB primitive');
check(reactionRpc.includes('v_reaction_key_count >= 128'), 'reaction key growth is bounded');
check(reactionRpc.includes('ascii(substr(v_emoji, position.index, 1)) < 32'), 'RPC emoji validation is locale-independent');
check(reactionRpc.includes('octet_length(v_reactions::text) > 65536'), 'reaction RPC bounds total JSON size');
check(!reactionRpc.includes('jsonb_object_length'), 'reaction RPC does not call a nonexistent JSONB object-length helper');
check(reactionRpc.includes('UPDATE public.messages AS message\n  SET reactions = v_reactions\n  WHERE message.id = p_message_id;'), 'RPC changes only reactions on exact id');
check(
  !reactionRpc.slice(0, reactionRpc.indexOf('RETURNS jsonb')).includes('p_user_id'),
  'public reaction RPC accepts no caller-controlled user id',
);
has('REVOKE ALL ON FUNCTION public.set_message_reaction(uuid, text, boolean) FROM PUBLIC;', 'reaction RPC removes default PUBLIC execute');
has('REVOKE ALL ON FUNCTION public.set_message_reaction(uuid, text, boolean) FROM anon;', 'reaction RPC denies anon');
has('GRANT EXECUTE ON FUNCTION public.set_message_reaction(uuid, text, boolean) TO authenticated;', 'reaction RPC grants only authenticated callers');

has("FROM pg_catalog.pg_publication", 'realtime publication existence is checked');
has("FROM pg_catalog.pg_publication_tables", 'realtime table membership is checked idempotently');
has("tablename = 'circle_chat_threads'", 'thread table is the realtime publication target');
has('ALTER PUBLICATION supabase_realtime ADD TABLE public.circle_chat_threads;', 'thread changes publish to the sidebar subscription');

// ─── Executable semantic model ─────────────────────────────────────────────
type Thread = {
  id: string;
  circleId: string;
  createdBy: string;
  visibility: 'circle' | 'private' | 'shared';
  members: Set<string>;
};

function canSeeThread(input: {
  userId: string | null;
  circleId: string | null;
  threadId: string | null;
  circleMembers: Set<string>;
  thread: Thread;
}): boolean {
  const { userId, circleId, threadId, circleMembers, thread } = input;
  return !!userId
    && !!circleId
    && !!threadId
    && circleMembers.has(userId)
    && thread.id === threadId
    && thread.circleId === circleId
    && (
      thread.visibility === 'circle'
      || thread.createdBy === userId
      || thread.members.has(userId)
    );
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const CIRCLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CIRCLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THREAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const circleMembers = new Set([OWNER, MEMBER]);

function visible(thread: Thread, userId: string | null, circleId = CIRCLE, threadId: string | null = THREAD): boolean {
  return canSeeThread({ userId, circleId, threadId, circleMembers, thread });
}

const circleThread: Thread = { id: THREAD, circleId: CIRCLE, createdBy: OWNER, visibility: 'circle', members: new Set() };
check(visible(circleThread, OWNER), 'model: circle owner sees circle thread');
check(visible(circleThread, MEMBER), 'model: current circle member sees circle thread');
check(!visible(circleThread, OUTSIDER), 'model: nonmember cannot see circle thread');
check(!visible(circleThread, null), 'model: unauthenticated caller cannot see thread');
check(!visible(circleThread, MEMBER, OTHER_CIRCLE), 'model: circle/thread mismatch fails');
check(!visible(circleThread, MEMBER, CIRCLE, null), 'model: NULL thread fails');

const privateThread: Thread = { id: THREAD, circleId: CIRCLE, createdBy: OWNER, visibility: 'private', members: new Set() };
check(visible(privateThread, OWNER), 'model: current circle member who owns private thread sees it');
check(!visible(privateThread, MEMBER), 'model: uninvited circle member cannot see private thread');
check(!canSeeThread({ userId: OWNER, circleId: CIRCLE, threadId: THREAD, circleMembers: new Set(), thread: privateThread }), 'model: departed private owner cannot see messages');

const sharedThread: Thread = { ...privateThread, visibility: 'shared', members: new Set([MEMBER]) };
check(visible(sharedThread, MEMBER), 'model: invited current member sees shared thread');
check(!visible(sharedThread, OUTSIDER), 'model: invited-list absence and circle absence deny outsider');

function mayInvite(input: {
  actor: string;
  target: string;
  thread: Thread;
  members: Set<string>;
}): boolean {
  return input.thread.createdBy === input.actor
    && input.actor !== input.target
    && input.members.has(input.actor)
    && input.members.has(input.target);
}

check(mayInvite({ actor: OWNER, target: MEMBER, thread: privateThread, members: circleMembers }), 'model: owner can invite current circle member');
check(!mayInvite({ actor: MEMBER, target: OWNER, thread: privateThread, members: circleMembers }), 'model: nonowner cannot invite');
check(!mayInvite({ actor: OWNER, target: OUTSIDER, thread: privateThread, members: circleMembers }), 'model: outsider cannot be invited');
check(!mayInvite({ actor: OWNER, target: OWNER, thread: privateThread, members: circleMembers }), 'model: owner cannot forge a parallel member role');

type ThreadMutation = {
  idChanged?: boolean;
  circleChanged?: boolean;
  creatorChanged?: boolean;
  createdAtChanged?: boolean;
  oldVisibility: Thread['visibility'];
  newVisibility: Thread['visibility'];
  oldArchived?: boolean;
  newArchived?: boolean;
  nestedMembershipTrigger?: boolean;
  activeOtherMembers?: number;
};

function threadMutationAllowed(mutation: ThreadMutation): boolean {
  if (mutation.idChanged || mutation.circleChanged || mutation.creatorChanged || mutation.createdAtChanged) return false;
  if (mutation.oldVisibility === 'circle' && mutation.newArchived) return false;
  if (mutation.oldVisibility !== mutation.newVisibility) {
    if (mutation.oldVisibility === 'circle' || mutation.newVisibility === 'circle') return false;
    if (!mutation.nestedMembershipTrigger) return false;
    const expected = (mutation.activeOtherMembers || 0) > 0 ? 'shared' : 'private';
    if (mutation.newVisibility !== expected) return false;
  }
  return true;
}

check(threadMutationAllowed({ oldVisibility: 'private', newVisibility: 'private' }), 'model: private thread rename/config update remains compatible');
check(!threadMutationAllowed({ circleChanged: true, oldVisibility: 'private', newVisibility: 'private' }), 'model: thread cannot move circles');
check(!threadMutationAllowed({ creatorChanged: true, oldVisibility: 'private', newVisibility: 'private' }), 'model: thread ownership cannot transfer');
check(!threadMutationAllowed({ oldVisibility: 'private', newVisibility: 'shared', activeOtherMembers: 1 }), 'model: direct promotion is denied even when target happens to be derived');
check(threadMutationAllowed({ oldVisibility: 'private', newVisibility: 'shared', nestedMembershipTrigger: true, activeOtherMembers: 1 }), 'model: invite trigger may derive shared visibility');
check(!threadMutationAllowed({ oldVisibility: 'private', newVisibility: 'shared', nestedMembershipTrigger: true, activeOtherMembers: 0 }), 'model: nested promotion without invitee fails');
check(threadMutationAllowed({ oldVisibility: 'shared', newVisibility: 'private', nestedMembershipTrigger: true, activeOtherMembers: 0 }), 'model: final invitee removal may derive private visibility');
check(!threadMutationAllowed({ oldVisibility: 'circle', newVisibility: 'circle', newArchived: true }), 'model: default circle thread cannot archive');
check(!threadMutationAllowed({ oldVisibility: 'circle', newVisibility: 'private', nestedMembershipTrigger: true, activeOtherMembers: 0 }), 'model: default visibility is immutable');

type Message = {
  id: string;
  circleId: string;
  threadId: string;
  userId: string;
  content: string;
  isBot: boolean;
  replyTo: string | null;
  reactions: Record<string, string[]>;
};

const message: Message = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  circleId: CIRCLE,
  threadId: THREAD,
  userId: OWNER,
  content: 'bot metadata envelope',
  isBot: true,
  replyTo: null,
  reactions: { '👍': [MEMBER] },
};

function sameOtherReactions(
  oldReactions: Record<string, string[]>,
  newReactions: Record<string, string[]>,
  actor: string,
): boolean {
  const keys = new Set([...Object.keys(oldReactions), ...Object.keys(newReactions)]);
  if (Object.keys(newReactions).length > 128) return false;
  let changedKeys = 0;
  for (const key of keys) {
    const oldValues = oldReactions[key] || [];
    const newValues = newReactions[key] || [];
    if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) changedKeys += 1;
    if (changedKeys > 1) return false;
    if (new Set(newValues).size !== newValues.length) return false;
    if (key in newReactions && newValues.length === 0) return false;
    const oldOther = [...new Set(oldValues.filter((id) => id !== actor))].sort();
    const newOther = [...new Set(newValues.filter((id) => id !== actor))].sort();
    if (JSON.stringify(oldOther) !== JSON.stringify(newOther)) return false;
  }
  return true;
}

check(sameOtherReactions(message.reactions, { '👍': [MEMBER, OWNER] }, OWNER), 'model: caller can add own reaction');
check(sameOtherReactions({ '👍': [MEMBER, OWNER] }, { '👍': [MEMBER] }, OWNER), 'model: caller can remove own reaction');
check(!sameOtherReactions(message.reactions, { '👍': [MEMBER, OUTSIDER] }, OWNER), 'model: caller cannot add another user reaction');
check(!sameOtherReactions(message.reactions, {}, OWNER), 'model: caller cannot remove another user reaction');
check(!sameOtherReactions(message.reactions, { '👍': [MEMBER, MEMBER] }, OWNER), 'model: duplicate reaction ids fail closed');
check(!sameOtherReactions(message.reactions, { '👍': [] }, OWNER), 'model: empty reaction keys fail closed');
check(!sameOtherReactions({}, { '👍': [OWNER], '👎': [OWNER] }, OWNER), 'model: one direct update cannot toggle many keys');

function mayChangeContent(row: Message, actor: string): boolean {
  return row.userId === actor && visible(sharedThread, actor);
}
check(mayChangeContent(message, OWNER), 'model: creator-owned bot finalization remains compatible');
check(!mayChangeContent(message, MEMBER), 'model: another member cannot rewrite bot metadata');
check(!mayChangeContent(message, OUTSIDER), 'model: outsider cannot rewrite content');

function mayDelete(row: Message, actor: string): boolean {
  return row.userId === actor && visible(sharedThread, actor);
}
check(mayDelete(message, OWNER), 'model: creator can delete own visible bot row');
check(!mayDelete(message, MEMBER), 'model: member cannot delete another creator row');

console.log(`messages-thread-rls smoke passed (${assertions} assertions)`);
