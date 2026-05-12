import mongoose from 'mongoose';
import env from './env';
import PetSchema from '../models/Pet';
import MedicalRecordSchema from '../models/MedicalRecord';
import MedicationRecordSchema from '../models/MedicationRecord';
import DewormRecordSchema from '../models/DewormRecord';
import BloodTestRecordSchema from '../models/BloodTestRecord';
import VaccineRecordSchema from '../models/VaccineRecord';
import AnthelminticSchema from '../models/Anthelmintic';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels(): void {
  if (!mongoose.models.Pet) mongoose.model('Pet', PetSchema, 'pets');
  if (!mongoose.models.Medical_Records)
    mongoose.model('Medical_Records', MedicalRecordSchema, 'medical_records');
  if (!mongoose.models.Medication_Records)
    mongoose.model('Medication_Records', MedicationRecordSchema, 'medication_records');
  if (!mongoose.models.Deworm_Records)
    mongoose.model('Deworm_Records', DewormRecordSchema, 'deworm_records');
  if (!mongoose.models.blood_tests)
    mongoose.model('blood_tests', BloodTestRecordSchema, 'blood_tests');
  if (!mongoose.models.Vaccine_Records)
    mongoose.model('Vaccine_Records', VaccineRecordSchema, 'vaccine_records');
  if (!mongoose.models.Anthelmintic)
    mongoose.model('Anthelmintic', AnthelminticSchema, 'anthelmintic');
}

/**
 * Reuses the warm-container Mongoose connection, registers this Lambda's model
 * set after the connection is ready, and clears the cached promise if the
 * initial connect attempt fails.
 */
export async function connectToMongoDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    registerModels();
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 1,
      })
      .then((connection) => {
        registerModels();
        return connection;
      })
      .catch((error: unknown) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}
