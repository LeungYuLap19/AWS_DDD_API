import './src/config/env';
import { createApiGatewayHandler } from '@aws-ddd-api/shared';
import { routeRequest } from './src/router';
import { response } from './src/utils/response';

export const handler = createApiGatewayHandler(routeRequest, { response });
