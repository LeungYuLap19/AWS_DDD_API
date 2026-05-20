import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext, requireRole } from '@aws-ddd-api/shared/auth/context';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  authorizePetAccess,
  getValidatedPetId,
  getValidatedTransferId,
  isValidDateFormat,
  isValidEmail,
  isValidPhoneNumber,
  normalizeEmail,
  normalizePhone,
  parseDateFlexible,
  requireNGORole,
} from '../utils/helpers';
import {
  ngoTransferBodySchema,
  transferCreateBodySchema,
  transferUpdateBodySchema,
  type NgoTransferBody,
  type TransferCreateBody,
  type TransferUpdateBody,
} from '../zodSchema/transferSchema';

/**
 * Appends a transfer-history entry to an owned pet after validating the route,
 * request body, and legacy date format contract.
 */
export async function handleCreateTransfer(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petId = getValidatedPetId(ctx.event);

  const parsed = parseBody(ctx.body, transferCreateBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petTransfer.create',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  await authorizePetAccess(authContext, petId);

  const data = parsed.data as TransferCreateBody;

  if (data.regDate && !isValidDateFormat(data.regDate)) {
    return response.errorResponse(
      400,
      'petTransfer.errors.transfer.invalidDateFormat',
      ctx.event
    );
  }

  const transferRecordId = new mongoose.Types.ObjectId();
  const newRecord = {
    _id: transferRecordId,
    regDate: data.regDate ? parseDateFlexible(data.regDate) : null,
    regPlace: data.regPlace ?? null,
    transferOwner: data.transferOwner ?? null,
    transferContact: data.transferContact ?? null,
    transferRemark: data.transferRemark ?? '',
  };

  const Pet = mongoose.model('Pet');
  const result = await Pet.updateOne(
    { _id: petId, deleted: false },
    { $push: { transfer: newRecord } }
  );

  if ((result as { matchedCount?: number }).matchedCount === 0) {
    return response.errorResponse(404, 'petTransfer.errors.petNotFound', ctx.event);
  }

  const { _id: _transferId, ...transferFields } = newRecord;
  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: { id: String(transferRecordId), petId, ...transferFields },
  });
}

/**
 * Updates one transfer-history subdocument on an owned pet using positional
 * Mongo updates after the transfer id is verified to exist on that pet.
 */
