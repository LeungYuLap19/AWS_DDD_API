declare module '@aws-ddd-api/shared/http/response' {
  import type { APIGatewayProxyResult } from 'aws-lambda';

  export interface JsonResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }

  export interface ErrorJsonOptions {
    code?: string;
    details?: unknown;
    extraHeaders?: Record<string, string>;
    requestId?: string;
  }

  export interface CorsHeaderOptions {
    origin?: string | null;
    allowedOrigins?: string[];
    allowCredentials?: boolean;
    allowHeaders?: string;
    allowMethods?: string;
  }

  export function json(
    statusCode: number,
    payload: unknown,
    extraHeaders?: Record<string, string>
  ): JsonResponse;

  export function errorJson(
    statusCode: number,
    message?: string,
    options?: ErrorJsonOptions
  ): JsonResponse;

  export function safeJsonParse(body: string | null | undefined): unknown;

  export function withCorsHeaders<T extends APIGatewayProxyResult>(
    response: T,
    options?: CorsHeaderOptions
  ): T;
}

declare module '@aws-ddd-api/shared/http/handler' {
  import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
  import type { json } from '@aws-ddd-api/shared/http/response';

  export type JsonResponder = typeof json;

  export interface ApiRouteContext<
    TEvent extends APIGatewayProxyEvent = APIGatewayProxyEvent
  > {
    event: TEvent & { awsRequestId?: string };
    body: unknown;
    json: JsonResponder;
  }

  export type ApiRouteRequest<
    TEvent extends APIGatewayProxyEvent = APIGatewayProxyEvent
  > = (routeContext: ApiRouteContext<TEvent>) => Promise<APIGatewayProxyResult>;

  export interface CreateApiGatewayHandlerOptions {
    includeErrorDetails?: boolean;
    onError?: (error: unknown, event: APIGatewayProxyEvent) => void | Promise<void>;
  }

  export function createApiGatewayHandler(
    routeRequest: ApiRouteRequest,
    options?: CreateApiGatewayHandlerOptions
  ): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
}

declare module '@aws-ddd-api/shared/http/router' {
  import type { APIGatewayProxyResult } from 'aws-lambda';
  import type { ApiRouteContext } from '@aws-ddd-api/shared/http/handler';

  export type RouteHandler = (routeContext: ApiRouteContext) => Promise<APIGatewayProxyResult>;
  export type RouteMap = Record<string, RouteHandler>;

  export interface CreateRouterOptions {
    notFoundMessage?: string;
    methodNotAllowedMessage?: string;
  }

  export function createRouter(
    routes: RouteMap,
    options?: CreateRouterOptions
  ): (routeContext: ApiRouteContext) => Promise<APIGatewayProxyResult>;
}

declare module '@aws-ddd-api/shared/auth/bearer' {
  export function getBearerToken(headerValue: unknown): string | null;
}

declare module '@aws-ddd-api/shared/auth/policy' {
  export interface PolicyInput {
    principalId: string;
    effect: 'Allow' | 'Deny';
    resource: string;
    context?: Record<string, unknown>;
  }

  export function buildPolicy(input: PolicyInput): {
    principalId: string;
    policyDocument: {
      Version: '2012-10-17';
      Statement: Array<{
        Action: 'execute-api:Invoke';
        Effect: 'Allow' | 'Deny';
        Resource: string;
      }>;
    };
    context: Record<string, string>;
  };
}

declare module '@aws-ddd-api/shared/auth/context' {
  import type { APIGatewayProxyEvent } from 'aws-lambda';

  export interface AuthContext {
    authMode?: string;
    stage?: string;
    userId: string;
    userEmail?: string;
    userRole?: string;
    ngoId?: string;
    ngoName?: string;
    principalId?: string;
  }

  export class AuthContextError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number);
  }

  export function getAuthContext(event: APIGatewayProxyEvent): AuthContext | null;
  export function requireAuthContext(event: APIGatewayProxyEvent): AuthContext;
  export function hasRole(event: APIGatewayProxyEvent, role: string): boolean;
  export function requireRole(event: APIGatewayProxyEvent, roles: string | string[]): AuthContext;
  export function isSelf(
    event: APIGatewayProxyEvent,
    userId: string | number | null | undefined
  ): boolean;
}

declare module '@aws-ddd-api/shared/logging/logger' {
  import type { APIGatewayProxyEvent } from 'aws-lambda';

  export interface LogOptions {
    event?: APIGatewayProxyEvent & {
      awsRequestId?: string;
      userId?: string;
      userEmail?: string;
      userRole?: string;
    };
    error?: unknown;
    extra?: Record<string, unknown>;
    scope?: string;
  }

  export function serializeError(error: unknown): unknown;
  export function logInfo(message: string, options?: LogOptions): void;
  export function logWarn(message: string, options?: LogOptions): void;
  export function logError(message: string, options?: LogOptions): void;
}

declare module '@aws-ddd-api/shared/validation/zod' {
  import type { ZodType } from 'zod';

  export function getZodIssues(error: unknown): unknown[];
  export function getFirstZodIssueMessage(error: unknown, fallback?: string): string;
  export function getJoinedZodIssueMessages(error: unknown, fallback?: string): string;
  export function parseJsonBodyWithSchema<T>(body: unknown, schema: ZodType<T>): T;
}

declare module '@aws-ddd-api/shared/config/boolean' {
  export function isTrue(value: unknown, defaultValue?: boolean): boolean;
}

declare module '@aws-ddd-api/shared' {
  export * from '@aws-ddd-api/shared/auth/bearer';
  export * from '@aws-ddd-api/shared/auth/context';
  export * from '@aws-ddd-api/shared/auth/policy';
  export * from '@aws-ddd-api/shared/config/boolean';
  export * from '@aws-ddd-api/shared/http/handler';
  export * from '@aws-ddd-api/shared/http/response';
  export * from '@aws-ddd-api/shared/http/router';
  export * from '@aws-ddd-api/shared/logging/logger';
  export * from '@aws-ddd-api/shared/validation/zod';
}
