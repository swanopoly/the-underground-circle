import { supabase } from './supabase';
import { getCircleIntegration } from './circleIntegrations';
import type { ChatAttachment } from './chatMedia';

export interface FigmaReference {
  id: string;
  source: 'link' | 'attachment' | 'integration';
  url?: string;
  fileKey?: string;
  nodeId?: string | null;
  title: string;
  summary: string;
}

const FIGMA_LINK_RE = /https:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/[^?\s#]+)?(?:\?[^#\s]*)?(?:#([^\s]+))?/gi;

function decodeNodeId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/node-id=([^&]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}

export function extractFigmaLinks(message: string): Array<{ url: string; fileKey: string; nodeId: string | null }> {
  const out: Array<{ url: string; fileKey: string; nodeId: string | null }> = [];
  for (const match of message.matchAll(FIGMA_LINK_RE)) {
    const url = match[0];
    const fileKey = match[1];
    const nodeId = decodeNodeId(url.split('?')[1] || match[2] || null);
    out.push({ url, fileKey, nodeId });
  }
  return out;
}

async function getFigmaApiToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_user_api_key', {
    p_user_id: userId,
    p_provider: 'figma',
    p_label: 'oauth',
  });
  if (error) return null;
  if (Array.isArray(data) && data[0]?.api_key) return data[0].api_key;
  if (data && typeof data === 'object' && 'api_key' in data && (data as any).api_key) return (data as any).api_key;
  return null;
}

async function fetchFigmaFileSummary(token: string, fileKey: string, nodeId?: string | null): Promise<FigmaReference | null> {
  try {
    const params = new URLSearchParams();
    params.set('depth', nodeId ? '3' : '2');
    if (nodeId) params.set('ids', nodeId);
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?${params.toString()}`, {
      headers: {
        'X-Figma-Token': token,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const root = nodeId ? data.nodes?.[nodeId]?.document : data.document;
    const children = Array.isArray(root?.children) ? root.children.slice(0, 8) : [];
    const childSummary = children
      .map((child: any) => `${child.name} (${child.type})`)
      .join(', ');
    const title = [data.name, root?.name].filter(Boolean).join(' — ') || 'Figma file';
    const summaryParts = [
      `File: ${data.name || 'Untitled Figma file'}`,
      root?.name ? `Focus node: ${root.name}` : '',
      root?.type ? `Node type: ${root.type}` : '',
      childSummary ? `Visible child layers: ${childSummary}` : '',
      data.lastModified ? `Last modified: ${data.lastModified}` : '',
    ].filter(Boolean);
    return {
      id: `figma:${fileKey}:${nodeId || 'root'}`,
      source: 'link',
      fileKey,
      nodeId: nodeId || null,
      title,
      summary: summaryParts.join('\n'),
    };
  } catch {
    return null;
  }
}

function buildAttachmentRefs(attachments: ChatAttachment[]): FigmaReference[] {
  return attachments
    .filter((attachment) => attachment.isFigma)
    .map((attachment) => ({
      id: `figma-attachment:${attachment.id}`,
      source: 'attachment' as const,
      title: attachment.name,
      summary: [
        `Attached Figma-related file: ${attachment.name}`,
        `Mime type: ${attachment.mimeType}`,
        attachment.extractText ? `Extracted text:\n${attachment.extractText.slice(0, 1500)}` : '',
      ].filter(Boolean).join('\n'),
    }));
}

export async function resolveFigmaReferences(opts: {
  message: string;
  attachments: ChatAttachment[];
  circleId: string;
  userId: string;
}): Promise<FigmaReference[]> {
  const { message, attachments, circleId, userId } = opts;
  const refs: FigmaReference[] = [];

  refs.push(...buildAttachmentRefs(attachments));

  const links = extractFigmaLinks(message);
  if (links.length > 0) {
    const token = await getFigmaApiToken(userId);
    if (token) {
      const fetched = await Promise.all(links.slice(0, 3).map((link) => fetchFigmaFileSummary(token, link.fileKey, link.nodeId)));
      for (let i = 0; i < links.length; i += 1) {
        const fetchedRef = fetched[i];
        if (fetchedRef) {
          refs.push({ ...fetchedRef, url: links[i].url });
        } else {
          refs.push({
            id: `figma:${links[i].fileKey}:${links[i].nodeId || 'root'}`,
            source: 'link',
            url: links[i].url,
            fileKey: links[i].fileKey,
            nodeId: links[i].nodeId,
            title: 'Figma link',
            summary: `Linked Figma file ${links[i].fileKey}${links[i].nodeId ? `, node ${links[i].nodeId}` : ''}.`,
          });
        }
      }
    } else {
      refs.push(...links.map((link) => ({
        id: `figma:${link.fileKey}:${link.nodeId || 'root'}`,
        source: 'link' as const,
        url: link.url,
        fileKey: link.fileKey,
        nodeId: link.nodeId,
        title: 'Figma link',
        summary: `Linked Figma file ${link.fileKey}${link.nodeId ? `, node ${link.nodeId}` : ''}. Connect Figma for deeper design metadata.`,
      })));
    }
  }

  if (refs.length === 0) {
    const integration = await getCircleIntegration(circleId, 'figma');
    if (integration) {
      const workspaceName = String(integration.metadata?.workspaceName || integration.display_name || 'Connected Figma workspace');
      refs.push({
        id: `figma-integration:${workspaceName}`,
        source: 'integration',
        title: workspaceName,
        summary: `A Figma integration is connected for this circle (${workspaceName}). If design assumptions are needed, prefer a polished, production-ready HTML implementation and mention when exact frame details were not provided.`,
      });
    }
  }

  return refs;
}

export function buildFigmaPromptFromReferences(refs: FigmaReference[], selectedRefId?: string | null): string {
  if (refs.length === 0) return '';

  const orderedRefs = selectedRefId
    ? [
        ...refs.filter((ref) => ref.id === selectedRefId),
        ...refs.filter((ref) => ref.id !== selectedRefId),
      ]
    : refs;

  return [
    '## Figma design context',
    ...orderedRefs.map((ref, index) => {
      const header = `${index + 1}. ${ref.title}${ref.url ? ` — ${ref.url}` : ''}`;
      return `${header}\n${ref.summary}`;
    }),
    selectedRefId ? 'The first Figma reference above is the currently selected frame/source. Prioritize it over the others when translating the design to HTML.' : '',
    'Treat the Figma context as the visual source of truth. When building a webpage, return a faithful single-file HTML implementation with strong layout hierarchy, spacing, sections, and component structure.',
  ].join('\n\n');
}

export async function buildFigmaPromptContext(opts: {
  message: string;
  attachments: ChatAttachment[];
  circleId: string;
  userId: string;
  selectedRefId?: string | null;
}): Promise<string> {
  const refs = await resolveFigmaReferences(opts);
  return buildFigmaPromptFromReferences(refs, opts.selectedRefId);
}
