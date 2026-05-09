import { z } from 'zod';

export const getTokenSchema = z.object({}).strict().optional();

export const getAreaSchema = z
  .object({
    token: z
      .string({ message: 'logistics.validation.tokenRequired' })
      .min(1, { message: 'logistics.validation.tokenRequired' })
      .max(2048, { message: 'logistics.validation.tokenRequired' }),
  })
  .strict();

export const getNetCodeSchema = z
  .object({
    token: z
      .string({ message: 'logistics.validation.tokenRequired' })
      .min(1, { message: 'logistics.validation.tokenRequired' })
      .max(2048, { message: 'logistics.validation.tokenRequired' }),
    typeId: z.union(
      [
        z.string({ message: 'logistics.validation.typeIdRequired' })
          .min(1, { message: 'logistics.validation.typeIdRequired' })
          .max(64, { message: 'logistics.validation.typeIdRequired' }),
        z.number({ message: 'logistics.validation.typeIdRequired' }),
      ],
      { message: 'logistics.validation.typeIdRequired' }
    ),
    areaId: z.union(
      [
        z.string({ message: 'logistics.validation.areaIdRequired' })
          .min(1, { message: 'logistics.validation.areaIdRequired' })
          .max(64, { message: 'logistics.validation.areaIdRequired' }),
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
      .min(1, { message: 'logistics.validation.tokenRequired' })
      .max(2048, { message: 'logistics.validation.tokenRequired' }),
    netCode: z
      .array(
        z.string().trim().min(1).max(64, { message: 'logistics.validation.netCodeListRequired' }),
        { message: 'logistics.validation.netCodeListRequired' }
      )
      .min(1, { message: 'logistics.validation.netCodeListRequired' })
      .max(100, { message: 'logistics.validation.netCodeListRequired' }),
    lang: z.string().trim().max(16, { message: 'common.invalidBodyParams' }).default('en'),
  })
  .strict();

export const createShipmentSchema = z
  .object({
    lastName: z
      .string({ message: 'logistics.validation.lastNameRequired' })
      .trim()
      .min(1, { message: 'logistics.validation.lastNameRequired' })
      .max(100, { message: 'logistics.validation.lastNameRequired' }),
    phoneNumber: z
      .string({ message: 'logistics.validation.phoneNumberRequired' })
      .trim()
      .min(1, { message: 'logistics.validation.phoneNumberRequired' })
      .max(20, { message: 'logistics.validation.phoneNumberRequired' }),
    address: z
      .string({ message: 'logistics.validation.addressRequired' })
      .trim()
      .min(1, { message: 'logistics.validation.addressRequired' })
      .max(500, { message: 'logistics.validation.addressRequired' }),
    count: z.coerce.number().int().positive().max(1000, { message: 'common.invalidBodyParams' }).optional().default(1),
    attrName: z.string().trim().max(200, { message: 'common.invalidBodyParams' }).optional(),
    netCode: z.string().trim().max(64, { message: 'common.invalidBodyParams' }).optional(),
    tempId: z.string().trim().max(64, { message: 'common.invalidBodyParams' }).optional(),
    tempIdList: z.array(z.string().trim().min(1).max(64)).max(100, { message: 'common.invalidBodyParams' }).optional(),
  })
  .strict();

export const printCloudWaybillSchema = z
  .object({
    waybillNo: z
      .string({ message: 'logistics.validation.waybillNoRequired' })
      .trim()
      .min(1, { message: 'logistics.validation.waybillNoRequired' })
      .max(64, { message: 'logistics.validation.waybillNoRequired' }),
  })
  .strict();

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type PrintCloudWaybillInput = z.infer<typeof printCloudWaybillSchema>;
export type GetAreaInput = z.infer<typeof getAreaSchema>;
export type GetNetCodeInput = z.infer<typeof getNetCodeSchema>;
export type GetPickupLocationsInput = z.infer<typeof getPickupLocationsSchema>;
