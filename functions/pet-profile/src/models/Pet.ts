import mongoose from 'mongoose';

const { Schema } = mongoose;

const PetTransferNgoSchema = new Schema(
  {
    regDate: {
      type: Date,
      default: null,
    },
    regPlace: {
      type: String,
      default: null,
    },
    transferOwner: {
      type: String,
      default: null,
    },
    UserContact: {
      type: String,
      default: null,
    },
    UserEmail: {
      type: String,
      default: null,
    },
    transferContact: {
      type: String,
      default: null,
    },
    transferRemark: {
      type: String,
      default: null,
    },
    isTransferred: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

export const PetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId },
    name: { type: String, required: true, default: null },
    breedimage: { type: [String], default: [] },
    birthday: { type: Date, required: true, default: null },
    weight: { type: Number, default: null },
    sex: { type: String, required: true, default: null },
    sterilization: { type: Boolean, default: null },
    sterilizationDate: { type: Date, default: null },
    adoptionStatus: { type: String, default: null },
    animal: { type: String, required: true, default: null },
    breed: { type: String, default: null },
    bloodType: { type: String, default: null },
    features: { type: String, default: null },
    info: { type: String, default: null },
    status: { type: String, default: null },
    owner: { type: String, default: null },
    tagId: { type: String, default: null },
    ownerContact1: { type: Number, default: null },
    ownerContact2: { type: Number, default: null },
    contact1Show: { type: Boolean, default: false },
    contact2Show: { type: Boolean, default: false },
    receivedDate: { type: Date, default: null },
    chipId: { type: String, default: null },
    placeOfBirth: { type: String, default: null },
    transfer: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    transferNGO: {
      type: [PetTransferNgoSchema],
      default: [],
    },
    motherName: { type: String, default: null },
    motherBreed: { type: String, default: null },
    motherDOB: { type: Date, default: null },
    motherChip: { type: String, default: null },
    motherPlaceOfBirth: { type: String, default: null },
    motherParity: { type: Number, default: null },
    fatherName: { type: String, default: null },
    fatherBreed: { type: String, default: null },
    fatherDOB: { type: Date, default: null },
    fatherChip: { type: String, default: null },
    fatherPlaceOfBirth: { type: String, default: null },
    isRegistered: { type: Boolean, default: false },
    eyeimages: { type: [String], default: [] },
    deleted: { type: Boolean, default: false },
    ngoId: { type: String },
    ngoPetId: { type: String, default: null },
    medicationRecordsCount: { type: Number, default: 0 },
    medicalRecordsCount: { type: Number, default: 0 },
    dewormRecordsCount: { type: Number, default: 0 },
    vaccineRecordsCount: { type: Number, default: 0 },
    latestDewormRecords: { type: Date, default: null },
    latestVaccineRecords: { type: Date, default: null },
    locationName: { type: String, default: '' },
    position: { type: String, default: '' },
  },
  { timestamps: true }
);

export default PetSchema;
