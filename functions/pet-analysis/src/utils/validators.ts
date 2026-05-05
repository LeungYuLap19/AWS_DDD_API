export function isValidDateFormat(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const date = new Date(value);
  return date instanceof Date && !Number.isNaN(date.getTime());
}

export function isValidImageUrl(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function toTrimmedString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}
