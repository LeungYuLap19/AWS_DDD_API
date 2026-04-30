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
