import mongoose from 'mongoose';

const { Schema } = mongoose;

const TransferSubSchema = new Schema(
  {
    regDate: { type: Date, default: null },
    regPlace: { type: String, default: null },
    transferOwner: { type: String, default: null },
    transferContact: { type: String, default: null },
    transferRemark: { type: String, default: null },
  },
  { _id: true }
);

const TransferNGOSubSchema = new Schema(
  {
    regDate: { type: Date, default: null },
    regPlace: { type: String, default: null },
    transferOwner: { type: String, default: null },
    UserContact: { type: String, default: null },
    UserEmail: { type: String, default: null },
    transferContact: { type: String, default: null },
    transferRemark: { type: String, default: null },
    isTransferred: { type: Boolean, default: false },
  },
  { _id: true }
);

const PetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    ngoId: { type: String, default: null },
    deleted: { type: Boolean, default: false },
    transfer: { type: [TransferSubSchema], default: [] },
    transferNGO: { type: [TransferNGOSubSchema], default: [] },
  },
  { timestamps: true }
);

export default PetSchema;
