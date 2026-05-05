import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleCreateMedicalRecord,
  handleDeleteMedicalRecord,
  handleListMedicalRecords,
  handleUpdateMedicalRecord,
} from './services/medical';
import {
  handleCreateMedicationRecord,
  handleDeleteMedicationRecord,
  handleListMedicationRecords,
  handleUpdateMedicationRecord,
} from './services/medication';
import {
  handleCreateDewormRecord,
  handleDeleteDewormRecord,
  handleListDewormRecords,
  handleUpdateDewormRecord,
} from './services/deworming';
import {
  handleCreateBloodTestRecord,
  handleDeleteBloodTestRecord,
  handleListBloodTestRecords,
  handleUpdateBloodTestRecord,
} from './services/bloodTest';

const routes: Record<string, RouteHandler> = {
  // General medical records
  'GET /pet/medical/{petId}/general': handleListMedicalRecords,
  'POST /pet/medical/{petId}/general': handleCreateMedicalRecord,
  'PATCH /pet/medical/{petId}/general/{medicalId}': handleUpdateMedicalRecord,
  'DELETE /pet/medical/{petId}/general/{medicalId}': handleDeleteMedicalRecord,

  // Medication records
  'GET /pet/medical/{petId}/medication': handleListMedicationRecords,
  'POST /pet/medical/{petId}/medication': handleCreateMedicationRecord,
  'PATCH /pet/medical/{petId}/medication/{medicationId}': handleUpdateMedicationRecord,
  'DELETE /pet/medical/{petId}/medication/{medicationId}': handleDeleteMedicationRecord,

  // Deworming records
  'GET /pet/medical/{petId}/deworming': handleListDewormRecords,
  'POST /pet/medical/{petId}/deworming': handleCreateDewormRecord,
  'PATCH /pet/medical/{petId}/deworming/{dewormId}': handleUpdateDewormRecord,
  'DELETE /pet/medical/{petId}/deworming/{dewormId}': handleDeleteDewormRecord,

  // Blood-test records
  'GET /pet/medical/{petId}/blood-test': handleListBloodTestRecords,
  'POST /pet/medical/{petId}/blood-test': handleCreateBloodTestRecord,
  'PATCH /pet/medical/{petId}/blood-test/{bloodTestId}': handleUpdateBloodTestRecord,
  'DELETE /pet/medical/{petId}/blood-test/{bloodTestId}': handleDeleteBloodTestRecord,
};

export const routeRequest = createRouter(routes, { response });
