declare const require: (moduleName: string) => any;

type NodemailerTransport = {
  sendMail: (options: {
    from: string | undefined;
    to: string;
    subject: string;
    html: string;
    attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
  }) => Promise<unknown>;
};

const nodemailer = require('nodemailer') as {
  createTransport: (options: {
    host: string | undefined;
    port: number;
    secure: boolean;
    auth: { user: string | undefined; pass: string | undefined };
  }) => NodemailerTransport;
};

export async function sendWaybillEmail(params: {
  to: string;
  subject: string;
  waybillNo: string;
  pdfBuffer: Buffer;
}): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PTag | Waybill ${params.waybillNo}</title>
      </head>
      <body style="margin:0;padding:0;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;color:#050505;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center">
              <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background:white;margin:20px 0;">
                <tr>
                  <td style="padding:20px;">
                    <h1 style="margin:0 0 16px 0;font-size:32px;">PTag</h1>
                    <p style="margin:0 0 12px 0;">Hello,</p>
                    <p style="margin:0 0 12px 0;">Please find the attached waybill PDF for <strong>${params.waybillNo}</strong>.</p>
                    <p style="margin:0;">Best regards,<br/>PTag</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: params.to,
    subject: params.subject,
    html,
    attachments: [
      {
        filename: `Waybill_${params.waybillNo}.pdf`,
        content: params.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}
