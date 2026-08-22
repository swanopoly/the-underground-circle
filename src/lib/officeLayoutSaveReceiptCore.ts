export interface OfficeLayoutSaveReceiptResult {
  ok: boolean;
  conflict?: boolean;
  version: number;
  error?: string;
}

/** Interpret the exact receipt returned by save_office_layout_v2. */
export function interpretOfficeLayoutSaveReceipt(
  input: unknown,
  requestedVersion: number,
): OfficeLayoutSaveReceiptResult {
  const normalizedVersion = Number.isSafeInteger(requestedVersion) && requestedVersion > 0
    ? requestedVersion
    : 0;
  const response = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const acceptedVersion = typeof response.layoutVersion === 'number'
    && Number.isSafeInteger(response.layoutVersion)
    && response.layoutVersion > 0
    ? response.layoutVersion
    : 0;
  if (!normalizedVersion) {
    return {
      ok: false,
      version: 0,
      error: 'The Office layout save used an invalid version and was not verified.',
    };
  }
  if (response.accepted === false && acceptedVersion) {
    return {
      ok: false,
      conflict: true,
      version: acceptedVersion,
      error: 'A newer Office layout is already saved. Reload before retrying this edit.',
    };
  }
  if (response.accepted !== true || acceptedVersion !== normalizedVersion) {
    return {
      ok: false,
      version: acceptedVersion || normalizedVersion,
      error: 'The Office server did not verify this exact layout save. Retry after a fresh layout check.',
    };
  }
  return { ok: true, version: acceptedVersion };
}
