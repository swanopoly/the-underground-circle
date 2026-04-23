import { supabase } from './supabase';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';

export interface HfTool {
  id: string;
  circle_id: string;
  space_id: string;
  space_name: string;
  api_url?: string;
  input_schema: any;
  output_schema: any;
  created_at: string;
}

// Supported HF inference tasks (synced with hf-proxy edge function)
export type HfTask =
  | 'chat'
  | 'text-generation'
  | 'text-to-image'
  | 'summarization'
  | 'sentiment'
  | 'text-classification'
  | 'zero-shot-classification'
  | 'question-answering'
  | 'image-to-text'
  | 'embeddings'
  | 'feature-extraction'
  | 'translation'
  | 'speech-to-text'
  | 'text-to-speech';

// Task metadata for UI rendering
export const HF_TASK_META: Record<HfTask, { label: string; icon: string; description: string }> = {
  'chat':                    { label: 'Chat',              icon: '💬', description: 'Chat with open-source LLMs' },
  'text-generation':         { label: 'Text Gen',          icon: '📝', description: 'Generate text completions' },
  'text-to-image':           { label: 'Image Gen',         icon: '🎨', description: 'Generate images from text' },
  'summarization':           { label: 'Summarize',         icon: '📋', description: 'Summarize long text' },
  'sentiment':               { label: 'Sentiment',         icon: '😊', description: 'Analyze text sentiment' },
  'text-classification':     { label: 'Classify',          icon: '🏷️', description: 'Categorize text' },
  'zero-shot-classification': { label: 'Zero-Shot',        icon: '🎯', description: 'Classify with custom labels' },
  'question-answering':      { label: 'Q&A',              icon: '❓', description: 'Answer questions from context' },
  'image-to-text':           { label: 'Image→Text',       icon: '👁️', description: 'OCR / image captioning' },
  'embeddings':              { label: 'Embeddings',        icon: '🧮', description: 'Generate text embeddings' },
  'feature-extraction':      { label: 'Features',          icon: '🔢', description: 'Extract feature vectors' },
  'translation':             { label: 'Translate',         icon: '🌍', description: 'Translate between languages' },
  'speech-to-text':          { label: 'Speech→Text',      icon: '🎤', description: 'Transcribe audio' },
  'text-to-speech':          { label: 'Text→Speech',      icon: '🔊', description: 'Generate speech audio' },
};

/** Fetch all HF tools for a circle */
export async function listHfTools(circleId: string): Promise<HfTool[]> {
  const { data, error } = await supabase
    .from('circle_hf_tools')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching HF tools:', error);
    return [];
  }
  return data || [];
}

/** Invoke a saved HF tool by ID */
export async function invokeHfTool(toolId: string, inputs: any): Promise<any> {
  if (shouldBlockExternalAiProvider('huggingface')) {
    throw new Error(getStrictLocalAiModeMessage('huggingface'));
  }
  const { data, error } = await supabase.functions.invoke('hf-proxy', {
    body: { toolId, inputs },
  });
  if (error) throw error;
  return data;
}

/** Run a direct HF inference task (no saved tool required) */
export async function invokeHfInference(
  task: HfTask,
  inputs: any,
  options?: { model?: string; max_tokens?: number; max_length?: number; src_lang?: string; tgt_lang?: string },
): Promise<any> {
  if (shouldBlockExternalAiProvider('huggingface')) {
    throw new Error(getStrictLocalAiModeMessage('huggingface'));
  }
  const { data, error } = await supabase.functions.invoke('hf-proxy', {
    body: { task, inputs, model: options?.model, options },
  });
  if (error) throw error;
  return data;
}

/** Fetch HF Space metadata from Hub API (public, no auth) */
export async function fetchHfSpaceMetadata(spaceId: string): Promise<any> {
  try {
    const response = await fetch(`https://huggingface.co/api/spaces/${spaceId}`);
    if (!response.ok) throw new Error('Failed to fetch space metadata');
    return await response.json();
  } catch (e) {
    console.error('Error fetching HF metadata:', e);
    return null;
  }
}

/** Delete a HF tool from a circle */
export async function deleteHfTool(toolId: string): Promise<boolean> {
  const { error } = await supabase
    .from('circle_hf_tools')
    .delete()
    .eq('id', toolId);

  if (error) {
    console.error('Error deleting HF tool:', error);
    return false;
  }
  return true;
}
