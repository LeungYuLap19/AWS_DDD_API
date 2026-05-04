import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { type AuthContext, AuthContextError } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';

// ---------------------------------------------------------------------------
// Path parameter helpers
// ---------------------------------------------------------------------------

export function getValidatedPetId(event: RouteContext['event']): string {
  const petId = event.pathParameters?.petId;

  if (!petId) {
    throw new AuthContextError('petTransfer.errors.missingPetId', 400);
  }

  if (!mongoose.isValidObjectId(petId)) {
    throw new AuthContextError('petTransfer.errors.invalidPetId', 400);
  }

  return petId;
}

export function getValidatedTransferId(event: RouteContext['event']): string {
  const transferId = event.pathParameters?.transferId;

  if (!transferId) {
    throw new AuthContextError('petTransfer.errors.transfer.missingTransferId', 400);
  }

  if (!mongoose.isValidObjectId(transferId)) {
    throw new AuthContextError('petTransfer.errors.transfer.invalidTransferId', 400);
  }

  return transferId;
}

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

type AuthorizedPet = {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
};

export async function authorizePetAccess(
  authContext: AuthContext,
  petId: string
): Promise<AuthorizedPet> {
  const Pet = mongoose.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: false })
    .select('_id userId ngoId')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new AuthContextError('petTransfer.errors.petNotFound', 404);
  }

  const isOwner = pet.userId !== null && String(pet.userId) === authContext.userId;
  const isNgoOwner =
    Boolean(authContext.ngoId) && pet.ngoId !== null && String(pet.ngoId) === authContext.ngoId;

  if (!isOwner && !isNgoOwner) {
    throw new AuthContextError('common.forbidden', 403);
  }

  return pet;
}

export function requireNGORole(authContext: AuthContext): void {
  if (!authContext.userRole || authContext.userRole.toLowerCase() !== 'ngo') {
    throw new AuthContextError('common.forbidden', 403);
  }
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function isValidDateFormat(dateString: string): boolean {
  if (!dateString || typeof dateString !== 'string') return false;

  // DD/MM/YYYY
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

  // YYYY-MM-DD with optional ISO-8601 time component
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/.exec(
      dateString
    );
  if (iso) {
    const [, year, month, day, hh, mm, ss, offsetSign, offsetHour, offsetMinute] = iso;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    const dateOk =
      d.getFullYear() === Number(year) &&
      d.getMonth() === Number(month) - 1 &&
      d.getDate() === Number(day);
    if (!dateOk) return false;
    if (hh !== undefined) {
      if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return false;
      if (
        offsetSign !== undefined &&
        (Number(offsetHour) > 23 || Number(offsetMinute) > 59)
      ) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export function parseDateFlexible(dateString: string): Date | null {
  if (!dateString) return null;

  // ISO string or YYYY-MM-DD
  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    return new Date(dateString);
  }

  // DD/MM/YYYY
  const parts = dateString.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    if (day && month && year && day.length <= 2 && month.length <= 2 && year.length === 4) {
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  return new Date(dateString);
}

// ---------------------------------------------------------------------------
// Contact validation helpers (for NGO transfer)
// ---------------------------------------------------------------------------

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toLowerCase();
}

export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim();
}

export function isValidEmail(email: string | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // RFC 5321 max email length
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPhoneNumber(phone: string | undefined): boolean {
  if (!phone || typeof phone !== 'string') return false;
  return /^\+[1-9]\d{1,14}$/.test(phone.trim());
}
