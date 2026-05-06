type RawDocument = Record<string, unknown>;

function pickFields(source: RawDocument, allowedFields: string[]): RawDocument {
  return allowedFields.reduce<RawDocument>((acc, field) => {
    if (source[field] !== undefined) {
      acc[field] = source[field];
    }
    return acc;
  }, {});
}

export function sanitizeOrderVerification(entity: RawDocument | null | undefined): RawDocument | null | undefined {
  if (!entity) return entity;
  const raw = typeof (entity as { toObject?: () => RawDocument }).toObject === 'function'
    ? (entity as { toObject: () => RawDocument }).toObject()
    : entity;

  return pickFields(raw, [
    '_id',
    'tagId',
    'staffVerification',
    'contact',
    'verifyDate',
    'tagCreationDate',
    'petName',
    'shortUrl',
    'masterEmail',
    'qrUrl',
    'petUrl',
    'orderId',
    'location',
    'petHuman',
    'pendingStatus',
    'option',
    'type',
    'optionSize',
    'optionColor',
    'price',
    'createdAt',
    'updatedAt',
  ]);
}

export function sanitizeOrder(entity: RawDocument | null | undefined): RawDocument | null | undefined {
  if (!entity) return entity;
  const raw = typeof (entity as { toObject?: () => RawDocument }).toObject === 'function'
    ? (entity as { toObject: () => RawDocument }).toObject()
    : entity;

  return pickFields(raw, [
    '_id',
    'tempId',
    'lastName',
    'phoneNumber',
    'petContact',
    'sfWayBillNumber',
    'language',
  ]);
}
