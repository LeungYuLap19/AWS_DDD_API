import fs from 'fs';
import path from 'path';
import type { APIGatewayProxyResult } from 'aws-lambda';
import nodemailer from 'nodemailer';
import { requireRole, parseBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';
import { ptagDetectionEmailSchema } from '../zodSchema/commandsSchema';

function createSmtpTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

let templateCache: string | null = null;

function resolvePtagDetectionTemplatePath(): string {
  const candidatePaths = [
    path.join(__dirname, '..', '..', 'static', 'ptag-detection-email.html'),
    path.join(__dirname, 'static', 'ptag-detection-email.html'),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error('Missing ptag detection email template');
}

function renderPtagDetectionEmail(
  petName: string,
  tagId: string,
  dateTime: string,
  locationURL: string
): string {
  if (!templateCache) {
    const templatePath = resolvePtagDetectionTemplatePath();
    templateCache = fs.readFileSync(templatePath, 'utf8');
  }

  return templateCache
    .replace(/\{\{PET_NAME\}\}/g, escapeHtml(petName))
    .replace(/\{\{TAG_ID\}\}/g, escapeHtml(tagId))
    .replace(/\{\{DATE_TIME\}\}/g, escapeHtml(dateTime))
    .replace(/\{\{LOCATION_URL\}\}/g, escapeHtml(locationURL));
}

/**
 * POST /commerce/commands/ptag-detection-email
 * Admin/developer-only — sends a PTag detection location alert to the pet owner.
 * Legacy: POST /purchase/send-ptag-detection-email (purchaseConfirmation)
 */
export async function handleSendPtagDetectionEmail(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, ['admin', 'developer']);

  const parsed = parseBody(ctx.body, ptagDetectionEmailSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const { name, tagId, dateTime, locationURL, email } = parsed.data;

  const html = renderPtagDetectionEmail(name, tagId, dateTime, locationURL);

  try {
    await createSmtpTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      cc: 'notification@ptag.com.hk',
      subject: `PTag | 您的寵物 ${name} (${tagId}) 最新位置更新 | Your pet ${name} (${tagId}) Latest location update`,
      html,
    });
  } catch {
    return response.errorResponse(503, 'fulfillment.errors.emailServiceUnavailable', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.created',
  });
}
