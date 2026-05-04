import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { AuthContextError } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';

const DATE_FIELDS = [
  'NeuteredDate',
  'firstVaccinationDate',
  'secondVaccinationDate',
  'thirdVaccinationDate',
] as const;

const PAGE_SIZE = 16;
const EXCLUDED_SITES = ['Arc Dog Shelter', 'Tolobunny', 'HKRABBIT'];

const BROWSE_LIST_PROJECTION = {
  _id: 1,
  Name: 1,
  Age: 1,
  Sex: 1,
  Breed: 1,
  Image_URL: 1,
};

const BROWSE_DETAIL_PROJECTION = {
  _id: 1,
  Name: 1,
  Age: 1,
  Sex: 1,
  Breed: 1,
  Image_URL: 1,
  Remark: 1,
  AdoptionSite: 1,
  URL: 1,
};

export { PAGE_SIZE, EXCLUDED_SITES, BROWSE_LIST_PROJECTION, BROWSE_DETAIL_PROJECTION, DATE_FIELDS };

/**
 * Validates that a string is a valid MongoDB ObjectId.
 */
export function isValidObjectId(id: unknown): id is string {
  if (typeof id !== 'string' || !id.trim()) return false;
  return mongoose.isValidObjectId(id);
}

/**
 * Checks whether a date string matches DD/MM/YYYY or ISO 8601 format.
 */
export function isValidDateFormat(dateString: unknown): boolean {
  if (!dateString || typeof dateString !== 'string') return false;

  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateString);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return (
      d.getFullYear() === Number(year) &&
      d.getMonth() === Number(month) - 1 &&
      d.getDate() === Number(day)
    );
  }

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/.exec(
      dateString
    );
  if (iso) {
    const [, year, month, day, hh, mm, ss, , offsetHour, offsetMinute] = iso;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    const dateOk =
      d.getFullYear() === Number(year) &&
      d.getMonth() === Number(month) - 1 &&
      d.getDate() === Number(day);
    if (!dateOk) return false;
    if (hh !== undefined) {
      if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return false;
      if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
        return false;
    }
    return true;
  }

  return false;
}

/**
 * Parses a DD/MM/YYYY or ISO 8601 date string into a Date.
 */
export function parseDateFlexible(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;
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

/**
 * Validates date fields in an adoption body.
 * Returns the first invalid field name, or null if all valid.
 */
export function validateAdoptionDates(data: Record<string, unknown>): string | null {
  for (const field of DATE_FIELDS) {
    if (data[field] && !isValidDateFormat(data[field])) {
      return field;
    }
  }
  return null;
}

/**
 * Strips internal fields (__v) from a managed adoption record.
 */
export function sanitizeManagedAdoption(record: unknown): Record<string, unknown> | null {
  if (!record) return null;
  const raw =
    typeof (record as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (record as { toObject: () => Record<string, unknown> }).toObject()
      : (record as Record<string, unknown>);
  const { __v, ...safe } = raw;
  void __v;
  return safe;
}

/**
 * Strips __v and parsedDate from a browse adoption document.
 */
export function sanitizeBrowseAdoption(adoption: unknown): Record<string, unknown> | null {
  if (!adoption) return null;
  const raw =
    typeof (adoption as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (adoption as { toObject: () => Record<string, unknown> }).toObject()
      : (adoption as Record<string, unknown>);
  const { __v, parsedDate, ...safe } = raw as Record<string, unknown> & {
    __v?: unknown;
    parsedDate?: unknown;
  };
  void __v;
  void parsedDate;
  return safe;
}

type AuthorizedPet = {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
};

/**
 * Resolves pet from the main DB and checks caller ownership.
 * Throws AuthContextError on not-found or unauthorized.
 */
export async function authorizePetAccess(
  conn: mongoose.Connection,
  petId: string,
  callerId: { userId: string; ngoId?: string }
): Promise<void> {
  const Pet = conn.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: false })
    .select('_id userId ngoId')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new AuthContextError('petAdoption.errors.managed.petNotFound', 404);
  }

  const isOwner = pet.userId !== null && String(pet.userId) === callerId.userId;
  const isNgoOwner =
    Boolean(callerId.ngoId) &&
    pet.ngoId !== null &&
    String(pet.ngoId) === callerId.ngoId;

  if (!isOwner && !isNgoOwner) {
    throw new AuthContextError('common.forbidden', 403);
  }
}

/**
 * Converts a known error type into an HTTP response, or returns null for unknown errors.
 */
export function toErrorResponse(
  error: unknown,
  event: RouteContext['event']
): APIGatewayProxyResult | null {
  if (error instanceof AuthContextError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  const errorKey = (error as { errorKey?: unknown })?.errorKey;
  if (typeof statusCode === 'number' && typeof errorKey === 'string') {
    return response.errorResponse(statusCode, errorKey, event);
  }
  return null;
}

/**
 * Parses positive integers from query string values.
 * Returns null if missing or invalid.
 */
export function parsePositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Normalizes a CSV query string value into an array of trimmed non-empty strings.
 */
export function normalizeCsvValues(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Escapes special regex characters in a search string.
 */
export function escapeRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
