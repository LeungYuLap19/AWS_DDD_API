import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';

type ProxyContext = RouteContext & {
  domain: string;
};

export async function proxyRoot({ event }: ProxyContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, event);
}

export async function proxyAny({ event }: ProxyContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, event);
}
