export function sanitizeEyeLog(record: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: record._id,
    petId: record.petId,
    image: record.image,
    eyeSide: record.eyeSide,
    result: record.result,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function sanitizePet(record: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: record.userId,
    name: record.name,
    breedimage: record.breedimage,
    animal: record.animal,
    birthday: record.birthday,
    weight: record.weight,
    sex: record.sex,
    sterilization: record.sterilization,
    sterilizationDate: record.sterilizationDate,
    adoptionStatus: record.adoptionStatus,
    breed: record.breed,
    bloodType: record.bloodType,
    features: record.features,
    info: record.info,
    status: record.status,
    owner: record.owner,
    ngoId: record.ngoId,
    ownerContact1: record.ownerContact1,
    ownerContact2: record.ownerContact2,
    contact1Show: record.contact1Show,
    contact2Show: record.contact2Show,
    tagId: record.tagId,
    isRegistered: record.isRegistered,
    receivedDate: record.receivedDate,
    ngoPetId: record.ngoPetId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    location: record.locationName,
    position: record.position,
  };
}
