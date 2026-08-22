// ─── Prompt Manager ─────────────────────────────────────────────────────────
// Langfuse-style prompt management: versioning, labels, compile, caching, A/B
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeGetSession, safeGetUserForAccessToken } from './authSession';
import { getSupabaseClientForAccessToken } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export type PromptType = 'text' | 'chat';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptConfig {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  [key: string]: any;
}

export interface Prompt {
  id: string;
  ownerId: string;
  circleId: string | null;
  name: string;
  type: PromptType;
  description: string | null;
  isShared: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  content: string;
  config: PromptConfig;
  variables: string[];
  createdAt: string;
  createdBy: string;
}

export interface PromptLabel {
  id: string;
  promptId: string;
  label: string;
  versionId: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CompiledPrompt {
  type: PromptType;
  content: string;
  messages?: ChatMessage[];
  config: PromptConfig;
  version: number;
  versionId: string;
  promptName: string;
  label: string;
}

export interface PromptManagerScope {
  userId: string;
  circleId: string;
}

interface CapturedPromptAuthority extends PromptManagerScope {
  accessToken: string;
}

interface PromptDetailSnapshot {
  versions: PromptVersion[];
  labels: PromptLabel[];
}

const MAX_PROMPT_SCOPE_PART_LENGTH = 200;

function normalizeScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_PROMPT_SCOPE_PART_LENGTH ? normalized : null;
}

export function promptManagerScopeKey(scope: PromptManagerScope, promptId?: string | null): string {
  return `${scope.userId}\u0000${scope.circleId}\u0000${promptId || ''}`;
}

async function capturePromptAuthority(scope: PromptManagerScope): Promise<CapturedPromptAuthority> {
  const userId = normalizeScopePart(scope.userId);
  const circleId = normalizeScopePart(scope.circleId);
  if (!userId || !circleId) throw new Error('Prompt scope is invalid.');

  const { value: session, error } = await safeGetSession();
  if (error) throw new Error(`Prompt access could not be verified: ${error.message}`);
  if (!session?.access_token || session.user.id !== userId) {
    throw new Error('Prompt access changed. Reload this circle and try again.');
  }
  const { value: verifiedUser, error: verificationError } = await safeGetUserForAccessToken(
    session.access_token,
  );
  if (verificationError || verifiedUser?.id !== userId) {
    throw new Error('Prompt access could not be verified for the current user.');
  }

  return Object.freeze({ userId, circleId, accessToken: session.access_token });
}

function promptClient(authority: CapturedPromptAuthority): SupabaseClient {
  return getSupabaseClientForAccessToken(authority.accessToken);
}

function promptReadError(subject: string, error: { message?: string } | null): Error {
  const detail = error?.message?.trim();
  return new Error(detail ? `${subject} could not be loaded: ${detail}` : `${subject} could not be loaded.`);
}

function promptIsReadableInScope(row: any, authority: CapturedPromptAuthority): boolean {
  const isPersonalOrCurrentCircle = row?.circle_id == null || row.circle_id === authority.circleId;
  if (row?.owner_id === authority.userId) return isPersonalOrCurrentCircle;
  return row?.circle_id === authority.circleId && row?.is_shared === true;
}

function promptIsOwnedInScope(row: any, authority: CapturedPromptAuthority): boolean {
  return row?.owner_id === authority.userId
    && (row?.circle_id == null || row.circle_id === authority.circleId);
}

async function loadPromptScopeRow(
  client: SupabaseClient,
  authority: CapturedPromptAuthority,
  promptId: string,
  requireOwnership: boolean,
): Promise<any> {
  const normalizedPromptId = normalizeScopePart(promptId);
  if (!normalizedPromptId) throw new Error('Prompt selection is invalid.');
  const { data, error } = await client
    .from('prompts')
    .select('*')
    .eq('id', normalizedPromptId)
    .maybeSingle();
  if (error) throw promptReadError('Prompt', error);
  const isAllowed = requireOwnership
    ? promptIsOwnedInScope(data, authority)
    : promptIsReadableInScope(data, authority);
  if (!data || !isAllowed) throw new Error('This prompt is no longer available in the current circle.');
  return data;
}

// ─── Row Mappers ────────────────────────────────────────────────────────────

