import { z } from 'zod';

const optionalString = z.string().optional().nullable();
const optionalBool = z.boolean().optional().nullable();
const optionalFollowUp = z.boolean().optional();

const adoptionFields = z.object({
  postAdoptionName: optionalString,
  isNeutered: optionalBool,
  NeuteredDate: optionalString,
  firstVaccinationDate: optionalString,
  secondVaccinationDate: optionalString,
  thirdVaccinationDate: optionalString,
  followUpMonth1: optionalFollowUp,
  followUpMonth2: optionalFollowUp,
  followUpMonth3: optionalFollowUp,
  followUpMonth4: optionalFollowUp,
  followUpMonth5: optionalFollowUp,
  followUpMonth6: optionalFollowUp,
  followUpMonth7: optionalFollowUp,
  followUpMonth8: optionalFollowUp,
  followUpMonth9: optionalFollowUp,
  followUpMonth10: optionalFollowUp,
  followUpMonth11: optionalFollowUp,
  followUpMonth12: optionalFollowUp,
});

export const adoptionCreateSchema = adoptionFields;
export const adoptionUpdateSchema = adoptionFields;

export type AdoptionCreateBody = z.infer<typeof adoptionCreateSchema>;
export type AdoptionUpdateBody = z.infer<typeof adoptionUpdateSchema>;
