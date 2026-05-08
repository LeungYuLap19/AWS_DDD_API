function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true';
}

function normalizeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...rawFields,
    weight: normalizeNumber(rawFields.weight),
    sterilization: normalizeBoolean(rawFields.sterilization),
    ownerContact1: normalizeNumber(rawFields.ownerContact1),
    ownerContact2: normalizeNumber(rawFields.ownerContact2),
    contact1Show: normalizeBoolean(rawFields.contact1Show),
    contact2Show: normalizeBoolean(rawFields.contact2Show),
    breedimage:
      typeof rawFields.breedimage === 'string' && rawFields.breedimage.trim()
        ? [rawFields.breedimage]
        : undefined,
  };
}
