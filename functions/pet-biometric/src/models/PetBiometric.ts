import mongoose from 'mongoose';

const { Schema } = mongoose;

const EmbeddingItemSchema = new Schema(
  {
    angle: { type: String, required: true },
    embedding: { type: [Number], required: true, default: [] },
  },
  { _id: false }
);

/**
 * One-document-per-pet Face ID store.
 *
 * The public contract intentionally keeps enrollment data in a single
 * `pet_biometrics` document so GET/DELETE are simple DB operations and verify
 * can load all candidate embeddings by `petId`.
 */
const PetBiometricSchema = new Schema(
  {
    petId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    petType: { type: String, required: true, enum: ['cat', 'dog'] },
    imageKeys: { type: [String], default: [] },
    embeddings: { type: [EmbeddingItemSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default PetBiometricSchema;
