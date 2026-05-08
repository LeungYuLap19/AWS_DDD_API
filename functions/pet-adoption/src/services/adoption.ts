import type { APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext, parseObjectIdParam, requireAuthContext } from '@aws-ddd-api/shared';
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
 * GET /pet/adoption/{id}
 * Dispatches by auth context:
 *   - auth present → managed record GET (petId = id)
 *   - no auth      → public browse detail (adoptionId = id)
 */
export async function handleGetById(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.id);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  const id = idParam.data;
  const authCtx = getAuthContext(ctx.event);
  if (authCtx) {
    return handleGetManagedRecord(ctx, id);
  }
  return handleGetBrowseDetail(ctx, id);
}

/**
 * POST /pet/adoption/{id}
 * Create managed adoption record — id is petId.
 * Protected: requires valid auth context.
 */
export async function handleCreate(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.id);
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
 * PATCH /pet/adoption/{id}
 * Update managed adoption record — id is petId.
 * Protected: requires valid auth context.
 */
export async function handleUpdate(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.id);
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
 * DELETE /pet/adoption/{id}
 * Delete managed adoption record — id is petId.
 * Protected: requires valid auth context.
 */
export async function handleDelete(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.id);
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
