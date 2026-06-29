import {
  extractDirectLocalImageFormatConversionTask,
  type DirectLocalImageFormatConversionTask,
} from './computerTaskPlanner';
import type { DesktopResult } from './desktopBridgeProtocol';

export interface DirectImageConversionProof {
  sourcePath: string;
  outputPath: string;
  format: string;
  bytes: number;
}

export type DirectImageConversionBridge = (
  request: DirectLocalImageFormatConversionTask,
) => Promise<DesktopResult<DirectImageConversionProof>>;

export interface DirectImageConversionRuntimeOutcome {
  handled: boolean;
  status: 'completed' | 'failed';
  message: string;
  warnings: string[];
  data?: {
    request: DirectLocalImageFormatConversionTask;
    proof?: DirectImageConversionProof;
    proofSignals?: string[];
  };
}

function buildDirectImageConversionFailureMessage(
  request: DirectLocalImageFormatConversionTask,
  result: DesktopResult<DirectImageConversionProof>,
): string {
  switch (result.errorCode) {
    case 'bridge_offline':
    case 'not_paired':
    case 'stale_bridge':
    case 'file_access_not_granted':
    case 'missing_permission':
    case 'permission_denied':
      return 'I could not access the local image tool yet. Reconnect the desktop bridge, approve the requested folder, then try again.';
    case 'file_not_found':
    case 'path_not_found':
      return 'I could not find that image. Check the filename or send the exact file path, then try again.';
    case 'ambiguous_file_match':
      return 'I found more than one matching image. Send the exact file path and I will convert that one.';
    case 'output_conflict':
      return 'A converted image with that name already exists. I stopped instead of overwriting it. Choose a different output name or move the existing file, then try again.';
    case 'path_not_allowed':
      return 'I could not save to that location with the current folder access. Approve that folder or choose a different destination.';
    case 'invalid_input':
      return `I could not understand which image to save as ${request.format.toUpperCase()}. Send the exact file path and format, then try again.`;
    default:
      return `I could not save the image as ${request.format.toUpperCase()}. Check the file and try again.`;
  }
}

function normalizeProof(value: DirectImageConversionProof | undefined | null): DirectImageConversionProof | null {
  const sourcePath = String(value?.sourcePath || '').trim();
  const outputPath = String(value?.outputPath || '').trim();
  const format = String(value?.format || '').trim().toLowerCase();
  const bytes = Number(value?.bytes ?? 0);
  if (!sourcePath || !outputPath || !format || !Number.isFinite(bytes) || bytes <= 0) return null;
  return { sourcePath, outputPath, format, bytes };
}

export async function executeDirectImageConversionRequest(
  task: string,
  convertImage: DirectImageConversionBridge,
): Promise<DirectImageConversionRuntimeOutcome> {
  const request = extractDirectLocalImageFormatConversionTask(task);
  if (!request) {
    return {
      handled: false,
      status: 'failed',
      message: 'This is not a bounded local image conversion request.',
      warnings: [],
    };
  }

  let result: DesktopResult<DirectImageConversionProof>;
  try {
    result = await convertImage(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'unknown error');
    result = {
      ok: false,
      error: detail,
      errorCode: 'bridge_offline',
    };
  }
  if (!result.ok) {
    return {
      handled: true,
      status: 'failed',
      message: buildDirectImageConversionFailureMessage(request, result),
      warnings: [`desktop.convert_image failed${result.errorCode ? ` (${result.errorCode})` : ''}${result.error ? `: ${result.error}` : ''}`],
      data: { request },
    };
  }

  const proof = normalizeProof(result.data);
  if (!proof) {
    return {
      handled: true,
      status: 'failed',
      message: 'The image tool did not return output proof, so I stopped instead of saying it was done.',
      warnings: ['desktop.convert_image missing output proof'],
      data: { request },
    };
  }

  return {
    handled: true,
    status: 'completed',
    message: `Saved ${proof.outputPath} (${proof.format}, ${proof.bytes} bytes).`,
    warnings: [],
    data: {
      request,
      proof,
      proofSignals: [
        'desktop.convert_image',
        `outputPath:${proof.outputPath}`,
        `bytes:${proof.bytes}`,
      ],
    },
  };
}
