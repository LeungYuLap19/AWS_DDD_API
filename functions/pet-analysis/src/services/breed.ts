import type { APIGatewayProxyResult } from 'aws-lambda';
import { parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { breedAnalysisSchema } from '../zodSchema/breedAnalysisSchema';
import env from '../config/env';

export async function handleBreedAnalysis(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'breedAnalysis',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 20,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const parsed = parseBody(ctx.body, breedAnalysisSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const endpoint = `${env.VM_BREED_PUBLIC_IP}${env.BREED_DOCKER_IMAGE}`;
  const params = new URLSearchParams();
  params.append('species', parsed.data.species);
  params.append('url', parsed.data.url);

  const analysisResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const result = await analysisResponse.json();

  return response.successResponse(200, ctx.event, {
    message: 'petAnalysis.success.breedAnalysisCompleted',
    result,
  });
}
