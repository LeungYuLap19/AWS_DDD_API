import https from 'https';
import querystring from 'querystring';
import crypto from 'crypto';

const SF_OAUTH_URL = 'https://sfapi.sf-express.com/oauth2/accessToken';
const SF_SERVICE_URL = 'https://sfapi.sf-express.com/std/service';
export const SF_CLOUD_PRINT_URL = 'https://bspgw.sf-express.com/std/service';

interface RequestJsonOptions {
  url: string;
  method: string;
  headers: Record<string, string | number>;
  body?: string;
}

interface RequestJsonResult {
  status: number;
  body: Record<string, unknown>;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

async function requestJson(options: RequestJsonOptions): Promise<RequestJsonResult> {
  const parsedUrl = new URL(options.url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: string) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      }
    );

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function getAccessToken(): Promise<string> {
  const body = querystring.stringify({
    grantType: 'password',
    secret: process.env.SF_PRODUCTION_CHECK_CODE,
    partnerID: process.env.SF_CUSTOMER_CODE,
  });

  const result = await requestJson({
    url: SF_OAUTH_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const responseBody = result.body as { accessToken?: string };
  if (result.status < 200 || result.status >= 300 || !responseBody.accessToken) {
    throw new Error('Unable to fetch SF access token');
  }

  return responseBody.accessToken;
}

interface CallSfServiceOptions {
  serviceCode: string;
  msgData: Record<string, unknown>;
  accessToken: string;
  url?: string;
}

export async function callSfService(
  options: CallSfServiceOptions
): Promise<Record<string, unknown>> {
  const { serviceCode, msgData, accessToken, url = SF_SERVICE_URL } = options;

  const body = querystring.stringify({
    partnerID: process.env.SF_CUSTOMER_CODE,
    requestID: createRequestId(),
    serviceCode,
    timestamp: Date.now().toString(),
    accessToken,
    msgData: JSON.stringify(msgData),
  });

  const result = await requestJson({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  const responseBody = result.body as { apiResultCode?: string; apiResultData?: string };

  if (result.status < 200 || result.status >= 300) {
    throw new Error('logistics.sfApiError');
  }

  if (responseBody.apiResultCode !== 'A1000') {
    throw new Error('logistics.sfApiError');
  }

  try {
    return JSON.parse(responseBody.apiResultData || '{}') as Record<string, unknown>;
  } catch {
    throw new Error('logistics.invalidSfResponse');
  }
}

export async function downloadPdf(url: string, token: string): Promise<Buffer> {
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { 'X-Auth-token': token },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error('logistics.sfApiError'));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    req.on('error', reject);
    req.end();
  });
}
