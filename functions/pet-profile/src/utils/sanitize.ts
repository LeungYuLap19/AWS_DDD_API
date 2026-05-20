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
  'status',
  'ngoPetId',
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

type PublicOwnerContact = {
  ownerEmail?: string | null;
  ownerPhoneNumber?: string | null;
};

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

function coerceNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
  const summaries: AnyRecord[] = [];

  for (const pet of pets) {
    const raw = asPlainRecord(pet);
    if (!raw) {
      continue;
    }

    const sanitized = pickPetFields(raw, LIST_SUMMARY_FIELDS);
    sanitized.isRegistered = typeof raw.isRegistered === 'boolean' ? raw.isRegistered : false;
    sanitized.tagID = raw.tagId ?? null;
    sanitized.medical = coerceNumber(raw.medicalRecordsCount);
    sanitized.medication = coerceNumber(raw.medicationRecordsCount);
    sanitized.deworm = coerceNumber(raw.dewormRecordsCount);
    sanitized.vaccineRecords = coerceNumber(raw.vaccineRecordsCount);
    summaries.push(sanitized);
  }

  return summaries;
}

/** Returns the public tag-lookup projection plus owner contact fields, with missing values normalized to `null`. */
export function sanitizePublicTagLookupPet(pet: unknown, ownerContact: PublicOwnerContact = {}): AnyRecord {
  const raw = asPlainRecord(pet);
  const sanitized: AnyRecord = {};

  for (const field of PUBLIC_TAG_LOOKUP_FIELDS) {
    sanitized[field] = raw?.[field] ?? null;
  }

  sanitized.ownerEmail = ownerContact.ownerEmail ?? null;
  sanitized.ownerPhoneNumber = ownerContact.ownerPhoneNumber ?? null;

  return sanitized;
}
