import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import { parseObjectIdParam } from '@aws-ddd-api/shared/validation/common';
import type { RouteContext } from '../../../../types/lambda';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { handleGetAdoptionList, handleGetBrowseDetail } from './browse';
import {
  handleGetManagedRecord,
  handleCreateManagedRecord,
  handleUpdateManagedRecord,
  handleDeleteManagedRecord,
} from './managed';

/**
 * GET /pet/adoption
 * Public adoption browse list — forwarded directly.
 */
export { handleGetAdoptionList };

/**
 * GET /pet/adoption/detail/{adoptionId}
 * Public adoption browse detail.
 */
export async function handleGetBrowseById(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.adoptionId);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  return handleGetBrowseDetail(ctx, idParam.data);
}

/**
 * GET /pet/adoption/{petId}
 * Get an owned pet's managed adoption record.
 * Protected: requires valid auth context.
 */
export async function handleGetManaged(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  return handleGetManagedRecord(ctx, idParam.data);
}

/**
 * POST /pet/adoption/{petId}
 * Create managed adoption record.
 * Protected: requires valid auth context.
 */
export async function handleCreate(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  const rateLimitResponse = await applyRateLimit({
    action: 'petAdoption.create',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;
  return handleCreateManagedRecord(ctx, idParam.data);
}

/**
 * PATCH /pet/adoption/{petId}
 * Update managed adoption record.
 * Protected: requires valid auth context.
 */
export async function handleUpdate(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  const rateLimitResponse = await applyRateLimit({
    action: 'petAdoption.update',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;
  return handleUpdateManagedRecord(ctx, idParam.data);
}

/**
 * DELETE /pet/adoption/{petId}
 * Delete managed adoption record.
 * Protected: requires valid auth context.
 */
export async function handleDelete(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  const rateLimitResponse = await applyRateLimit({
    action: 'petAdoption.delete',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 30, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;
  return handleDeleteManagedRecord(ctx, idParam.data);
}
