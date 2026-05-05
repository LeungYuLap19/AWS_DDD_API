/**
 * Validates a date string in ISO 8601 (date or datetime) or DD/MM/YYYY format.
 *
 * Mirrors the legacy validator in `AWS_API/functions/PetMedicalRecord` so the
 * same set of inputs is accepted.
 */
export function isValidDateFormat(dateString: unknown): boolean {
  if (!dateString || typeof dateString !== 'string') return false;

  if (
    dateString.includes('T') ||
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(dateString)
  ) {
    const date = parseIsoDate(dateString);
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
    const [day, month, year] = dateString.split('/');
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    const date = new Date(y, m - 1, d);
    return (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    );
  }

  return false;
}

function parseIsoDate(dateString: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const isoDate = new Date(dateString);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Parses a date string in DD/MM/YYYY or ISO format into a `Date`.
 * Returns `null` on invalid input. Mirrors the legacy `parseDDMMYYYY` helper.
 */
export function parseDDMMYYYY(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;

  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    return parseIsoDate(dateString);
  }

  const [day, month, year] = dateString.split('/');
  if (
    day &&
    month &&
    year &&
    day.length <= 2 &&
    month.length <= 2 &&
    year.length === 4
  ) {
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() !== y ||
      date.getMonth() !== m - 1 ||
      date.getDate() !== d
    ) {
      return null;
    }
    return date;
  }

  const fallback = new Date(dateString);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
