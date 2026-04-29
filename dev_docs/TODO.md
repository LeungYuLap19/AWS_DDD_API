# TODO

- Align soft-delete registration semantics with MongoDB indexes for `users.email` and `users.phoneNumber`.
  Current app logic ignores soft-deleted users during duplicate checks, so re-registration after soft delete is intended to be allowed.
  Live development behavior still returns `auth.registration.user.emailAlreadyRegistered`, which likely means the `users` collection still has global unique indexes that block reuse after soft delete.
  Fix later by reviewing `db.users.getIndexes()` and replacing plain unique indexes with partial unique indexes scoped to `deleted: false` if that is the intended production behavior.

- Reconfirm NGO login/auth flow with frontend and implement the missing login path for existing NGO accounts.
  Current state: `POST /auth/registrations/ngo` returns an NGO token, but existing NGO accounts do not have a confirmed fresh-login path.
  `POST /auth/challenges/verify` currently issues a normal user token for existing users, so an NGO logging in through the shared challenge flow may receive a token without `ngoId` / `ngoName` and fail NGO-protected routes.
  Need frontend confirmation on the intended UX:
  either NGO should use password-based login,
  or NGO should share the same challenge-based auth flow as normal users but receive an NGO token shape on successful verify.
  After frontend confirms, align backend auth behavior and add explicit manual/test coverage for existing NGO login.
