import mongoose from 'mongoose';

type CounterSyncOptions = {
  petId: string;
  updateLatestDeworm?: boolean;
  updateLatestVaccine?: boolean;
};

/**
 * Rebuilds pet-medical summary counters from authoritative record collections
 * and writes them to the owning Pet document.
 */
export async function syncPetMedicalCounters(options: CounterSyncOptions): Promise<void> {
  const {
    petId,
    updateLatestDeworm = false,
    updateLatestVaccine = false,
  } = options;

  const MedicalRecords = mongoose.model('Medical_Records');
  const MedicationRecords = mongoose.model('Medication_Records');
  const DewormRecords = mongoose.model('Deworm_Records');
  const VaccineRecords = mongoose.model('Vaccine_Records');

  const [medicalCount, medicationCount, dewormCount, vaccineCount] = await Promise.all([
    MedicalRecords.countDocuments({ petId }),
    MedicationRecords.countDocuments({ petId }),
    DewormRecords.countDocuments({ petId }),
    VaccineRecords.countDocuments({ petId, isDeleted: { $ne: true } }),
  ]);

  const setPayload: Record<string, unknown> = {
    medicalRecordsCount: medicalCount,
    medicationRecordsCount: medicationCount,
    dewormRecordsCount: dewormCount,
    vaccineRecordsCount: vaccineCount,
  };

  if (updateLatestDeworm) {
    const latestDeworm = (await DewormRecords.findOne({ petId })
      .sort({ date: -1, _id: -1 })
      .select({ date: 1 })
      .lean()) as { date?: Date | null } | null;
    setPayload.latestDewormRecords = latestDeworm?.date ?? null;
  }

  if (updateLatestVaccine) {
    const latestVaccine = (await VaccineRecords.findOne({
      petId,
      isDeleted: { $ne: true },
    })
      .sort({ vaccineDate: -1, _id: -1 })
      .select({ vaccineDate: 1 })
      .lean()) as { vaccineDate?: Date | null } | null;
    setPayload.latestVaccineRecords = latestVaccine?.vaccineDate ?? null;
  }

  const Pet = mongoose.model('Pet');
  await Pet.findOneAndUpdate({ _id: petId }, { $set: setPayload }, { strict: false });
}
