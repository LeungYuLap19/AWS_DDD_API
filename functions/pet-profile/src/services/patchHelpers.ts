import { parseFlexibleDate } from '../utils/date';
import { HttpError } from '../utils/httpError';
import { patchPetBodySchema } from '../zodSchema/patchPetProfileSchemas';

export type PetDocument = {
  _id: { toString(): string } | string;
  userId?: unknown;
  ngoId?: string;
  ngoPetId?: string | null;
  breedimage?: string[];
  deleted?: boolean;
  [key: string]: unknown;
};

export type MutablePetDocument = PetDocument & {
  save: (options?: Record<string, unknown>) => Promise<void>;
};

export function parseRemovedIndices(rawValue: string | undefined): number[] {
  if (!rawValue) {
    return [];
  }

  let removedIndices: unknown;
  try {
    removedIndices = JSON.parse(rawValue);
  } catch {
    throw new HttpError(400, 'petProfile.errors.invalidRemovedIndices');
  }

  if (
    !Array.isArray(removedIndices) ||
    !removedIndices.every((index) => typeof index === 'number' && Number.isInteger(index))
  ) {
    throw new HttpError(400, 'petProfile.errors.invalidRemovedIndices');
  }

  return removedIndices;
}

export function removeBreedImagesAtIndices(pet: MutablePetDocument, removedIndices: number[]): void {
  if (removedIndices.length === 0) {
    return;
  }

  if (!Array.isArray(pet.breedimage)) {
    pet.breedimage = [];
  }

  const sortedIndices = [...removedIndices].sort((a, b) => b - a);
  for (const index of sortedIndices) {
    if (index >= 0 && index < pet.breedimage.length) {
      pet.breedimage.splice(index, 1);
    }
  }
}

export function applyPatchScalarFields(
  pet: MutablePetDocument,
  data: ReturnType<typeof patchPetBodySchema.parse>
): void {
  if (data.name !== undefined) pet.name = data.name;
  if (data.animal !== undefined) pet.animal = data.animal;
  if (data.birthday !== undefined) pet.birthday = parseFlexibleDate(data.birthday);
  if (data.weight !== undefined) pet.weight = data.weight;
  if (data.sex !== undefined) pet.sex = data.sex;
  if (data.sterilization !== undefined) pet.sterilization = data.sterilization;
  if (data.sterilizationDate !== undefined) pet.sterilizationDate = parseFlexibleDate(data.sterilizationDate);
  if (data.adoptionStatus !== undefined) pet.adoptionStatus = data.adoptionStatus;
  if (data.breed !== undefined) pet.breed = data.breed;
  if (data.bloodType !== undefined) pet.bloodType = data.bloodType;
  if (data.features !== undefined) pet.features = data.features;
  if (data.info !== undefined) pet.info = data.info;
  if (data.status !== undefined) pet.status = data.status;
  if (data.owner !== undefined) pet.owner = data.owner;
  if (data.ownerContact1 !== undefined) pet.ownerContact1 = data.ownerContact1;
  if (data.ownerContact2 !== undefined) pet.ownerContact2 = data.ownerContact2;
  if (data.contact1Show !== undefined) pet.contact1Show = data.contact1Show;
  if (data.contact2Show !== undefined) pet.contact2Show = data.contact2Show;
  if (data.receivedDate !== undefined) pet.receivedDate = parseFlexibleDate(data.receivedDate);
  if (data.location !== undefined) pet.locationName = data.location;
  if (data.position !== undefined) pet.position = data.position;
  if (data.chipId !== undefined) pet.chipId = data.chipId;
  if (data.placeOfBirth !== undefined) pet.placeOfBirth = data.placeOfBirth;
  if (data.motherName !== undefined) pet.motherName = data.motherName;
  if (data.motherBreed !== undefined) pet.motherBreed = data.motherBreed;
  if (data.motherDOB !== undefined) pet.motherDOB = parseFlexibleDate(data.motherDOB);
  if (data.motherChip !== undefined) pet.motherChip = data.motherChip;
  if (data.motherPlaceOfBirth !== undefined) pet.motherPlaceOfBirth = data.motherPlaceOfBirth;
  if (data.motherParity !== undefined) pet.motherParity = data.motherParity;
  if (data.fatherName !== undefined) pet.fatherName = data.fatherName;
  if (data.fatherBreed !== undefined) pet.fatherBreed = data.fatherBreed;
  if (data.fatherDOB !== undefined) pet.fatherDOB = parseFlexibleDate(data.fatherDOB);
  if (data.fatherChip !== undefined) pet.fatherChip = data.fatherChip;
  if (data.fatherPlaceOfBirth !== undefined) pet.fatherPlaceOfBirth = data.fatherPlaceOfBirth;
}
