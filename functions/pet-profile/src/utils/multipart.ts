export type ParsedMultipartForm = Record<string, unknown> & {
  files?: Array<{ content?: Buffer; filename?: string }>;
};

export function normalizeMultipartBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return String(value).toLowerCase() === 'true';
}

export function normalizeMultipartNumber(value: unknown): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  return Number(value);
}

export function normalizeMultipartBody(rawFields: Record<string, unknown>): Record<string, unknown> {
  return {
    ...rawFields,
    weight: normalizeMultipartNumber(rawFields.weight),
    sterilization: normalizeMultipartBoolean(rawFields.sterilization),
    ownerContact1: normalizeMultipartNumber(rawFields.ownerContact1),
    ownerContact2: normalizeMultipartNumber(rawFields.ownerContact2),
    contact1Show: normalizeMultipartBoolean(rawFields.contact1Show),
    contact2Show: normalizeMultipartBoolean(rawFields.contact2Show),
    breedimage:
      typeof rawFields.breedimage === 'string' && rawFields.breedimage.trim()
        ? [rawFields.breedimage]
        : undefined,
  };
}
