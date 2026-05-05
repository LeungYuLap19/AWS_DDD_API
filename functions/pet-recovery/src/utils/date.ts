/**
 * Parses a date string in DD/MM/YYYY, ISO date, or full ISO datetime form.
 *
 * Returns `null` for empty input. Returns `Invalid Date` for unparsable input;
 * callers that need to reject invalid dates should check via `isNaN(date.getTime())`.
 */
export function parseFlexibleDate(dateString?: string | null): Date | null {
  if (!dateString) {
    return null;
  }

  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    return new Date(dateString);
  }

  const parts = dateString.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    if (day && month && year && day.length <= 2 && month.length <= 2 && year.length === 4) {
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  return new Date(dateString);
}
