/**
 * Sanitizes an Order document for API responses.
 * Explicit allowlist — any field not listed here is excluded by default.
 */
export function sanitizeOrder(order: Record<string, unknown>): Record<string, unknown> {
  if (!order) return order;
  const raw = typeof (order as { toObject?: () => Record<string, unknown> }).toObject === 'function'
    ? (order as { toObject: () => Record<string, unknown> }).toObject()
    : { ...order };

  return {
    _id: raw._id,
    isPTagAir: raw.isPTagAir,
    lastName: raw.lastName,
    email: raw.email,
    phoneNumber: raw.phoneNumber,
    address: raw.address,
    paymentWay: raw.paymentWay,
    delivery: raw.delivery,
    tempId: raw.tempId,
    option: raw.option,
    type: raw.type,
    price: raw.price,
    petImg: raw.petImg,
    promotionCode: raw.promotionCode,
    shopCode: raw.shopCode,
    buyDate: raw.buyDate,
    petName: raw.petName,
    petContact: raw.petContact,
    sfWayBillNumber: raw.sfWayBillNumber,
    language: raw.language,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Sanitizes an OrderVerification document for API responses.
 * Explicit allowlist — any field not listed here is excluded by default.
 */
export function sanitizeOrderVerification(ov: Record<string, unknown>): Record<string, unknown> {
  if (!ov) return ov;
  const raw = typeof (ov as { toObject?: () => Record<string, unknown> }).toObject === 'function'
    ? (ov as { toObject: () => Record<string, unknown> }).toObject()
    : { ...ov };

  return {
    _id: raw._id,
    tagId: raw.tagId,
    staffVerification: raw.staffVerification,
    cancelled: raw.cancelled,
    verifyDate: raw.verifyDate,
    petName: raw.petName,
    shortUrl: raw.shortUrl,
    masterEmail: raw.masterEmail,
    qrUrl: raw.qrUrl,
    petUrl: raw.petUrl,
    orderId: raw.orderId,
    pendingStatus: raw.pendingStatus,
    option: raw.option,
    type: raw.type,
    optionSize: raw.optionSize,
    optionColor: raw.optionColor,
    price: raw.price,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
