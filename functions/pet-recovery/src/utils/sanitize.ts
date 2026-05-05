type AnyRecord = Record<string, unknown>;

function asPlainRecord(value: unknown): AnyRecord | null {
  if (!value) return null;

  if (
    typeof value === 'object' &&
    value !== null &&
    'toObject' in value &&
    typeof (value as { toObject?: unknown }).toObject === 'function'
  ) {
    return (value as { toObject(): AnyRecord }).toObject();
  }

  return value as AnyRecord;
}

function stripInternalFields(raw: AnyRecord): AnyRecord {
  const { __v, userId, ...safe } = raw as AnyRecord & { __v?: unknown; userId?: unknown };
  void __v;
  void userId;
  return safe;
}

export function sanitizePetLost(record: unknown): AnyRecord | null {
  const raw = asPlainRecord(record);
  if (!raw) return null;
  return stripInternalFields(raw);
}

export function sanitizePetFound(record: unknown): AnyRecord | null {
  const raw = asPlainRecord(record);
  if (!raw) return null;
  return stripInternalFields(raw);
}
