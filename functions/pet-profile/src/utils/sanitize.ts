type AnyRecord = Record<string, unknown>;

const PRIVATE_DETAIL_FIELDS = [
  'userId',
  'name',
  'breedimage',
  'animal',
  'birthday',
  'weight',
  'sex',
  'sterilization',
  'sterilizationDate',
  'adoptionStatus',
  'breed',
  'bloodType',
  'features',
  'info',
  'status',
  'owner',
  'ngoId',
  'ownerContact1',
  'ownerContact2',
  'contact1Show',
  'contact2Show',
  'tagId',
  'isRegistered',
  'receivedDate',
  'ngoPetId',
  'createdAt',
  'updatedAt',
  'locationName',
  'position',
  'chipId',
  'placeOfBirth',
  'transfer',
  'transferNGO',
  'motherName',
  'motherBreed',
  'motherDOB',
  'motherChip',
  'motherPlaceOfBirth',
  'motherParity',
  'fatherName',
  'fatherBreed',
  'fatherDOB',
  'fatherChip',
  'fatherPlaceOfBirth',
];

const LIST_SUMMARY_FIELDS = [
  'name',
  'breedimage',
  'animal',
  'birthday',
  'weight',
  'sex',
  'sterilization',
  'adoptionStatus',
  'breed',
  'status',
  'receivedDate',
  'ngoPetId',
  'createdAt',
  'updatedAt',
  'locationName',
  'position',
];

const PUBLIC_TAG_LOOKUP_FIELDS = [
  'name',
  'breedimage',
  'animal',
  'birthday',
  'weight',
  'sex',
  'sterilization',
  'breed',
  'features',
  'info',
  'status',
  'receivedDate',
];

function asPlainRecord(value: unknown): AnyRecord | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value !== null && 'toObject' in value && typeof (value as { toObject?: unknown }).toObject === 'function') {
    return ((value as { toObject(): AnyRecord }).toObject());
  }

  return value as AnyRecord;
}

function pickPetFields(raw: AnyRecord, fields: string[]): AnyRecord {
  const sanitized: AnyRecord = {};

  for (const field of fields) {
    if (field === 'locationName') {
      sanitized.location = raw.locationName;
      continue;
    }

    if (raw[field] !== undefined) {
      sanitized[field] = raw[field];
    }
  }

  return sanitized;
}

export function sanitizePetDetail(pet: unknown): AnyRecord | null {
  const raw = asPlainRecord(pet);
  if (!raw) {
    return null;
  }

  return pickPetFields(raw, PRIVATE_DETAIL_FIELDS);
}

export function sanitizePetListSummary(pets: unknown[]): AnyRecord[] {
  return pets
    .map((pet) => {
      const raw = asPlainRecord(pet);
      return raw ? pickPetFields(raw, LIST_SUMMARY_FIELDS) : null;
    })
    .filter((pet): pet is AnyRecord => Boolean(pet));
}

export function sanitizePublicTagLookupPet(pet: unknown): AnyRecord {
  const raw = asPlainRecord(pet);
  const sanitized: AnyRecord = {};

  for (const field of PUBLIC_TAG_LOOKUP_FIELDS) {
    sanitized[field] = raw?.[field] ?? null;
  }

  return sanitized;
}
