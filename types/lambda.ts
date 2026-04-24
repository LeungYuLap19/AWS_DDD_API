import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

export type JsonResponse = (statusCode: number, payload: unknown, extraHeaders?: Record<string, string>) => APIGatewayProxyResult;

export interface RouteContext {
  event: APIGatewayProxyEvent & { awsRequestId?: string };
  body: unknown;
  json: JsonResponse;
}

export type RouteHandler = (ctx: RouteContext) => Promise<APIGatewayProxyResult>;

export type LambdaHandler = (
  event: APIGatewayProxyEvent,
  context: Context
) => Promise<APIGatewayProxyResult>;
