export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toLowerCase();
}

export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim();
}
