import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

export interface RouteContext {
  event: APIGatewayProxyEvent & { awsRequestId?: string };
  body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<APIGatewayProxyResult>;

export type LambdaHandler = (
  event: APIGatewayProxyEvent,
  context: Context
) => Promise<APIGatewayProxyResult>;
