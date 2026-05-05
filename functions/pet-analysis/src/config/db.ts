import mongoose from 'mongoose';
import env from './env';
import PetSchema from '../models/Pet';
import UserSchema from '../models/User';
import EyeAnalysisRecordSchema from '../models/EyeAnalysisRecord';
import EyeDiseaseSchema from '../models/EyeDisease';
import ImageCollectionSchema from '../models/ImageCollection';
import ApiLogSchema from '../models/ApiLog';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels(): void {
	if (!mongoose.models.Pet) mongoose.model('Pet', PetSchema, 'pets');
	if (!mongoose.models.User) mongoose.model('User', UserSchema, 'users');
	if (!mongoose.models.EyeAnalysisRecord)
		mongoose.model('EyeAnalysisRecord', EyeAnalysisRecordSchema, 'eyeanalysisrecords');
	if (!mongoose.models.EyeDiseaseList)
		mongoose.model('EyeDiseaseList', EyeDiseaseSchema, 'eye_diseases');
	if (!mongoose.models.ImageCollection)
		mongoose.model('ImageCollection', ImageCollectionSchema, 'image_collections');
	if (!mongoose.models.ApiLog) mongoose.model('ApiLog', ApiLogSchema, 'api_logs');
}

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
