import nodemailer from 'nodemailer';
import env from '../config/env';
import { renderTemplate, escapeHtml } from './template';

function createSmtpTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT, 10) || 465,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });
}

interface OrderEmailData {
  lastName: string;
  phoneNumber: string;
  address: string;
  email: string;
  option: string;
  type: string;
  tempId: string;
  petImg: string;
  paymentWay: string;
  shopCode: string;
  delivery: string;
  price: number;
  promotionCode: string;
  petContact: string;
  petName: string;
  optionColor: string;
  optionSize: string;
  isPTagAir: boolean;
}

function buildOrderConfirmationEmail(order: OrderEmailData, newOrderVerificationId: unknown): string {
  const productImageSrc = order.isPTagAir
    ? 'https://petpetclub.s3.ap-southeast-1.amazonaws.com/user-uploads/pets/68e37c919c1c33505d734e28/68e37e919c1c33505d734e33.png'
    : 'https://petpetclub.s3.ap-southeast-1.amazonaws.com/user-uploads/pets/68e37c919c1c33505d734e28/68e37c919c1c33505d734e2a.png';

  const optionNameMain = order.isPTagAir ? 'Ptag' : order.option;
  const optionNameSuffixHtml = order.isPTagAir
    ? ' <span style="color:#65A8FB; font-weight:400;">Air</span>'
    : '';

  const optionSizeRowHtml = order.optionSize
    ? `<tr><td style="color:#969696; font-size:18px;"><img src="https://petpetclub.s3.ap-southeast-1.amazonaws.com/user-uploads/pets/68de55a8d0f07572c59344be/68e6640b0dea8b9a98db1558.png" alt="Check" width="20" height="20" style="display:inline;" /> ${escapeHtml(order.optionSize)} 毫米</td></tr>`
    : '';

  const printContentLabel = order.isPTagAir ? 'Ptag Air' : 'Ptag';
  const unitPrice = typeof order.price === 'number' ? order.price : parseFloat(String(order.price)) || 0;
  const totalPrice = unitPrice + 50;
  const petImageSrc =
    order.petImg ||
    'https://petpetclub.s3.ap-southeast-1.amazonaws.com/user-uploads/pets/68e37c919c1c33505d734e28/68e37ec59c1c33505d734e38.png';

  const confirmationLink = `https://www.ptag.com.hk/ptag-air/confirmation?qr=${String(newOrderVerificationId)}`;

  return renderTemplate('order-confirmation-email.html', {
    ORDER_ID: order.tempId,
    OPTION_DISPLAY: order.isPTagAir ? 'PTagAir' : order.option,
    PRODUCT_IMAGE_SRC: productImageSrc,
    OPTION_NAME_MAIN: optionNameMain,
    OPTION_NAME_SUFFIX_HTML: optionNameSuffixHtml,
    OPTION_SIZE_ROW_HTML: optionSizeRowHtml,
    OPTION_COLOR_VALUE: order.optionColor || '白色',
    PRINT_CONTENT_LABEL: printContentLabel,
    PET_NAME: order.petName,
    PET_IMAGE_SRC: petImageSrc,
    LAST_NAME: order.lastName,
    PHONE_NUMBER: order.phoneNumber || '',
    DELIVERY: order.delivery,
    ADDRESS: order.address,
    PAYMENT_WAY: order.paymentWay,
    UNIT_PRICE: String(unitPrice),
    TOTAL_PRICE: String(totalPrice),
    CONFIRMATION_LINK: confirmationLink,
  });
}

/**
 * Sends a purchase order confirmation email to the customer.
 * Non-fatal — caller wraps in try/catch.
 */
export async function sendOrderEmail(
  to: string,
  subject: string,
  order: OrderEmailData,
  cc: string,
  newOrderVerificationId: unknown
): Promise<void> {
  const html = buildOrderConfirmationEmail(order, newOrderVerificationId);
  await createSmtpTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    cc,
    subject,
    html,
  });
}