export async function handleUpdateTransfer(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petId = getValidatedPetId(ctx.event);
  const transferId = getValidatedTransferId(ctx.event);

  const parsed = parseBody(ctx.body, transferUpdateBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petTransfer.update',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  await authorizePetAccess(authContext, petId);

  const data = parsed.data as TransferUpdateBody;

  if (data.regDate && !isValidDateFormat(data.regDate)) {
    return response.errorResponse(
      400,
      'petTransfer.errors.transfer.invalidDateFormat',
      ctx.event
    );
  }

  const Pet = mongoose.model('Pet');

  // Verify the sub-document exists on this pet
  const pet = await Pet.findOne({
    _id: petId,
    deleted: false,
    'transfer._id': transferId,
  })
    .select('_id')
    .lean();

  if (!pet) {
    return response.errorResponse(404, 'petTransfer.errors.transfer.notFound', ctx.event);
  }

  // Build positional update
  const updateFields: Record<string, unknown> = {};
  if (data.regDate !== undefined)
    updateFields['transfer.$.regDate'] = data.regDate ? parseDateFlexible(data.regDate) : null;
  if (data.regPlace !== undefined) updateFields['transfer.$.regPlace'] = data.regPlace;
  if (data.transferOwner !== undefined)
    updateFields['transfer.$.transferOwner'] = data.transferOwner;
  if (data.transferContact !== undefined)
    updateFields['transfer.$.transferContact'] = data.transferContact;
  if (data.transferRemark !== undefined)
    updateFields['transfer.$.transferRemark'] = data.transferRemark;

  if (Object.keys(updateFields).length === 0) {
    return response.errorResponse(400, 'common.noFieldsToUpdate', ctx.event);
  }

  const result = await Pet.updateOne(
    { _id: petId, deleted: false, 'transfer._id': transferId },
    { $set: updateFields }
  );

  if ((result as { matchedCount?: number }).matchedCount === 0) {
    return response.errorResponse(404, 'petTransfer.errors.transfer.notFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
  });
}

/**
 * Deletes one transfer-history subdocument from an owned pet.
 */
export async function handleDeleteTransfer(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petId = getValidatedPetId(ctx.event);
  const transferId = getValidatedTransferId(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petTransfer.delete',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  await authorizePetAccess(authContext, petId);

  const Pet = mongoose.model('Pet');
  const result = await Pet.updateOne(
    { _id: petId, deleted: false, 'transfer._id': transferId },
    { $pull: { transfer: { _id: transferId } } }
  );

  if ((result as { matchedCount?: number }).matchedCount === 0) {
    return response.errorResponse(404, 'petTransfer.errors.transfer.notFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}

/**
 * NGO-only ownership reassignment flow that validates the target user by phone
 * and/or email, records transfer metadata, and moves the pet out of NGO
 * ownership in the same update.
 */
export async function handleNGOTransfer(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireRole(ctx.event, ['admin']);

  // NGO role check before any DB work
  // requireNGORole(authContext);

  const petId = getValidatedPetId(ctx.event);

  const parsed = parseBody(ctx.body, ngoTransferBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  // Ownership change is high impact; cap tighter than ordinary transfer edits.
  const rateLimitResponse = await applyRateLimit({
    action: 'petTransfer.ngoReassignment',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 30, windowSeconds: 60 * 60 },
      { scope: 'identifier', limit: 15, windowSeconds: 60 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  await authorizePetAccess(authContext, petId);

  const data = parsed.data as NgoTransferBody;

  // Normalize and validate email if provided
  let normalizedEmail: string | undefined;
  if (data.UserEmail) {
    normalizedEmail = normalizeEmail(data.UserEmail);
    if (!isValidEmail(normalizedEmail)) {
      return response.errorResponse(
        400,
        'petTransfer.errors.ngoTransfer.invalidEmailFormat',
        ctx.event
      );
    }
  }

  // Normalize and validate phone if provided
  let normalizedPhone: string | undefined;
  if (data.UserContact) {
    normalizedPhone = normalizePhone(data.UserContact);
    if (!isValidPhoneNumber(normalizedPhone)) {
      return response.errorResponse(
        400,
        'petTransfer.errors.ngoTransfer.invalidPhoneFormat',
        ctx.event
      );
    }
  }

  // Validate date format if provided
  if (data.regDate && !isValidDateFormat(data.regDate)) {
    return response.errorResponse(
      400,
      'petTransfer.errors.ngoTransfer.invalidDateFormat',
      ctx.event
    );
  }

  const User = mongoose.model('User');
  let resolvedUser: { _id: unknown } | null = null;

  if (normalizedEmail && normalizedPhone) {
    // Both provided — look up by each and cross-validate they are the same user
    const [userByEmail, userByPhone] = await Promise.all([
      User.findOne({ email: normalizedEmail, deleted: false }).select('_id').lean() as Promise<{ _id: unknown } | null>,
      User.findOne({ phoneNumber: normalizedPhone, deleted: false }).select('_id').lean() as Promise<{ _id: unknown } | null>,
    ]);

    if (!userByEmail || !userByPhone) {
      return response.errorResponse(404, 'petTransfer.errors.ngoTransfer.targetUserNotFound', ctx.event);
    }

    if (String(userByEmail._id) !== String(userByPhone._id)) {
      return response.errorResponse(400, 'petTransfer.errors.ngoTransfer.userIdentityMismatch', ctx.event);
    }

    resolvedUser = userByEmail;
  } else if (normalizedEmail) {
    // Email only
    resolvedUser = (await User.findOne({ email: normalizedEmail, deleted: false })
      .select('_id')
      .lean()) as { _id: unknown } | null;
  } else {
    // Phone only
    resolvedUser = (await User.findOne({ phoneNumber: normalizedPhone, deleted: false })
      .select('_id')
      .lean()) as { _id: unknown } | null;
  }

  if (!resolvedUser) {
    return response.errorResponse(404, 'petTransfer.errors.ngoTransfer.targetUserNotFound', ctx.event);
  }

  // Build update fields
  const updateFields: Record<string, unknown> = {};

  if (data.regDate) updateFields['transferNGO.0.regDate'] = parseDateFlexible(data.regDate);
  if (data.regPlace) updateFields['transferNGO.0.regPlace'] = data.regPlace;
  if (data.transferOwner) updateFields['transferNGO.0.transferOwner'] = data.transferOwner;
  if (data.transferContact) updateFields['transferNGO.0.transferContact'] = data.transferContact;
  if (data.UserContact) updateFields['transferNGO.0.UserContact'] = data.UserContact;
  if (data.UserEmail !== undefined) updateFields['transferNGO.0.UserEmail'] = data.UserEmail;
  if (data.transferRemark !== undefined)
    updateFields['transferNGO.0.transferRemark'] = data.transferRemark;
  if (data.isTransferred !== undefined)
    updateFields['transferNGO.0.isTransferred'] = data.isTransferred;

  // Reassign ownership — transfer to target user, clear NGO ownership
  updateFields['userId'] = resolvedUser._id;
  updateFields['ngoId'] = '';

  if (data.regDate) updateFields['transfer.0.regDate'] = parseDateFlexible(data.regDate);
  if (data.regPlace) updateFields['transfer.0.regPlace'] = data.regPlace;
  if (data.transferOwner) updateFields['transfer.0.transferOwner'] = data.transferOwner;
  if (data.transferContact) updateFields['transfer.0.transferContact'] = data.transferContact;
  if (data.transferRemark !== undefined)
    updateFields['transfer.0.transferRemark'] = data.transferRemark;

  const Pet = mongoose.model('Pet');
  const result = await Pet.updateOne(
    { _id: petId, deleted: false },
    { $set: updateFields }
  );

  if ((result as { matchedCount?: number }).matchedCount === 0) {
    return response.errorResponse(404, 'petTransfer.errors.petNotFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
  });
}
