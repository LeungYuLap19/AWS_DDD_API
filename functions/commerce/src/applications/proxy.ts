import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';

type ProxyContext = RouteContext & {
  domain: string;
};

export async function proxyRoot({ json }: ProxyContext): Promise<APIGatewayProxyResult> {
  return json(200, { success: true });
}

export async function proxyAny({ json }: ProxyContext): Promise<APIGatewayProxyResult> {
  return json(200, { success: true });
}
