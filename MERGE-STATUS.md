# Merge record — what came over from `D:\prosys for kashish`

**Complete.** Kept only as a record of the decisions, because several of them aren't
obvious from the code alone. `D:\prosys for kashish` was never modified and stays
dedicated to Kashish.

That app began as a fork of PRO-SYS and then diverged hard: commit `715fc37`,
*"Time-based reminders with web push; drop email and multi-user"*, rewrote it as a
single-user app with no `User` table. This merge brought its improvements back while
taking PRO-SYS the opposite way — into a **multi-user** app.

## What was decided

| Decision | Outcome |
| --- | --- |
| User model | **Multi-user personal**, not family. Everything is scoped by `userId`. |
| Visibility | **Private per user.** Reverses PRO-SYS's old "everyone sees all reminders". |
| Accounts | **Self-registration + admin approval.** Signups land `status: "pending"`. The first account on an empty install is auto-approved as admin. |
| Delivery | **Email *and* push**, chosen per account (`emailOptIn`, `pushOptIn`). |
| Dropped | The Family page and "Notify family" — meaningless once reminders are private. Also `/api/auth/members`, which listed every account to anyone loading the login page. |
| Database | Reset via `prisma db push --force-reset`. No migration history. |

## Six judgement calls worth knowing

1. **Email is throttled; push isn't.** `EMAIL_OVERDUE_MIN_GAP_MINS = 12h` in
   [`lib/dispatch.ts`](lib/dispatch.ts). A push nag *replaces* the previous
   lock-screen notification, so repeating hourly is fine. An inbox has no
   equivalent. Lead and due-time emails are never throttled — only the overdue
   repeats. `Reminder.lastEmailedAt` exists solely for this.

2. **Passkey login uses discoverable credentials.** The fork sent
   `allowCredentials: <every passkey on the install>`, which here would publish
   every credential id to anyone loading the login page. `auth-options` now sends
   none and touches no table; `auth-verify` resolves the account from the credential
   the device chose.

3. **Login is email + PIN, not a name picker.** The old flow listed members to
   choose from. With private reminders, who has an account is not public.

4. **Ownership guards 404, never 403.** See [`lib/ownership.ts`](lib/ownership.ts).
   A 403 would confirm that some other account owns that id.

5. **A push endpoint is reassigned on user switch.** A browser has one endpoint. If
   someone else signs in on a shared device, `/api/push/subscribe` moves the row to
   them and clears any block — the previous owner's block says nothing about the new
   one. Not reassigning would send one person's private reminders to another's
   device.

6. **The localStorage cache is bound to an account.**
   [`lib/cache.ts`](lib/cache.ts) — `setCacheOwner()` wipes it when the identity
   changes, and sign-out clears it. Without that, signing in as someone else on a
   shared laptop would paint the previous person's reminders before the fetch
   replaced them.

An admin also cannot approve, reject, demote or delete **their own** row. That single
rule is why no "is this the last admin?" counting is needed anywhere.

## Verified

`npm run lint` and `npm run build` clean. Live run against the Supabase database:
first-account admin bootstrap, signup → pending → approval → login, reminder CRUD
with lead offsets, date-only reminders taking the account's default time, the
dashboard, the Settings page including the admin queue, and cascade deletes.

Both smoke suites pass (67 assertions) — see the README for how to run them.
