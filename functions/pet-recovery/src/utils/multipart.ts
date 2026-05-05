export type ParsedMultipartFile = {
  content?: Buffer;
  filename?: string;
};

export type ParsedMultipartForm = Record<string, unknown> & {
  files?: ParsedMultipartFile[];
};

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

export function normalizeFoundMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...rawFields,
    ownerContact1: normalizeNumber(rawFields.ownerContact1),
  };
}
