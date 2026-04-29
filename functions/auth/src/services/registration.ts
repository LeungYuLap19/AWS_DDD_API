import type { APIGatewayProxyResult } from 'aws-lambda';
import { getFirstZodIssueMessage, isTrue } from '@aws-ddd-api/shared';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ngoRegistrationBodySchema } from '../zodSchema/ngoRegistrationBodySchema';
import { userRegistrationBodySchema } from '../zodSchema/userRegistrationBodySchema';
import { normalizeEmail, normalizePhone } from '../utils/normalize';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  buildRefreshCookie,
  createRefreshToken,
  issueNgoAccessToken,
  issueUserAccessToken,
} from '../utils/token';

const VERIFICATION_WINDOW_MS = 10 * 60 * 1000;

async function hasRecentVerificationProof(email?: string, phoneNumber?: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - VERIFICATION_WINDOW_MS);

  if (email) {
    const EmailVerificationCode = mongoose.model('EmailVerificationCode');
    const record = await EmailVerificationCode.findOne({
      _id: email,
      consumedAt: { $gte: cutoff },
    }).lean();
    if (record) return true;
  }

  if (phoneNumber) {
    const SmsVerificationCode = mongoose.model('SmsVerificationCode');
    const record = await SmsVerificationCode.findOne({
      _id: phoneNumber,
      consumedAt: { $gte: cutoff },
    }).lean();
    if (record) return true;
  }

  return false;
}

async function consumeVerificationProofs(email?: string, phoneNumber?: string) {
  if (email) {
    const EmailVerificationCode = mongoose.model('EmailVerificationCode');
    await EmailVerificationCode.deleteOne({ _id: email }).catch(() => undefined);
  }

  if (phoneNumber) {
    const SmsVerificationCode = mongoose.model('SmsVerificationCode');
    await SmsVerificationCode.deleteOne({ _id: phoneNumber }).catch(() => undefined);
  }
}

export async function handleUserRegistration(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = userRegistrationBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.registration.user',
    event: ctx.event,
    limit: 12,
    windowSeconds: 10 * 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const {
    firstName,
    lastName,
    phoneNumber,
    email,
    subscribe,
    promotion,
    district,
    image,
    birthday,
    gender,
  } = parsed.data;
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhoneNumber = normalizePhone(phoneNumber);

  const hasVerificationProof = await hasRecentVerificationProof(normalizedEmail, normalizedPhoneNumber);
  if (!hasVerificationProof) {
    return response.errorResponse(403, 'auth.registration.user.verificationRequired', ctx.event);
  }

  const User = mongoose.model('User');
  const duplicateFilters = [
    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ...(normalizedPhoneNumber ? [{ phoneNumber: normalizedPhoneNumber }] : []),
  ];

  if (duplicateFilters.length > 0) {
    const existingUser = await User.findOne({
      $or: duplicateFilters,
      deleted: false,
    }).lean() as { email?: string; phoneNumber?: string } | null;

    if (existingUser) {
      const errorKey =
        normalizedPhoneNumber && existingUser.phoneNumber === normalizedPhoneNumber
          ? 'auth.registration.user.phoneAlreadyRegistered'
          : 'auth.registration.user.emailAlreadyRegistered';

      return response.errorResponse(409, errorKey, ctx.event);
    }
  }

  let newUser;
  try {
    newUser = await User.create({
      firstName,
      lastName,
      phoneNumber: normalizedPhoneNumber || undefined,
      email: normalizedEmail || undefined,
      role: 'user',
      verified: true,
      subscribe: isTrue(subscribe),
      promotion: promotion ?? false,
      district: district ?? null,
      image: image ?? null,
      birthday: birthday ?? null,
      gender: gender ?? '',
      deleted: false,
      credit: 300,
      vetCredit: 300,
      eyeAnalysisCredit: 300,
      bloodAnalysisCredit: 300,
    });
  } catch (error) {
    const mongoError = error as {
      code?: number;
      keyValue?: Record<string, unknown>;
      keyPattern?: Record<string, unknown>;
    };

    if (mongoError.code === 11000) {
      const duplicateField = Object.keys(mongoError.keyPattern || {})[0];
      const duplicateKeyValue = Object.values(mongoError.keyValue || {})[0];
      const errorKey =
        duplicateField === 'phoneNumber' ||
        (typeof duplicateKeyValue === 'string' && duplicateKeyValue === normalizedPhoneNumber)
          ? 'auth.registration.user.phoneAlreadyRegistered'
          : 'auth.registration.user.emailAlreadyRegistered';

      return response.errorResponse(409, errorKey, ctx.event);
    }

    throw error;
  }

  const user = newUser.toObject() as {
    _id: { toString(): string };
    email?: string;
    role?: string;
  };

  const token = issueUserAccessToken(user);
  const { token: refreshToken } = await createRefreshToken(user._id);

  await consumeVerificationProofs(normalizedEmail, normalizedPhoneNumber);

  return response.successResponse(201, ctx.event, {
    message: 'auth.registration.user.createSuccessful',
    userId: user._id,
    role: user.role,
    isVerified: true,
    token,
  }, {
    'Set-Cookie': buildRefreshCookie(refreshToken, ctx.event),
  });
}

