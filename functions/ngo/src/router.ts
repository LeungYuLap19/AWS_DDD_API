import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext, RouteHandler } from '../../../types/lambda';
import { handleProxyAny, handleProxyRoot } from './services/ngo';

const routes: Record<string, RouteHandler> = {
  '/ngo': handleProxyRoot,
  '/ngo/{proxy+}': handleProxyAny,
};

export async function routeRequest(routeContext: RouteContext): Promise<APIGatewayProxyResult> {
  const routeKey = `${routeContext.event.httpMethod} ${routeContext.event.resource}`;
  const routeAction = routes[routeContext.event.resource] || routes[routeKey];

  if (!routeAction) {
    return routeContext.json(404, {
      message: 'Route not found',
      routeKey,
    });
  }

  return routeAction(routeContext);
}
