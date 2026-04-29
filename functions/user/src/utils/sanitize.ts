type SanitizableUser =
  | Record<string, unknown>
  | { toObject: () => Record<string, unknown> }
  | null
  | undefined;

export function sanitizeUser(user: SanitizableUser) {
  if (!user) {
    return user;
  }

  const rawUser = typeof user.toObject === 'function' ? user.toObject() : user;
  const { password, ...safeUser } = rawUser;
  return safeUser;
}
