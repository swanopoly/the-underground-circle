import {
  extractDirectLocalImageFormatConversionTask,
  type DirectLocalImageFormatConversionTask,
} from './computerTaskPlanner';

/**
 * Legacy bridge shapes remain exported while callers migrate, but the direct
 * runtime never invokes them. Image conversion is a filesystem mutation and
 * may execute only inside an authenticated typed OpenSwan provider call.
 */
export interface DirectImageConversionProof {
  sourcePath: string;
  outputPath: string;
  format: string;
  bytes: number;
}

export type DirectImageConversionBridge = (
  request: DirectLocalImageFormatConversionTask,
) => Promise<{
  ok: boolean;
  data?: DirectImageConversionProof;
  error?: string;
  errorCode?: string;
}>;

export interface DirectImageConversionBridgeTools {
  convertImage: DirectImageConversionBridge;
  statFile?: (path: string) => Promise<unknown>;
  searchFiles?: (
    rootPath: string,
    query: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export const DIRECT_IMAGE_CONVERSION_REQUIRED_CONTEXT = [
  'authenticated_user_id',
  'circle_id',
  'persisted_agent_run_id',
  'provider_tool_name',
  'provider_tool_use_id',
  'tool_iteration',
  'exact_openswan_runtime_approval',
  'fresh_file_search',
  'fresh_file_stat',
  'runtime_mutation_dispatch_receipt',
  'runtime_result_proof_identity',
] as const;

export type DirectImageConversionRuntimeRequirement =
  typeof DIRECT_IMAGE_CONVERSION_REQUIRED_CONTEXT[number];

export interface DirectImageConversionRuntimeHandoff {
  kind: 'openswan_typed_tool';
  tool: 'desktop.convert_image';
  sourceLane: 'direct_image_conversion_runtime';
  reasonCode: 'sealed_runtime_context_required';
  executable: false;
  bridgeCalled: false;
  mutationDispatched: false;
  completionClaimed: false;
  carriesRawPath: false;
  carriesRawApp: false;
  carriesRawValue: false;
  carriesSecret: false;
  carriesIdentity: false;
  carriesApproval: false;
  carriesReceipt: false;
  carriesProof: false;
  requiredContext: DirectImageConversionRuntimeRequirement[];
  message: string;
}

export interface DirectImageConversionRuntimeOutcome {
  handled: boolean;
  status: 'handoff' | 'failed';
  message: string;
  warnings: string[];
  data?: {
    runtimeHandoff: DirectImageConversionRuntimeHandoff;
  };
}

export function buildDirectImageConversionRuntimeHandoff(): DirectImageConversionRuntimeHandoff {
  return {
    kind: 'openswan_typed_tool',
    tool: 'desktop.convert_image',
    sourceLane: 'direct_image_conversion_runtime',
    reasonCode: 'sealed_runtime_context_required',
    executable: false,
    bridgeCalled: false,
    mutationDispatched: false,
    completionClaimed: false,
    carriesRawPath: false,
    carriesRawApp: false,
    carriesRawValue: false,
    carriesSecret: false,
    carriesIdentity: false,
    carriesApproval: false,
    carriesReceipt: false,
    carriesProof: false,
    requiredContext: [...DIRECT_IMAGE_CONVERSION_REQUIRED_CONTEXT],
    message: 'The image conversion was not executed here. Continue through the authenticated OpenSwan typed runtime after it seals the required context.',
  };
}

export async function executeDirectImageConversionRequest(
  task: string,
  bridge?: DirectImageConversionBridge | DirectImageConversionBridgeTools,
): Promise<DirectImageConversionRuntimeOutcome> {
  // Parsing is classification-only. The extracted source and target format are
  // deliberately never returned, logged, or copied into handoff metadata.
  const request = extractDirectLocalImageFormatConversionTask(task);
  if (!request) {
    return {
      handled: false,
      status: 'failed',
      message: 'This is not a bounded local image conversion request.',
      warnings: [],
    };
  }

  // Compatibility-only injection seam. Neither convertImage nor its optional
  // stat/search helpers may run outside authenticated provider-call identity.
  void bridge;
  return {
    handled: true,
    status: 'handoff',
    message: 'The image conversion was not executed directly. It must continue through the authenticated OpenSwan typed runtime.',
    warnings: ['Direct image conversion dispatch is sealed behind the typed runtime.'],
    data: {
      runtimeHandoff: buildDirectImageConversionRuntimeHandoff(),
    },
  };
}
