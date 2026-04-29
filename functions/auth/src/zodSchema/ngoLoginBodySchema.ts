import { z } from 'zod';

export const ngoLoginBodySchema = z.object({
  email: z.string('auth.login.ngo.invalidEmailFormat').email('auth.login.ngo.invalidEmailFormat'),
  password: z.string('auth.login.ngo.paramsMissing').min(1, 'auth.login.ngo.paramsMissing'),
});
