import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  // 'GET /pet/medical/reference/deworm': () => {},

  // 'GET /pet/medical/{petId}/vaccination': () => {},
  // 'POST /pet/medical/{petId}/vaccination': () => {},
  // 'PATCH /pet/medical/{petId}/vaccination/{vaccineId}': () => {},
  // 'DELETE /pet/medical/{petId}/vaccination/{vaccineId}': () => {},

  // General medical records
  'GET /pet/medical/{petId}/general': () => import('./services/medical').then(m => m.handleListMedicalRecords),
  'POST /pet/medical/{petId}/general': () => import('./services/medical').then(m => m.handleCreateMedicalRecord),
  'PATCH /pet/medical/{petId}/general/{medicalId}': () => import('./services/medical').then(m => m.handleUpdateMedicalRecord),
  'DELETE /pet/medical/{petId}/general/{medicalId}': () => import('./services/medical').then(m => m.handleDeleteMedicalRecord),

  // Medication records
  'GET /pet/medical/{petId}/medication': () => import('./services/medication').then(m => m.handleListMedicationRecords),
  'POST /pet/medical/{petId}/medication': () => import('./services/medication').then(m => m.handleCreateMedicationRecord),
  'PATCH /pet/medical/{petId}/medication/{medicationId}': () => import('./services/medication').then(m => m.handleUpdateMedicationRecord),
  'DELETE /pet/medical/{petId}/medication/{medicationId}': () => import('./services/medication').then(m => m.handleDeleteMedicationRecord),

  // Deworming records
  'GET /pet/medical/{petId}/deworming': () => import('./services/deworming').then(m => m.handleListDewormRecords),
  'POST /pet/medical/{petId}/deworming': () => import('./services/deworming').then(m => m.handleCreateDewormRecord),
  'PATCH /pet/medical/{petId}/deworming/{dewormId}': () => import('./services/deworming').then(m => m.handleUpdateDewormRecord),
  'DELETE /pet/medical/{petId}/deworming/{dewormId}': () => import('./services/deworming').then(m => m.handleDeleteDewormRecord),

  // Blood-test records
  'GET /pet/medical/{petId}/blood-test': () => import('./services/bloodTest').then(m => m.handleListBloodTestRecords),
  'POST /pet/medical/{petId}/blood-test': () => import('./services/bloodTest').then(m => m.handleCreateBloodTestRecord),
  'PATCH /pet/medical/{petId}/blood-test/{bloodTestId}': () => import('./services/bloodTest').then(m => m.handleUpdateBloodTestRecord),
  'DELETE /pet/medical/{petId}/blood-test/{bloodTestId}': () => import('./services/bloodTest').then(m => m.handleDeleteBloodTestRecord),
};

export const routeRequest = createRouter(routes, { response });
