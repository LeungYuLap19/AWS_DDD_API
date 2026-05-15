import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Legacy `animal_list` collection used by the public breed reference lookup.
 * The API reads the nested `breeds[animalType][lang]` payload directly.
 */
export const AnimalSchema = new Schema(
  {
    breeds: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { collection: 'animal_list' }
);

export default AnimalSchema;
