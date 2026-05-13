import type { APIGatewayProxyResult } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { HttpError, parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import { z } from 'zod';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';

const lambdaClient = new LambdaClient({});

type MlInvokeOperation = 'register' | 'verify';

const registerBodySchema = z.object({}).passthrough();
const verifyBodySchema = z.object({}).passthrough();

function toErrorResponse(error: unknown, ctx: RouteContext): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, ctx.event);
  }

  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  const errorKey = (error as { errorKey?: unknown })?.errorKey;
  if (typeof statusCode === 'number' && typeof errorKey === 'string') {
    return response.errorResponse(statusCode, errorKey, ctx.event);
  }

  return null;
}

async function invokeMlInference(
  ctx: RouteContext,
  op: MlInvokeOperation,
  body: Record<string, unknown>
): Promise<unknown> {
  const functionName = process.env.ML_INFERENCE_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('ML_INFERENCE_FUNCTION_NAME is missing');
  }

  const payload = {
    op,
    petId: String(ctx.event.pathParameters?.petId || ''),
    body,
    requestId: ctx.event.requestContext?.requestId,
  };

  const result = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  if (result.FunctionError) {
    throw new Error(`ml-inference invoke failed: ${result.FunctionError}`);
  }

  const payloadText = result.Payload ? Buffer.from(result.Payload).toString('utf8') : '';
  if (!payloadText) return {};

  try {
    return JSON.parse(payloadText);
  } catch {
    return { raw: payloadText };
  }
}

export async function handleGetBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
  });
}

export async function handleDeleteBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}

export async function handleRegisterBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireAuthContext(ctx.event);
    const parsed = parseBody(ctx.body, registerBodySchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }

    const mlResult = await invokeMlInference(ctx, 'register', parsed.data);
    return response.successResponse(200, ctx.event, {
      message: 'success.retrieved',
      data: mlResult,
    });
  } catch (error) {
    const handled = toErrorResponse(error, ctx);
    if (handled) return handled;
    return response.errorResponse(502, 'common.serviceUnavailable', ctx.event, {
      message: 'common.serviceUnavailable',
    });
  }
}

export async function handleVerifyBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireAuthContext(ctx.event);
    const parsed = parseBody(ctx.body, verifyBodySchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }

    const mlResult = await invokeMlInference(ctx, 'verify', parsed.data);
    return response.successResponse(200, ctx.event, {
      message: 'success.retrieved',
      data: mlResult,
    });
  } catch (error) {
    const handled = toErrorResponse(error, ctx);
    if (handled) return handled;
    return response.errorResponse(502, 'common.serviceUnavailable', ctx.event, {
      message: 'common.serviceUnavailable',
    });
  }
}
