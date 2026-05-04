import type { APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
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
  const id = ctx.event.pathParameters?.id ?? '';
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
  const petId = ctx.event.pathParameters?.id ?? '';
  return handleCreateManagedRecord(ctx, petId);
}

/**
 * PATCH /pet/adoption/{id}
 * Update managed adoption record — id is petId.
 * Protected: requires valid auth context.
 */
export async function handleUpdate(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const petId = ctx.event.pathParameters?.id ?? '';
  return handleUpdateManagedRecord(ctx, petId);
}

/**
 * DELETE /pet/adoption/{id}
 * Delete managed adoption record — id is petId.
 * Protected: requires valid auth context.
 */
export async function handleDelete(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const petId = ctx.event.pathParameters?.id ?? '';
  return handleDeleteManagedRecord(ctx, petId);
}
