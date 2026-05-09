type SanitizableUser =
  | Record<string, unknown>
  | { toObject: () => Record<string, unknown> }
  | null
  | undefined;

type SanitizableRecord =
  | Record<string, unknown>
  | { toObject: () => Record<string, unknown> }
  | null
  | undefined;

function toRawRecord(record: SanitizableRecord) {
  if (!record) {
    return record;
  }

  return typeof record.toObject === 'function' ? record.toObject() : record;
}

/** Removes sensitive/internal fields from the user profile payload returned by NGO routes. */
export function sanitizeUser(user: SanitizableUser) {
  if (!user) {
    return user;
  }

  const rawUser = toRawRecord(user);
  const {
    password,
    deleted,
    credit,
    vetCredit,
    eyeAnalysisCredit,
    bloodAnalysisCredit,
    __v,
    createdAt,
    updatedAt,
    ...safeUser
  } = rawUser;
  return safeUser;
}

/** Removes internal bookkeeping fields from NGO profile payloads. */
export function sanitizeNgo(ngo: SanitizableRecord) {
  if (!ngo) {
    return ngo;
  }

  const rawNgo = toRawRecord(ngo);
  const {
    __v,
    createdAt,
    updatedAt,
    ...safeNgo
  } = rawNgo;

  return safeNgo;
}

/** Removes internal bookkeeping fields from NGO membership payloads. */
export function sanitizeNgoUserAccess(access: SanitizableRecord) {
  if (!access) {
    return access;
  }

  const rawAccess = toRawRecord(access);
  const {
    __v,
    createdAt,
    updatedAt,
    ...safeAccess
  } = rawAccess;

  return safeAccess;
}

/** Removes internal bookkeeping fields from NGO counter payloads. */
export function sanitizeNgoCounters(counter: SanitizableRecord) {
  if (!counter) {
    return counter;
  }

  const rawCounter = toRawRecord(counter);
  const {
    __v,
    createdAt,
    updatedAt,
    ...safeCounter
  } = rawCounter;

  return safeCounter;
}
