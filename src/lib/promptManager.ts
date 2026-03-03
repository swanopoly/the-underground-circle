// ─── Prompt Manager ─────────────────────────────────────────────────────────
// Langfuse-style prompt management: versioning, labels, compile, caching, A/B
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

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

export async function loadPrompts(circleId?: string): Promise<Prompt[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: own } = await supabase
    .from('prompts')
    .select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });

  let shared: Prompt[] = [];
  if (circleId) {
    const { data } = await supabase
      .from('prompts')
      .select('*')
      .eq('circle_id', circleId)
      .eq('is_shared', true)
      .neq('owner_id', user.id)
      .order('updated_at', { ascending: false });
    shared = (data || []).map(promptFromRow);
  }

  return [...(own || []).map(promptFromRow), ...shared];
}

export async function createPrompt(input: {
  name: string;
  type: PromptType;
  circleId?: string;
  description?: string;
  isShared?: boolean;
  tags?: string[];
}): Promise<Prompt | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('prompts')
    .insert({
      owner_id:    user.id,
      circle_id:   input.circleId || null,
      name:        input.name,
      type:        input.type,
      description: input.description || null,
      is_shared:   input.isShared ?? false,
      tags:        input.tags || [],
    })
    .select()
    .single();

  if (error) { console.error('createPrompt:', error); return null; }
  return promptFromRow(data);
}

export async function updatePrompt(id: string, updates: Partial<{
  name: string;
  description: string;
  isShared: boolean;
  tags: string[];
}>): Promise<boolean> {
  const row: any = { updated_at: new Date().toISOString() };
  if (updates.name != null) row.name = updates.name;
  if (updates.description != null) row.description = updates.description;
  if (updates.isShared != null) row.is_shared = updates.isShared;
  if (updates.tags != null) row.tags = updates.tags;

  const { error } = await supabase
    .from('prompts')
    .update(row)
    .eq('id', id);

  if (error) { console.error('updatePrompt:', error); return false; }
  return true;
}

export async function deletePrompt(id: string): Promise<boolean> {
  const { error } = await supabase.from('prompts').delete().eq('id', id);
  if (error) { console.error('deletePrompt:', error); return false; }
  return true;
}

// ─── Versioning ─────────────────────────────────────────────────────────────

export async function createVersion(
  promptId: string,
  content: string,
  config: PromptConfig = {},
): Promise<PromptVersion | null> {
  const variables = extractVariables(content);

  const { data, error } = await supabase.rpc('create_prompt_version', {
    p_prompt_id: promptId,
    p_content:   content,
    p_config:    config,
    p_variables: variables,
  });

  if (error) { console.error('createVersion:', error); return null; }

  // Fetch the created version
  const { data: version } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('id', data)
    .single();

  if (!version) return null;

  // Bust cache for this prompt
  const { data: prompt } = await supabase
    .from('prompts')
    .select('name')
    .eq('id', promptId)
    .single();
  if (prompt) invalidatePromptCache(prompt.name);

  return versionFromRow(version);
}

export async function loadVersions(promptId: string): Promise<PromptVersion[]> {
  const { data, error } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('prompt_id', promptId)
    .order('version', { ascending: false });

  if (error) return [];
  return (data || []).map(versionFromRow);
}

export async function loadLabels(promptId: string): Promise<PromptLabel[]> {
  const { data, error } = await supabase
    .from('prompt_labels')
    .select('*')
    .eq('prompt_id', promptId);

  if (error) return [];
  return (data || []).map(labelFromRow);
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export async function setLabel(
  promptId: string,
  label: string,
  versionId: string,
): Promise<PromptLabel | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('prompt_labels')
    .upsert({
      prompt_id:  promptId,
      label,
      version_id: versionId,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'prompt_id,label' })
    .select()
    .single();

  if (error) { console.error('setLabel:', error); return null; }

  // Bust cache
  const { data: prompt } = await supabase
    .from('prompts')
    .select('name')
    .eq('id', promptId)
    .single();
  if (prompt) invalidatePromptCache(prompt.name);

  return labelFromRow(data);
}

export async function removeLabel(promptId: string, label: string): Promise<boolean> {
  if (label === 'latest') return false;

  const { error } = await supabase
    .from('prompt_labels')
    .delete()
    .eq('prompt_id', promptId)
    .eq('label', label);

  return !error;
}

export async function rollbackToVersion(
  promptId: string,
  versionId: string,
): Promise<PromptLabel | null> {
  return setLabel(promptId, 'production', versionId);
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

function cacheKey(name: string, label: string, circleId?: string): string {
  return `${circleId || 'personal'}::${name}::${label}`;
}

export async function getPrompt(
  name: string,
  label: string = 'production',
  variables: Record<string, string> = {},
  circleId?: string,
  opts?: { cacheTtlMs?: number; forceRefresh?: boolean },
): Promise<CompiledPrompt | null> {
  const key = cacheKey(name, label, circleId);
  const ttl = opts?.cacheTtlMs ?? CACHE_TTL_MS;

  if (!opts?.forceRefresh) {
    const cached = promptCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return compile(cached.version, cached.prompt.type, cached.prompt.name, label, variables);
    }
  }

  // Fetch prompt by name
  let query = supabase.from('prompts').select('*').eq('name', name);
  if (circleId) {
    query = query.or(`circle_id.eq.${circleId},circle_id.is.null`);
  }
  const { data: prompts } = await query
    .order('circle_id', { ascending: false, nullsFirst: false })
    .limit(1);

  const promptRow = prompts?.[0];
  if (!promptRow) return null;

  // Resolve label -> version
  const { data: labelRow } = await supabase
    .from('prompt_labels')
    .select('version_id')
    .eq('prompt_id', promptRow.id)
    .eq('label', label)
    .single();

  if (!labelRow) {
    if (label !== 'latest') return getPrompt(name, 'latest', variables, circleId, opts);
    return null;
  }

  const { data: versionRow } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('id', labelRow.version_id)
    .single();

  if (!versionRow) return null;

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

export function usePrompts(circleId?: string) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await loadPrompts(circleId);
    setPrompts(data);
    setLoading(false);
  }, [circleId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { prompts, loading, refresh };
}

export function usePromptDetail(promptId: string | null) {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [labels, setLabels] = useState<PromptLabel[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!promptId) return;
    setLoading(true);
    const [v, l] = await Promise.all([
      loadVersions(promptId),
      loadLabels(promptId),
    ]);
    setVersions(v);
    setLabels(l);
    setLoading(false);
  }, [promptId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { versions, labels, loading, refresh };
}
