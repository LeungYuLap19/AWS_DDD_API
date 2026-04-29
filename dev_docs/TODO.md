# TODO

- Align soft-delete registration semantics with MongoDB indexes for `users.email` and `users.phoneNumber`.
  Current app logic ignores soft-deleted users during duplicate checks, so re-registration after soft delete is intended to be allowed.
  Live development behavior still returns `auth.registration.user.emailAlreadyRegistered`, which likely means the `users` collection still has global unique indexes that block reuse after soft delete.
  Fix later by reviewing `db.users.getIndexes()` and replacing plain unique indexes with partial unique indexes scoped to `deleted: false` if that is the intended production behavior.
