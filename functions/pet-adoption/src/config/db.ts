import mongoose from 'mongoose';
import env from './env';
import PetSchema from '../models/Pet';
import PetAdoptionSchema from '../models/PetAdoption';
import AdoptionBrowseSchema from '../models/AdoptionBrowse';

let defaultConnPromise: Promise<typeof mongoose> | null = null;
let mainConnPromise: Promise<mongoose.Connection> | null = null;
let browseConnPromise: Promise<mongoose.Connection> | null = null;

/**
 * Initialises the default mongoose connection so shared utilities that register
 * models on the global instance (e.g. the rate limiter) have a live connection.
 */
export async function connectDefaultDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  if (!defaultConnPromise) {
    defaultConnPromise = mongoose
      .connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 1,
      })
      .catch((error: unknown) => {
        defaultConnPromise = null;
        throw error;
      });
  }

  return defaultConnPromise;
}

/**
 * Connects to the main petpetclub database.
 * Registers Pet and pet_adoptions models on the returned connection.
 */
export async function connectMainDB(): Promise<mongoose.Connection> {
  if (!mainConnPromise) {
    mainConnPromise = mongoose
      .createConnection(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 1,
      })
      .asPromise()
      .then((conn) => {
        conn.models.Pet || conn.model('Pet', PetSchema, 'pets');
        conn.models.pet_adoptions ||
          conn.model('pet_adoptions', PetAdoptionSchema, 'pet_adoptions');
        return conn;
      })
      .catch((error: unknown) => {
        mainConnPromise = null;
        throw error;
      });
  }

  return mainConnPromise;
}

/**
 * Connects to the public adoption browse database (ADOPTION_MONGODB_URI).
 * Registers the Adoption model on the returned connection.
 */
export async function connectBrowseDB(): Promise<mongoose.Connection> {
  if (!browseConnPromise) {
    browseConnPromise = mongoose
      .createConnection(env.ADOPTION_MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 1,
      })
      .asPromise()
      .then((conn) => {
        conn.models.Adoption || conn.model('Adoption', AdoptionBrowseSchema, 'adoption_list');
        return conn;
      })
      .catch((error: unknown) => {
        browseConnPromise = null;
        throw error;
      });
  }

  return browseConnPromise;
}
