function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true';
}

function normalizeNumber(value: unknown): number | string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : String(value);
}

/**
 * Normalizes multipart form fields for lost-pet reports so numeric/boolean
 * fields match the downstream Zod schema expectations.
 */
export function normalizeLostMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...rawFields,
    weight: normalizeNumber(rawFields.weight),
    sterilization: normalizeBoolean(rawFields.sterilization),
    ownerContact1: normalizeNumber(rawFields.ownerContact1),
  };
}

/**
 * Normalizes multipart form fields for found-pet reports so numeric contact
 * fields match the downstream Zod schema expectations.
 */
export function normalizeFoundMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...rawFields,
    ownerContact1: normalizeNumber(rawFields.ownerContact1),
  };
}
