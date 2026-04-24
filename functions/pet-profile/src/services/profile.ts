import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { proxyAny, proxyRoot } from '../applications/proxy';

export async function handleProxyRoot(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return proxyRoot({ ...ctx, domain: 'pet-profile' });
}

export async function handleProxyAny(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return proxyAny({ ...ctx, domain: 'pet-profile' });
}