function promptFromRow(row: any): Prompt {
  return {
    id:          row.id,
    ownerId:     row.owner_id,
    circleId:    row.circle_id,
    name:        row.name,
    type:        row.type,
    description: row.description,
    isShared:    row.is_shared ?? false,
    tags:        row.tags ?? [],
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

function versionFromRow(row: any): PromptVersion {
  return {
    id:         row.id,
    promptId:   row.prompt_id,
    version:    row.version,
    content:    row.content,
    config:     row.config ?? {},
    variables:  row.variables ?? [],
    createdAt:  row.created_at,
    createdBy:  row.created_by,
  };
}

function labelFromRow(row: any): PromptLabel {
  return {
    id:         row.id,
    promptId:   row.prompt_id,
    label:      row.label,
    versionId:  row.version_id,
    updatedAt:  row.updated_at,
    updatedBy:  row.updated_by,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function loadPrompts(scope: PromptManagerScope): Promise<Prompt[]> {
  const authority = await capturePromptAuthority(scope);
  const client = promptClient(authority);
  const [personalResult, circleOwnedResult, sharedResult] = await Promise.all([
    client
      .from('prompts')
      .select('*')
      .eq('owner_id', authority.userId)
      .is('circle_id', null)
      .order('updated_at', { ascending: false }),
    client
      .from('prompts')
      .select('*')
      .eq('owner_id', authority.userId)
      .eq('circle_id', authority.circleId)
      .order('updated_at', { ascending: false }),
    client
      .from('prompts')
      .select('*')
      .eq('circle_id', authority.circleId)
      .eq('is_shared', true)
      .neq('owner_id', authority.userId)
      .order('updated_at', { ascending: false }),
  ]);

  if (personalResult.error) throw promptReadError('Personal prompts', personalResult.error);
  if (circleOwnedResult.error) throw promptReadError('Circle prompts', circleOwnedResult.error);
  if (sharedResult.error) throw promptReadError('Shared prompts', sharedResult.error);

  const rows = [
    ...(personalResult.data || []),
    ...(circleOwnedResult.data || []),
    ...(sharedResult.data || []),
  ];
  if (rows.some(row => !promptIsReadableInScope(row, authority))) {
    throw new Error('Prompt data did not match the current user and circle.');
  }
  return rows
    .map(promptFromRow)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function createPrompt(input: {
  name: string;
  type: PromptType;
  circleId?: string;
  description?: string;
  isShared?: boolean;
  tags?: string[];
}, scope: PromptManagerScope): Promise<Prompt | null> {
  try {
    const authority = await capturePromptAuthority(scope);
    const requestedCircleId = input.circleId || null;
    if (requestedCircleId !== null && requestedCircleId !== authority.circleId) return null;
    const { data, error } = await promptClient(authority)
      .from('prompts')
      .insert({
        owner_id:    authority.userId,
        circle_id:   requestedCircleId,
        name:        input.name,
        type:        input.type,
        description: input.description || null,
        is_shared:   input.isShared ?? false,
        tags:        input.tags || [],
      })
      .select()
      .single();

    if (error || !promptIsOwnedInScope(data, authority)) {
      if (error) console.error('createPrompt:', error);
      return null;
    }
    return promptFromRow(data);
  } catch (error) {
    console.error('createPrompt:', error);
    return null;
  }
}

export async function updatePrompt(id: string, updates: Partial<{
  name: string;
  description: string;
  isShared: boolean;
  tags: string[];
}>, scope: PromptManagerScope): Promise<boolean> {
  try {
    const authority = await capturePromptAuthority(scope);
    const client = promptClient(authority);
    const current = await loadPromptScopeRow(client, authority, id, true);
    const row: any = { updated_at: new Date().toISOString() };
    if (updates.name != null) row.name = updates.name;
    if (updates.description != null) row.description = updates.description;
    if (updates.isShared != null) row.is_shared = updates.isShared;
    if (updates.tags != null) row.tags = updates.tags;

    let query = client
      .from('prompts')
      .update(row)
      .eq('id', id)
      .eq('owner_id', authority.userId);
    query = current.circle_id == null
      ? query.is('circle_id', null)
      : query.eq('circle_id', authority.circleId);
    const { data, error } = await query.select('id, owner_id, circle_id').maybeSingle();
    if (error) { console.error('updatePrompt:', error); return false; }
    return data?.id === id && promptIsOwnedInScope(data, authority);
  } catch (error) {
    console.error('updatePrompt:', error);
    return false;
  }
}

export async function deletePrompt(id: string, scope: PromptManagerScope): Promise<boolean> {
  try {
    const authority = await capturePromptAuthority(scope);
    const client = promptClient(authority);
    const current = await loadPromptScopeRow(client, authority, id, true);
    let query = client
      .from('prompts')
      .delete()
      .eq('id', id)
      .eq('owner_id', authority.userId);
    query = current.circle_id == null
      ? query.is('circle_id', null)
      : query.eq('circle_id', authority.circleId);
    const { data, error } = await query.select('id, owner_id, circle_id').maybeSingle();
    if (error) { console.error('deletePrompt:', error); return false; }
    return data?.id === id && promptIsOwnedInScope(data, authority);
  } catch (error) {
    console.error('deletePrompt:', error);
    return false;
  }
}

// ─── Versioning ─────────────────────────────────────────────────────────────

export async function createVersion(
  promptId: string,
  content: string,
  config: PromptConfig = {},
  scope: PromptManagerScope,
): Promise<PromptVersion | null> {
  try {
    const authority = await capturePromptAuthority(scope);
    const client = promptClient(authority);
    const prompt = await loadPromptScopeRow(client, authority, promptId, true);
    const variables = extractVariables(content);
    const { data: versionId, error: createError } = await client.rpc('create_prompt_version', {
      p_prompt_id: promptId,
      p_content:   content,
      p_config:    config,
      p_variables: variables,
    });
    if (createError || typeof versionId !== 'string') {
      if (createError) console.error('createVersion:', createError);
      return null;
    }

    const { data: version, error: versionError } = await client
      .from('prompt_versions')
      .select('*')
      .eq('id', versionId)
      .eq('prompt_id', promptId)
      .maybeSingle();
    if (versionError || !version || version.prompt_id !== promptId) {
      if (versionError) console.error('createVersion receipt:', versionError);
      return null;
    }
    invalidatePromptCache(prompt.name);
    return versionFromRow(version);
  } catch (error) {
    console.error('createVersion:', error);
    return null;
  }
}

async function loadVersionsWithAuthority(
  client: SupabaseClient,
  promptId: string,
): Promise<PromptVersion[]> {
  const { data, error } = await client
    .from('prompt_versions')
    .select('*')
    .eq('prompt_id', promptId)
    .order('version', { ascending: false });
  if (error) throw promptReadError('Prompt versions', error);
  if ((data || []).some(row => row?.prompt_id !== promptId)) {
    throw new Error('Prompt version data did not match the selected prompt.');
  }
  return (data || []).map(versionFromRow);
}

async function loadLabelsWithAuthority(
  client: SupabaseClient,
  promptId: string,
): Promise<PromptLabel[]> {
  const { data, error } = await client
    .from('prompt_labels')
    .select('*')
    .eq('prompt_id', promptId);
  if (error) throw promptReadError('Prompt labels', error);
  if ((data || []).some(row => row?.prompt_id !== promptId)) {
    throw new Error('Prompt label data did not match the selected prompt.');
  }
  return (data || []).map(labelFromRow);
}

export async function loadPromptDetail(
  promptId: string,
  scope: PromptManagerScope,
): Promise<PromptDetailSnapshot> {
  const authority = await capturePromptAuthority(scope);
  const client = promptClient(authority);
  await loadPromptScopeRow(client, authority, promptId, false);
  const [versions, labels] = await Promise.all([
    loadVersionsWithAuthority(client, promptId),
    loadLabelsWithAuthority(client, promptId),
  ]);
  return { versions, labels };
}

export async function loadVersions(
  promptId: string,
  scope: PromptManagerScope,
): Promise<PromptVersion[]> {
  const authority = await capturePromptAuthority(scope);
  const client = promptClient(authority);
  await loadPromptScopeRow(client, authority, promptId, false);
  return loadVersionsWithAuthority(client, promptId);
}

export async function loadLabels(
  promptId: string,
  scope: PromptManagerScope,
): Promise<PromptLabel[]> {
  const authority = await capturePromptAuthority(scope);
  const client = promptClient(authority);
  await loadPromptScopeRow(client, authority, promptId, false);
  return loadLabelsWithAuthority(client, promptId);
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export async function setLabel(
  promptId: string,
  label: string,
  versionId: string,
  scope: PromptManagerScope,
): Promise<PromptLabel | null> {
  try {
    const authority = await capturePromptAuthority(scope);
    const client = promptClient(authority);
    const prompt = await loadPromptScopeRow(client, authority, promptId, true);
    const { data: version, error: versionError } = await client
      .from('prompt_versions')
      .select('id, prompt_id')
      .eq('id', versionId)
      .eq('prompt_id', promptId)
      .maybeSingle();
    if (versionError || version?.prompt_id !== promptId) {
      if (versionError) console.error('setLabel version:', versionError);
      return null;
    }

    const { data, error } = await client
      .from('prompt_labels')
      .upsert({
        prompt_id:  promptId,
        label,
        version_id: versionId,
        updated_by: authority.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'prompt_id,label' })
      .select()
      .single();

    if (
      error
      || !data
      || data.prompt_id !== promptId
      || data.label !== label
      || data.version_id !== versionId
    ) {
      if (error) console.error('setLabel:', error);
      return null;
    }
    invalidatePromptCache(prompt.name);
    return labelFromRow(data);
  } catch (error) {
    console.error('setLabel:', error);
    return null;
  }
}

export async function removeLabel(
  promptId: string,
  label: string,
  scope: PromptManagerScope,
): Promise<boolean> {
  if (label === 'latest') return false;
  try {
    const authority = await capturePromptAuthority(scope);
    const client = promptClient(authority);
    const prompt = await loadPromptScopeRow(client, authority, promptId, true);
    const { data, error } = await client
      .from('prompt_labels')
      .delete()
      .eq('prompt_id', promptId)
      .eq('label', label)
      .select('id, prompt_id, label')
      .maybeSingle();
    if (error) { console.error('removeLabel:', error); return false; }
    const removed = data?.prompt_id === promptId && data?.label === label && Boolean(data?.id);
    if (removed) invalidatePromptCache(prompt.name);
    return removed;
  } catch (error) {
    console.error('removeLabel:', error);
    return false;
  }
}

export async function rollbackToVersion(
  promptId: string,
  versionId: string,
  scope: PromptManagerScope,
): Promise<PromptLabel | null> {
  return setLabel(promptId, 'production', versionId, scope);
}

// ─── Compile (variable substitution) ────────────────────────────────────────

export function extractVariables(text: string): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); vars.push(m[1]); }
  }
  return vars;
}

function substituteVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

export function compile(
  version: PromptVersion,
  promptType: PromptType,
  promptName: string,
  label: string,
  variables: Record<string, string> = {},
): CompiledPrompt {
  if (promptType === 'chat') {
    let messages: ChatMessage[];
    try {
      messages = JSON.parse(version.content);
    } catch {
      messages = [{ role: 'system', content: version.content }];
    }
    messages = messages.map(msg => ({
      ...msg,
      content: substituteVariables(msg.content, variables),
    }));
    return {
      type: 'chat',
      content: messages.map(m => m.content).join('\n'),
      messages,
      config: version.config,
      version: version.version,
      versionId: version.id,
      promptName,
      label,
    };
  }

  return {
    type: 'text',
    content: substituteVariables(version.content, variables),
    config: version.config,
    version: version.version,
    versionId: version.id,
    promptName,
    label,
  };
}

// ─── Client-Side Cache ──────────────────────────────────────────────────────

interface CacheEntry {
  version: PromptVersion;
  prompt: Prompt;
  fetchedAt: number;
}

const promptCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function cacheKey(userId: string, name: string, label: string, circleId?: string): string {
  return `${userId}::${circleId || 'personal'}::${name}::${label}`;
}

export async function getPrompt(
  name: string,
  label: string = 'production',
  variables: Record<string, string> = {},
  circleId?: string,
  opts?: { cacheTtlMs?: number; forceRefresh?: boolean },
): Promise<CompiledPrompt | null> {
  const normalizedCircleId = circleId == null ? null : normalizeScopePart(circleId);
  if (circleId != null && !normalizedCircleId) throw new Error('Prompt circle scope is invalid.');
  const { value: session, error: sessionError } = await safeGetSession();
  if (sessionError) throw new Error(`Prompt access could not be verified: ${sessionError.message}`);
  if (!session?.access_token) return null;

  const userId = session.user.id;
  const { value: verifiedUser, error: verificationError } = await safeGetUserForAccessToken(
    session.access_token,
  );
  if (verificationError || verifiedUser?.id !== userId) {
    throw new Error('Prompt access could not be verified for the current user.');
  }
  const client = getSupabaseClientForAccessToken(session.access_token);
  const key = cacheKey(userId, name, label, normalizedCircleId || undefined);
  const ttl = opts?.cacheTtlMs ?? CACHE_TTL_MS;

  if (!opts?.forceRefresh) {
    const cached = promptCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return compile(cached.version, cached.prompt.type, cached.prompt.name, label, variables);
    }
  }

  const personalRequest = client
    .from('prompts')
    .select('*')
    .eq('name', name)
    .eq('owner_id', userId)
    .is('circle_id', null)
    .order('updated_at', { ascending: false })
    .limit(1);
  const [personalResult, circleOwnedResult, sharedResult] = await Promise.all([
    personalRequest,
    normalizedCircleId
      ? client
        .from('prompts')
        .select('*')
        .eq('name', name)
        .eq('owner_id', userId)
        .eq('circle_id', normalizedCircleId)
        .order('updated_at', { ascending: false })
        .limit(1)
      : Promise.resolve({ data: [], error: null }),
    normalizedCircleId
      ? client
        .from('prompts')
        .select('*')
        .eq('name', name)
        .eq('circle_id', normalizedCircleId)
        .eq('is_shared', true)
        .neq('owner_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (personalResult.error) throw promptReadError('Personal prompt', personalResult.error);
  if (circleOwnedResult.error) throw promptReadError('Circle prompt', circleOwnedResult.error);
  if (sharedResult.error) throw promptReadError('Shared prompt', sharedResult.error);

  const promptRow = circleOwnedResult.data?.[0]
    || sharedResult.data?.[0]
    || personalResult.data?.[0];
  if (!promptRow) return null;
  const promptIsAllowed = normalizedCircleId
    ? promptIsReadableInScope(promptRow, {
      userId,
      circleId: normalizedCircleId,
      accessToken: session.access_token,
    })
    : promptRow.owner_id === userId && promptRow.circle_id == null;
  if (!promptIsAllowed) throw new Error('Prompt data did not match the current user and circle.');

  // Resolve label -> version
  const { data: labelRow, error: labelError } = await client
    .from('prompt_labels')
    .select('version_id')
    .eq('prompt_id', promptRow.id)
    .eq('label', label)
    .maybeSingle();
  if (labelError) throw promptReadError('Prompt label', labelError);

  if (!labelRow) {
    if (label !== 'latest') return getPrompt(name, 'latest', variables, normalizedCircleId || undefined, opts);
    return null;
  }

  const { data: versionRow, error: versionError } = await client
    .from('prompt_versions')
    .select('*')
    .eq('id', labelRow.version_id)
    .eq('prompt_id', promptRow.id)
    .maybeSingle();
  if (versionError) throw promptReadError('Prompt version', versionError);

  if (!versionRow || versionRow.prompt_id !== promptRow.id) return null;

  const parsed = promptFromRow(promptRow);
  const parsedVersion = versionFromRow(versionRow);

  promptCache.set(key, { version: parsedVersion, prompt: parsed, fetchedAt: Date.now() });

  return compile(parsedVersion, parsed.type, parsed.name, label, variables);
}

export function clearPromptCache(): void {
  promptCache.clear();
}

export function invalidatePromptCache(promptName: string): void {
  for (const key of promptCache.keys()) {
    if (key.includes(`::${promptName}::`)) promptCache.delete(key);
  }
}

// ─── A/B Testing ────────────────────────────────────────────────────────────

export interface ABTestConfig {
  promptName: string;
  variants: { label: string; weight: number }[];
}

export function selectVariant(config: ABTestConfig): string {
  const total = config.variants.reduce((s, v) => s + v.weight, 0);
  let rand = Math.random() * total;
  for (const v of config.variants) {
    rand -= v.weight;
    if (rand <= 0) return v.label;
  }
  return config.variants[config.variants.length - 1].label;
}

export async function getPromptAB(
  config: ABTestConfig,
  variables: Record<string, string> = {},
  circleId?: string,
): Promise<{ compiled: CompiledPrompt; selectedLabel: string } | null> {
  const selectedLabel = selectVariant(config);
  const compiled = await getPrompt(config.promptName, selectedLabel, variables, circleId);
  if (!compiled) return null;
  return { compiled, selectedLabel };
}

// ─── React Hooks ────────────────────────────────────────────────────────────

interface PromptListHookState {
  scopeKey: string;
  prompts: Prompt[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

interface PromptDetailHookState extends PromptDetailSnapshot {
  scopeKey: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

export function usePrompts(circleId: string, userId: string) {
  const scope = { circleId, userId };
  const scopeKey = promptManagerScopeKey(scope);
  const generationRef = useRef(0);
  const [state, setState] = useState<PromptListHookState>({
    scopeKey,
    prompts: [],
    loading: true,
    refreshing: false,
    error: null,
  });

  const refresh = useCallback(async (): Promise<boolean> => {
    const generation = ++generationRef.current;
    const capturedScope = { circleId, userId };
    const capturedScopeKey = scopeKey;
    setState(previous => previous.scopeKey === capturedScopeKey
      ? {
        ...previous,
        loading: previous.prompts.length === 0,
        refreshing: previous.prompts.length > 0,
        error: null,
      }
      : {
        scopeKey: capturedScopeKey,
        prompts: [],
        loading: true,
        refreshing: false,
        error: null,
      });
    try {
      const prompts = await loadPrompts(capturedScope);
      if (generation !== generationRef.current) return false;
      setState({
        scopeKey: capturedScopeKey,
        prompts,
        loading: false,
        refreshing: false,
        error: null,
      });
      return true;
    } catch (error) {
      if (generation !== generationRef.current) return false;
      const message = error instanceof Error ? error.message : 'Prompts could not be loaded.';
      setState(previous => previous.scopeKey === capturedScopeKey
        ? { ...previous, loading: false, refreshing: false, error: message }
        : {
          scopeKey: capturedScopeKey,
          prompts: [],
          loading: false,
          refreshing: false,
          error: message,
        });
      return false;
    }
  }, [circleId, scopeKey, userId]);

  useEffect(() => {
    void refresh();
    return () => { generationRef.current += 1; };
  }, [refresh]);

  const visible = state.scopeKey === scopeKey
    ? state
    : { scopeKey, prompts: [], loading: true, refreshing: false, error: null };
  return { ...visible, refresh };
}

export function usePromptDetail(
  promptId: string | null,
  circleId: string,
  userId: string,
) {
  const scope = { circleId, userId };
  const scopeKey = promptManagerScopeKey(scope, promptId);
  const generationRef = useRef(0);
  const [state, setState] = useState<PromptDetailHookState>({
    scopeKey,
    versions: [],
    labels: [],
    loading: Boolean(promptId),
    refreshing: false,
    error: null,
  });

  const refresh = useCallback(async (): Promise<boolean> => {
    const generation = ++generationRef.current;
    const capturedPromptId = promptId;
    const capturedScope = { circleId, userId };
    const capturedScopeKey = scopeKey;
    if (!capturedPromptId) {
      setState({
        scopeKey: capturedScopeKey,
        versions: [],
        labels: [],
        loading: false,
        refreshing: false,
        error: null,
      });
      return true;
    }
    setState(previous => previous.scopeKey === capturedScopeKey
      ? {
        ...previous,
        loading: previous.versions.length === 0 && previous.labels.length === 0,
        refreshing: previous.versions.length > 0 || previous.labels.length > 0,
        error: null,
      }
      : {
        scopeKey: capturedScopeKey,
        versions: [],
        labels: [],
        loading: true,
        refreshing: false,
        error: null,
      });
    try {
      const snapshot = await loadPromptDetail(capturedPromptId, capturedScope);
      if (generation !== generationRef.current) return false;
      setState({
        scopeKey: capturedScopeKey,
        ...snapshot,
        loading: false,
        refreshing: false,
        error: null,
      });
      return true;
    } catch (error) {
      if (generation !== generationRef.current) return false;
      const message = error instanceof Error ? error.message : 'Prompt details could not be loaded.';
      setState(previous => previous.scopeKey === capturedScopeKey
        ? { ...previous, loading: false, refreshing: false, error: message }
        : {
          scopeKey: capturedScopeKey,
          versions: [],
          labels: [],
          loading: false,
          refreshing: false,
          error: message,
        });
      return false;
    }
  }, [circleId, promptId, scopeKey, userId]);

  useEffect(() => {
    void refresh();
    return () => { generationRef.current += 1; };
  }, [refresh]);

  const visible = state.scopeKey === scopeKey
    ? state
    : {
      scopeKey,
      versions: [],
      labels: [],
      loading: Boolean(promptId),
      refreshing: false,
      error: null,
    };
  return { ...visible, refresh };
}
