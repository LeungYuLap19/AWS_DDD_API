declare module '@aws-ddd-api/shared/http/response' {
  import type { APIGatewayProxyEvent } from 'aws-lambda';

  export interface JsonResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }

  interface ResponseOptions {
    domainTranslations?: import('@aws-ddd-api/shared/i18n').TranslationDictionaries;
    extraHeaders?: Record<string, string>;
    locale?: string;
    requestId?: string;
  }

  interface EventResponseOptions extends ResponseOptions {
    event?: APIGatewayProxyEvent & { awsRequestId?: string };
  }

  export interface CreateResponseOptions {
    domainTranslations?: import('@aws-ddd-api/shared/i18n').TranslationDictionaries;
  }

  export interface ResponseHelpers {
    errorResponse(
      statusCode: number,
      errorKey: string,
      event: APIGatewayProxyEvent & { awsRequestId?: string },
      extraHeaders?: Record<string, string>
    ): JsonResponse;
    successResponse(
      statusCode: number,
      event: APIGatewayProxyEvent & { awsRequestId?: string },
      data?: Record<string, unknown>,
      extraHeaders?: Record<string, string>
    ): JsonResponse;
  }

  export function createResponse(options?: CreateResponseOptions): ResponseHelpers;
}

declare module '@aws-ddd-api/shared/http/cors' {
  import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

  export function corsHeaders(event: APIGatewayProxyEvent): Record<string, string>;
  export function handleOptions(
    event: APIGatewayProxyEvent & { awsRequestId?: string }
  ): APIGatewayProxyResult | null;
}

declare module '@aws-ddd-api/shared/http/handler' {
  import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
  import type { ResponseHelpers } from '@aws-ddd-api/shared/http/response';

  export interface ApiRouteContext<
    TEvent extends APIGatewayProxyEvent = APIGatewayProxyEvent
  > {
    event: TEvent & { awsRequestId?: string };
    body: unknown;
  }

  export type ApiRouteRequest<
    TEvent extends APIGatewayProxyEvent = APIGatewayProxyEvent
  > = (routeContext: ApiRouteContext<TEvent>) => Promise<APIGatewayProxyResult>;

  export interface CreateApiGatewayHandlerOptions {
    response: ResponseHelpers;
    onError?: (error: unknown, event: APIGatewayProxyEvent) => void | Promise<void>;
  }

  export function createApiGatewayHandler(
    routeRequest: ApiRouteRequest,
    options: CreateApiGatewayHandlerOptions
  ): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
}

declare module '@aws-ddd-api/shared/http/router' {
  import type { APIGatewayProxyResult } from 'aws-lambda';
  import type { ApiRouteContext } from '@aws-ddd-api/shared/http/handler';
  import type { ResponseHelpers } from '@aws-ddd-api/shared/http/response';

  export type RouteHandler = (routeContext: ApiRouteContext) => Promise<APIGatewayProxyResult>;
  export type RouteMap = Record<string, RouteHandler>;

  export interface CreateRouterOptions {
    response: ResponseHelpers;
    notFoundErrorKey?: string;
    methodNotAllowedErrorKey?: string;
  }

  export function createRouter(
    routes: RouteMap,
    options: CreateRouterOptions
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
    errorKey: string;
    constructor(errorKey: string, statusCode: number);
  }

  export function getAuthContext(event: APIGatewayProxyEvent): AuthContext | null;
  export function requireAuthContext(event: APIGatewayProxyEvent): AuthContext;
  export function hasRole(event: APIGatewayProxyEvent, role: string): boolean;
  export function requireRole(event: APIGatewayProxyEvent, roles: string | string[]): AuthContext;
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

declare module '@aws-ddd-api/shared/config/env' {
  import type { ZodType } from 'zod';

  export function validateEnv<T>(envSchema: ZodType<T>, scope?: string): T;
}

declare module '@aws-ddd-api/shared/i18n' {
  import type { APIGatewayProxyEvent } from 'aws-lambda';

  export type SupportedLocale = 'en' | 'zh';
  export type TranslationDictionary = Record<string, unknown>;
  export type TranslationDictionaries = Partial<Record<SupportedLocale, TranslationDictionary>>;

  export const SUPPORTED_LOCALES: SupportedLocale[];
  export const FALLBACK_LOCALE: SupportedLocale;

  export function normalizeLocale(value: unknown, fallback?: SupportedLocale): SupportedLocale;
  export function getRequestLocale(
    event: APIGatewayProxyEvent,
    fallback?: SupportedLocale
  ): SupportedLocale;
  export function loadCommonTranslations(locale?: unknown): TranslationDictionary;
  export function loadTranslations(
    locale?: unknown,
    domainTranslations?: TranslationDictionaries
  ): TranslationDictionary;
  export function getTranslation(
    translations: TranslationDictionary,
    key: string,
    fallback?: string
  ): string;
  export function translate(
    key: string,
    locale?: unknown,
    fallback?: string,
    domainTranslations?: TranslationDictionaries
  ): string;
  export function createTranslator(
    locale?: unknown,
    domainTranslations?: TranslationDictionaries
  ): (key: string, fallback?: string) => string;
}

declare module '@aws-ddd-api/shared/rate-limit/mongo' {
  import type { APIGatewayProxyEvent } from 'aws-lambda';
  import type { Mongoose } from 'mongoose';

  export function requireMongoRateLimit(options: {
    action: string;
    collectionName?: string;
    event: APIGatewayProxyEvent;
    failOpen?: boolean;
    hashKey?: boolean;
    identifier?: string | number | null;
    includeIp?: boolean;
    keySalt?: string;
    limit: number;
    modelName?: string;
    mongoose: Mongoose;
    nowMs?: number;
    ttlWindowMultiplier?: number;
    windowSeconds: number;
  }): Promise<void>;
}

declare module '@aws-ddd-api/shared' {
  export * from '@aws-ddd-api/shared/auth/bearer';
  export * from '@aws-ddd-api/shared/auth/context';
  export * from '@aws-ddd-api/shared/auth/policy';
  export * from '@aws-ddd-api/shared/config/boolean';
  export * from '@aws-ddd-api/shared/config/env';
  export * from '@aws-ddd-api/shared/http/cors';
  export * from '@aws-ddd-api/shared/http/handler';
  export * from '@aws-ddd-api/shared/http/response';
  export * from '@aws-ddd-api/shared/http/router';
  export * from '@aws-ddd-api/shared/i18n';
  export * from '@aws-ddd-api/shared/logging/logger';
  export * from '@aws-ddd-api/shared/rate-limit/mongo';
  export * from '@aws-ddd-api/shared/validation/zod';
}
