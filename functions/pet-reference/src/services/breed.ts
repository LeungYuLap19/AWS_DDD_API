import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parsePathParam } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { breedLookupQuerySchema, animalTypePathSchema } from '../zodSchema/referenceSchema';

function parseLangQuery(ctx: RouteContext): { ok: true; lang: 'en' | 'zh' } | { ok: false; statusCode: number; errorKey: string } {
  const parsed = breedLookupQuerySchema.safeParse(ctx.event.queryStringParameters ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = typeof issue?.message === 'string' ? issue.message : '';
    return {
      ok: false,
      statusCode: 400,
      errorKey: message.includes('.') ? message : 'common.invalidQueryParams',
    };
  }
  return { ok: true, lang: parsed.data.lang };
}

/**
 * Returns the nested breed reference payload for a single animal type and
 * language. The collection stores the payload under `breeds[animalType][lang]`,
 * so this handler reads and returns that nested value directly.
 */
export async function handleGetBreedReference(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const animalTypeParam = parsePathParam(ctx.event.pathParameters?.animalType, animalTypePathSchema);
  if (!animalTypeParam.ok) {
    return response.errorResponse(animalTypeParam.statusCode, animalTypeParam.errorKey, ctx.event);
  }
  const animalType = animalTypeParam.data;

  const langParam = parseLangQuery(ctx);
  if (!langParam.ok) {
    return response.errorResponse(langParam.statusCode, langParam.errorKey, ctx.event);
  }
  const { lang } = langParam;

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petReference.breed',
    event: ctx.event,
    policies: [{ scope: 'ip', limit: 60, windowSeconds: 60 }],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const Animal = mongoose.model('Animal');
  const animals = (await Animal.find({}).select('breeds').lean()) as Array<{
    breeds?: Record<string, Record<string, unknown>>;
  }>;

  const result = animals[0]?.breeds?.[animalType]?.[lang];
  if (result == null || (Array.isArray(result) && result.length === 0)) {
    return response.errorResponse(404, 'petReference.errors.breedListNotFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: result,
  });
}