export async function handleNgoRegistration(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = ngoRegistrationBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.registration.ngo',
    event: ctx.event,
    limit: 8,
    windowSeconds: 10 * 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const {
    firstName,
    lastName,
    phoneNumber,
    email,
    password,
    ngoName,
    description,
    website,
    address,
    businessRegistrationNumber,
    ngoPrefix,
    subscribe,
  } = parsed.data;
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhoneNumber = normalizePhone(phoneNumber);

  const User = mongoose.model('User');
  const NGO = mongoose.model('NGO');
  const NgoUserAccess = mongoose.model('NgoUserAccess');
  const NgoCounters = mongoose.model('NgoCounters');

  const existingUser = await User.findOne({
    email: normalizedEmail,
    deleted: false,
  }).lean() as { _id: unknown } | null;
  if (existingUser) {
    return response.errorResponse(409, 'auth.registration.user.emailAlreadyRegistered', ctx.event);
  }

  const existingUserWithPhone = await User.findOne({
    phoneNumber: normalizedPhoneNumber,
    deleted: false,
  }).lean() as { _id: unknown } | null;
  if (existingUserWithPhone) {
    return response.errorResponse(409, 'auth.registration.user.phoneAlreadyRegistered', ctx.event);
  }

  const existingNgo = await NGO.findOne({
    registrationNumber: businessRegistrationNumber,
  }).lean() as { _id: unknown } | null;
  if (existingNgo) {
    return response.errorResponse(409, 'auth.registration.ngo.businessRegistrationAlreadyRegistered', ctx.event);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const [newUser] = await User.create([{
      firstName,
      lastName,
      email: normalizedEmail,
      password: hashedPassword,
      phoneNumber: normalizedPhoneNumber,
      role: 'ngo',
      verified: true,
      subscribe: isTrue(subscribe),
      promotion: false,
      district: null,
      image: null,
      birthday: null,
      deleted: false,
      credit: 300,
      vetCredit: 300,
      eyeAnalysisCredit: 300,
      bloodAnalysisCredit: 300,
      gender: '',
    }], { session });

    const [newNgo] = await NGO.create([{
      name: ngoName,
      description,
      email: normalizedEmail,
      phone: normalizedPhoneNumber,
      website,
      address: {
        street: address.street ?? '',
        city: address.city ?? '',
        state: address.state ?? '',
        zipCode: address.zipCode ?? '',
        country: address.country ?? '',
      },
      registrationNumber: businessRegistrationNumber,
      establishedDate: new Date(),
      categories: [],
      isVerified: true,
      isActive: true,
    }], { session });

    const [newNgoUserAccess] = await NgoUserAccess.create([{
      ngoId: newNgo._id,
      userId: newUser._id,
      roleInNgo: 'admin',
      assignedPetIds: [],
      menuConfig: {},
      isActive: true,
    }], { session });

    const [newNgoCounter] = await NgoCounters.create([{
      ngoId: newNgo._id,
      counterType: 'ngopet',
      ngoPrefix: ngoPrefix.toUpperCase(),
    }], { session });

    await session.commitTransaction();

    const token = issueNgoAccessToken(newUser, newNgo);
    const { token: refreshToken } = await createRefreshToken(newUser._id);

    return response.successResponse(201, ctx.event, {
      message: 'auth.registration.ngo.createSuccessful',
      userId: newUser._id,
      role: newUser.role,
      isVerified: true,
      token,
      ngoId: newNgo._id,
      ngoUserAccessId: newNgoUserAccess._id,
      ngoCounterId: newNgoCounter._id,
    }, {
      'Set-Cookie': buildRefreshCookie(refreshToken, ctx.event),
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    const mongoError = error as {
      code?: number;
      keyValue?: Record<string, unknown>;
      keyPattern?: Record<string, unknown>;
    };

    if (mongoError.code === 11000) {
      const duplicateField = Object.keys(mongoError.keyPattern || {})[0];
      const duplicateKeyValue = Object.values(mongoError.keyValue || {})[0];

      if (duplicateField === 'registrationNumber') {
        return response.errorResponse(409, 'auth.registration.ngo.businessRegistrationAlreadyRegistered', ctx.event);
      }

      if (
        duplicateField === 'phoneNumber' ||
        (typeof duplicateKeyValue === 'string' && duplicateKeyValue === normalizedPhoneNumber)
      ) {
        return response.errorResponse(409, 'auth.registration.user.phoneAlreadyRegistered', ctx.event);
      }

      return response.errorResponse(409, 'auth.registration.user.emailAlreadyRegistered', ctx.event);
    }

    throw error;
  } finally {
    session.endSession();
  }
}
