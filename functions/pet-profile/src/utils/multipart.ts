function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true';
}

function isNullToken(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'null';
}

function normalizeNumber(value: unknown): number | string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : String(value);
}

function normalizeNullableNumber(value: unknown): number | string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '' || isNullToken(value)) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : String(value);
}

function normalizeNullableNumberNullTokenOnly(value: unknown): number | string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || isNullToken(value)) {
    return null;
  }
  if (value === '') {
    return undefined;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : String(value);
}

function normalizeNullableDate(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '' || isNullToken(value)) {
    return null;
  }
  return String(value);
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
    ...(typeof rawFields.breedimage === 'string' && rawFields.breedimage.trim()
      ? { breedimage: [rawFields.breedimage] }
      : {}),
  };
}

export function normalizePatchMultipartBody(
  rawFields: Record<string, unknown>
): Record<string, unknown> {
  const normalized = normalizeMultipartBody(rawFields);
  return {
    ...normalized,
    weight: normalizeNullableNumber(rawFields.weight),
    ownerContact2: normalizeNullableNumberNullTokenOnly(rawFields.ownerContact2),
    motherDOB: normalizeNullableDate(rawFields.motherDOB),
    motherParity: normalizeNullableNumberNullTokenOnly(rawFields.motherParity),
    fatherDOB: normalizeNullableDate(rawFields.fatherDOB),
  };
}
