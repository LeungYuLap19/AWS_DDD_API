import env from './env';

declare const require: (moduleName: string) => any;

type SmtpTransporter = {
  sendMail: (options: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }) => Promise<unknown>;
};

const nodemailer = require('nodemailer') as {
  createTransport: (options: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }) => SmtpTransporter;
};

export const smtpTransporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT),
  secure: Number(env.SMTP_PORT) === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
}) {
  return smtpTransporter.sendMail({
    from: env.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}
