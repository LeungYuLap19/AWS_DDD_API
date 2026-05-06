import { z } from 'zod';

export const getTokenSchema = z.object({}).strict().optional();

export const getAreaSchema = z
  .object({
    token: z
      .string({ message: 'logistics.validation.tokenRequired' })
      .min(1, { message: 'logistics.validation.tokenRequired' }),
  })
  .strict();

export const getNetCodeSchema = z
  .object({
    token: z
      .string({ message: 'logistics.validation.tokenRequired' })
      .min(1, { message: 'logistics.validation.tokenRequired' }),
    typeId: z.union(
      [
        z.string({ message: 'logistics.validation.typeIdRequired' }).min(1, {
          message: 'logistics.validation.typeIdRequired',
        }),
        z.number({ message: 'logistics.validation.typeIdRequired' }),
      ],
      { message: 'logistics.validation.typeIdRequired' }
    ),
    areaId: z.union(
      [
        z.string({ message: 'logistics.validation.areaIdRequired' }).min(1, {
          message: 'logistics.validation.areaIdRequired',
        }),
        z.number({ message: 'logistics.validation.areaIdRequired' }),
      ],
      { message: 'logistics.validation.areaIdRequired' }
    ),
  })
  .strict();

export const getPickupLocationsSchema = z
  .object({
    token: z
      .string({ message: 'logistics.validation.tokenRequired' })
      .min(1, { message: 'logistics.validation.tokenRequired' }),
    netCode: z
      .array(z.string().min(1), { message: 'logistics.validation.netCodeListRequired' })
      .min(1, { message: 'logistics.validation.netCodeListRequired' }),
    lang: z.string().default('en'),
  })
  .strict();

export const createShipmentSchema = z
  .object({
    lastName: z
      .string({ message: 'logistics.validation.lastNameRequired' })
      .min(1, { message: 'logistics.validation.lastNameRequired' }),
    phoneNumber: z
      .string({ message: 'logistics.validation.phoneNumberRequired' })
      .min(1, { message: 'logistics.validation.phoneNumberRequired' }),
    address: z
      .string({ message: 'logistics.validation.addressRequired' })
      .min(1, { message: 'logistics.validation.addressRequired' }),
    count: z.coerce.number().int().positive().optional().default(1),
    attrName: z.string().optional(),
    netCode: z.string().optional(),
    tempId: z.string().optional(),
    tempIdList: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const printCloudWaybillSchema = z
  .object({
    waybillNo: z
      .string({ message: 'logistics.validation.waybillNoRequired' })
      .min(1, { message: 'logistics.validation.waybillNoRequired' }),
  })
  .strict();

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type PrintCloudWaybillInput = z.infer<typeof printCloudWaybillSchema>;
export type GetAreaInput = z.infer<typeof getAreaSchema>;
export type GetNetCodeInput = z.infer<typeof getNetCodeSchema>;
export type GetPickupLocationsInput = z.infer<typeof getPickupLocationsSchema>;
