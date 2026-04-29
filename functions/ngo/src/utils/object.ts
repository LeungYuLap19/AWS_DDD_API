export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function flattenToDot(
  input: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }

    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      Object.assign(acc, flattenToDot(value as Record<string, unknown>, nextKey));
      return acc;
    }

    acc[nextKey] = value;
    return acc;
  }, {});
}

export function pickAllowed(
  source: Record<string, unknown>,
  allowed: Set<string>
): Record<string, unknown> {
  return Object.entries(source).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (allowed.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

export function hasKeys(input: Record<string, unknown>): boolean {
  return Object.keys(input).length > 0;
}
