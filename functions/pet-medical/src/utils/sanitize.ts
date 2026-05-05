/**
 * Strips internal/sensitive fields from a medical-domain record before
 * returning it to the client. Mirrors legacy `sanitizeRecord` behavior.
 */
export function sanitizeRecord<T extends Record<string, unknown>>(
  record: T | { toObject?: () => Record<string, unknown> } | null | undefined
): Record<string, unknown> | null | undefined {
  if (!record) return record;
  const raw =
    typeof (record as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (record as { toObject: () => Record<string, unknown> }).toObject()
      : (record as Record<string, unknown>);

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__v' || key === 'createdAt' || key === 'updatedAt') continue;
    safe[key] = value;
  }
  return safe;
}
