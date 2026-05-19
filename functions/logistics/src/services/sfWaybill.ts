import type { APIGatewayProxyResult } from 'aws-lambda';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { sendWaybillEmail } from '../config/mail';
import {
  SF_CLOUD_PRINT_URL,
  callSfService,
  downloadPdf,
  getAccessToken,
} from '../config/sfExpressClient';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { printCloudWaybillSchema } from '../zodSchema/logisticsSchema';

/**
 * Requests a cloud-print waybill PDF from SF Express, downloads the generated
 * file, and emails it to the internal notification inbox.
 */
export async function printCloudWaybill({
  event,
  body,
}: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(body, printCloudWaybillSchema);
  if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

  const { waybillNo } = parsed.data;

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.printCloudWaybill',
    event,
    identifier: null,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  let accessToken: string;
  let apiResultData: Record<string, unknown>;
  try {
    accessToken = await getAccessToken();
    apiResultData = await callSfService({
      serviceCode: 'COM_RECE_CLOUD_PRINT_WAYBILLS',
      accessToken,
      url: SF_CLOUD_PRINT_URL,
      msgData: {
        templateCode: 'fm_150_standard_YCSKUUQ3',
        version: '2.0',
        fileType: 'pdf',
        sync: true,
        documents: [{ masterWaybillNo: waybillNo }],
      },
    });
  } catch {
    return response.errorResponse(502, 'logistics.sfApiError', event);
  }

  const resultWithSuccess = apiResultData as { success?: boolean; obj?: { files?: Array<{ url: string; token: string }> } };
  if (resultWithSuccess.success === false) {
    return response.errorResponse(500, 'logistics.sfApiError', event);
  }

  const files = resultWithSuccess.obj?.files ?? [];
  if (files.length === 0) {
    return response.errorResponse(500, 'logistics.missingPrintFile', event);
  }

  const file = files[0];
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await downloadPdf(file.url, file.token);
  } catch {
    return response.errorResponse(502, 'logistics.sfApiError', event);
  }

  await sendWaybillEmail({
    to: 'notification@ptag.com.hk',
    subject: `PTag Waybill PDF - ${waybillNo}`,
    waybillNo,
    pdfBuffer,
  });

  return response.successResponse(200, event, { message: 'success.created', data: { waybillNo } });
}
