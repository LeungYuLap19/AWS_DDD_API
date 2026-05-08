import { z } from 'zod';

const optionalString = (max: number) =>
  z.string().trim().max(max, 'common.invalidBodyParams').optional().nullable();
const optionalBool = z.boolean().optional().nullable();
const optionalFollowUp = z.boolean().optional();

const adoptionFields = z
  .object({
    postAdoptionName: optionalString(100),
    isNeutered: optionalBool,
    NeuteredDate: optionalString(64),
    firstVaccinationDate: optionalString(64),
    secondVaccinationDate: optionalString(64),
    thirdVaccinationDate: optionalString(64),
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
  })
  .strict();

export const adoptionCreateSchema = adoptionFields;
export const adoptionUpdateSchema = adoptionFields;

export type AdoptionCreateBody = z.infer<typeof adoptionCreateSchema>;
export type AdoptionUpdateBody = z.infer<typeof adoptionUpdateSchema>;
