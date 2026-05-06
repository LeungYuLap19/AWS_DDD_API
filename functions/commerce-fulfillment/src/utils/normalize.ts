import mongoose from 'mongoose';

export function normalizeEmail(email: unknown): string | undefined {
  return typeof email === 'string' ? email.trim().toLowerCase() : undefined;
}

export function normalizePhone(phone: unknown): string | undefined {
  return typeof phone === 'string' ? phone.trim() : undefined;
}

export function isValidObjectId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

export function parseDDMMYYYY(dateString: string | Date | number | null | undefined): Date | null {
  if (!dateString) return null;

  if (typeof dateString !== 'string') {
    const dt = new Date(dateString as number | Date);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    const dt = new Date(dateString);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const parts = dateString.split('/');
  const [day, month, year] = parts;
  if (
    day &&
    month &&
    year &&
    day.length <= 2 &&
    month.length <= 2 &&
    year.length === 4
  ) {
    const dt = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const fallback = new Date(dateString);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
