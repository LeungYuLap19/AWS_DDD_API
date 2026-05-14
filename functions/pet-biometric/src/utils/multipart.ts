function normalizeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalizes multipart register fields for face-ID routes. Register currently
 * only accepts enum/string fields, so the raw field map is returned unchanged.
 */
export function normalizeRegisterMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...rawFields,
  };
}

/**
 * Normalizes multipart verify fields so numeric thresholds are coerced before
 * Zod validation runs.
 */
export function normalizeVerifyMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...rawFields,
    threshold: normalizeNumber(rawFields.threshold),
  };
}
