type AnyRecord = Record<string, unknown>;

const BASIC_FIELDS = [
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
];

// Lineage and transfer records — legacy PetDetailInfo equivalent.
const LINEAGE_FIELDS = [
  'chipId',
  'placeOfBirth',
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
  'transfer',
  'transferNGO',
];

const FULL_FIELDS = [...BASIC_FIELDS, ...LINEAGE_FIELDS];

const LIST_SUMMARY_FIELDS = [
  '_id',
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
  'isRegistered',
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

  if (
    typeof value === 'object' &&
    value !== null &&
    'toObject' in value &&
    typeof (value as { toObject?: unknown }).toObject === 'function'
  ) {
    return (value as { toObject(): AnyRecord }).toObject();
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

/** Returns the standard owner-facing basic pet projection used by list/detail reads. */
export function sanitizePetBasic(pet: unknown): AnyRecord | null {
  const raw = asPlainRecord(pet);
  if (!raw) return null;
  return pickPetFields(raw, BASIC_FIELDS);
}

/** Returns only lineage, parentage, and transfer-related fields for detail views. */
export function sanitizePetLineage(pet: unknown): AnyRecord | null {
  const raw = asPlainRecord(pet);
  if (!raw) return null;
  return pickPetFields(raw, LINEAGE_FIELDS);
}

/** Returns the full owner-facing pet projection used by authenticated detail reads. */
export function sanitizePetFull(pet: unknown): AnyRecord | null {
  const raw = asPlainRecord(pet);
  if (!raw) return null;
  return pickPetFields(raw, FULL_FIELDS);
}

/** Kept for patch responses; always returns the full owner-facing projection. */
export function sanitizePetDetail(pet: unknown): AnyRecord | null {
  return sanitizePetFull(pet);
}

/** Returns the compact pet-card projection used by paginated list responses. */
export function sanitizePetListSummary(pets: unknown[]): AnyRecord[] {
  return pets
    .map((pet) => {
      const raw = asPlainRecord(pet);
      return raw ? pickPetFields(raw, LIST_SUMMARY_FIELDS) : null;
    })
    .filter((pet): pet is AnyRecord => Boolean(pet));
}

/** Returns the public tag-lookup projection with missing fields normalized to `null`. */
export function sanitizePublicTagLookupPet(pet: unknown): AnyRecord {
  const raw = asPlainRecord(pet);
  const sanitized: AnyRecord = {};

  for (const field of PUBLIC_TAG_LOOKUP_FIELDS) {
    sanitized[field] = raw?.[field] ?? null;
  }

  return sanitized;
}
