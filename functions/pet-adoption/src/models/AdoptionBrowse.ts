import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Public adoption browse listing document.
 * Sourced from an external adoption feed stored in the ADOPTION_MONGODB_URI database.
 */
const AdoptionBrowseSchema = new Schema({
  Name: { type: String },
  Age: { type: Number },
  Sex: { type: String },
  Breed: { type: String },
  Animal_Type: { type: String },
  Remark: { type: String },
  Image_URL: { type: String },
  URL: { type: String },
  AdoptionSite: { type: String },
  Creation_Date: { type: String },
});

export default AdoptionBrowseSchema;
