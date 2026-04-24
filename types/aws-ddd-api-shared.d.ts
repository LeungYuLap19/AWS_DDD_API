declare module '@aws-ddd-api/shared' {
  export interface JsonResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }

  export function json(
    statusCode: number,
    payload: unknown,
    extraHeaders?: Record<string, string>
  ): JsonResponse;

  export function safeJsonParse(body: string | null | undefined): unknown;

  export function isTrue(value: unknown, defaultValue?: boolean): boolean;

  export function getBearerToken(headerValue: unknown): string | null;

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
