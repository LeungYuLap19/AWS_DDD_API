import type { APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext, logError, parseBody, requireAuthContext } from '@aws-ddd-api/shared';
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

export async function printCloudWaybill({
  event,
  body,
}: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(event);
  try {
    await connectToMongoDB();

    const auth = getAuthContext(event);

    const rateLimitResult = await applyRateLimit({
      action: 'logistics.printCloudWaybill',
      event,
      identifier: auth?.userEmail ?? auth?.userId ?? null,
      limit: 20,
      windowSeconds: 300,
    });
    if (rateLimitResult) return rateLimitResult;

    const parsed = parseBody(body, printCloudWaybillSchema);
    if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

    const { waybillNo } = parsed.data;

    const accessToken = await getAccessToken();
    const apiResultData = await callSfService({
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

    const resultWithSuccess = apiResultData as { success?: boolean; obj?: { files?: Array<{ url: string; token: string }> } };
    if (resultWithSuccess.success === false) {
      return response.errorResponse(500, 'logistics.sfApiError', event);
    }

    const files = resultWithSuccess.obj?.files ?? [];
    if (files.length === 0) {
      return response.errorResponse(500, 'logistics.missingPrintFile', event);
    }

    const file = files[0];
    const pdfBuffer = await downloadPdf(file.url, file.token);

    await sendWaybillEmail({
      to: 'notification@ptag.com.hk',
      subject: `PTag Waybill PDF - ${waybillNo}`,
      waybillNo,
      pdfBuffer,
    });

    return response.successResponse(200, event, { waybillNo });
  } catch (error) {
    logError('Failed to print cloud waybill', {
      scope: 'services.sfWaybill.printCloudWaybill',
      extra: { error },
    });

    const message = (error as { message?: string })?.message ?? '';
    const errorKey = message.startsWith('logistics.') ? message : 'common.internalError';
    return response.errorResponse(500, errorKey, event);
  }
}
