# Plan — account types (solo / family) + dedicated admin panel

Agreed 2026-08-03, to be implemented from 2026-08-04. Nothing in here is built yet.

## Decisions taken

| Question | Decision |
| --- | --- |
| Account types | **`solo`** and **`family`**. Each person keeps their own login either way — a family links several accounts, it is not a shared login. |
| Family sharing | **Two lists: "Mine" and "Family."** A personal list stays fully private; a family list is visible to every member. The list is chosen when the reminder is created. |
| Forming a family | The **head creates the family and shares a join code.** Whoever enters the code raises a join request; the head approves it. The install admin is not in the loop day to day. |
| Family notifications | **Per-reminder audience:** `owner` (just me), `assignee`, or `family` (everyone). |
| Admin panel | All four areas: **accounts & approvals, family management, system health & delivery, audit log.** |
| Admin visibility | **Full read access.** Admins can read any account's reminder content, and create/edit/dissolve any family. Decided 2026-08-03 in preference to debuggability over the privacy guarantee. |
| Membership | **Multiple families per person** — join table, not a single `familyId`. |
| Dissolving a family | **Blocked while family reminders exist.** Head must clear or move them first. No data decision, no destructive path. |
| Existing accounts | Become `solo`. Nothing they own changes. |

### Consequence of full admin read access

The app currently tells users *"Your reminders are private to this account"* (Settings)
and the README says nobody else can see them, "admins included". Both become false.
Copy must change to state plainly that an admin can view reminder content — shipping
a privacy promise the app doesn't keep is worse than not promising it. Ownership
guards still 404 for **non-admins**; admin access goes through `jsonAdmin` only, and
every admin read of another account's data writes an `ActivityLog` row.

## Prerequisite

Production is currently down: `DATABASE_URL` is missing or quoted in the Vercel
environment, so every DB route falls back to `127.0.0.1:5432`. Fix and redeploy
before starting — otherwise nothing built tomorrow can be verified.

The database is **empty** (test data was cleared), so schema changes can go in with
`prisma db push --force-reset` again rather than a migration. Confirm that's still
true before running it — if real accounts exist by then, this becomes a migration
with backfill (`accountType = 'solo'` for everyone, `audience = 'owner'` on every
existing reminder).

---

## 1. Schema

### New: `Family`

```prisma
model Family {
  id       String @id @default(uuid())
  name     String
  /// Short, human-shareable code. Rotatable by the head, so a leaked code can be
  /// retired without dissolving the family.
  joinCode String @unique

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members       FamilyMember[]
  reminders     Reminder[]
  categories    Category[]
  joinRequests  FamilyJoinRequest[]
}
```

### New: `FamilyMember` (because membership is many-to-many)

A person can be in several families at once, so there is no `User.familyId`. The head
is the member whose `role` is `head` — no separate `Family.headId`, which would only
be a second source of truth to keep in sync.

```prisma
model FamilyMember {
  id       String @id @default(uuid())
  familyId String
  family   Family @relation(fields: [familyId], references: [id], onDelete: Cascade)
  userId   String
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     String @default("member") // head | member
  joinedAt DateTime @default(now())

  @@unique([familyId, userId])
  @@index([userId])
}
```

**Every scope check becomes `familyId IN (my family ids)`**, not a single equality.
That set is read once per request from the session user's memberships. A helper —
`familyIdsFor(userId)` — must be the only way it's obtained, so no route can forget.

### New: `FamilyJoinRequest`

```prisma
model FamilyJoinRequest {
  id        String   @id @default(uuid())
  familyId  String
  family    Family   @relation(fields: [familyId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  status    String   @default("pending") // pending | approved | rejected
  createdAt DateTime @default(now())
  decidedAt DateTime?

  @@unique([familyId, userId])
  @@index([familyId, status])
}
```

### New: `DispatchRun`

Needed by the health page: the cron currently returns a summary and stores nothing,
so there is no way to answer "is delivery working?" after the fact.

```prisma
model DispatchRun {
  id        String   @id @default(uuid())
  ranAt     DateTime @default(now())
  durationMs Int
  considered Int
  fired      Json    // { lead, due, overdue }
  pushesSent Int
  pushesFailed Int
  emailsSent Int
  error      String?

  @@index([ranAt])
}
```

Prune to the last ~500 rows inside the dispatcher so this can't grow unbounded.

### `User` — additions

```prisma
/// Declared intent, chosen at signup: solo hides every family surface in the UI.
/// Actual membership lives in FamilyMember; this only controls what's offered.
/// Convertible either way.
accountType String @default("solo") // solo | family

families          FamilyMember[]
joinRequests      FamilyJoinRequest[]
assignedReminders Reminder[] @relation("AssignedReminders")
```

### `Reminder` — additions

```prisma
/// null = personal, private to userId. Set = on the family's shared list.
familyId String?
family   Family? @relation(fields: [familyId], references: [id], onDelete: Cascade)

/// Who is responsible. Only meaningful on a family reminder.
assignedToId String?
assignedTo   User?  @relation("AssignedReminders", fields: [assignedToId], references: [id])

/// Who gets alerted: owner | assignee | family
audience String @default("owner")

@@index([familyId, status, dueAt])
```

`userId` stays as the **creator/owner** in both cases.

### `Category` — scope becomes either/or

A family needs its own category list, and a member must be able to have a personal
"Bills" and a family "Bills" without collision.

- `userId` becomes **nullable**; add nullable `familyId`.
- Exactly one is set: personal (`userId`) or family (`familyId`). Enforce in app code.
- Keep `@@unique([userId, name])`, add `@@unique([familyId, name])`. Postgres treats
  NULLs as distinct, so the two constraints don't interfere.
- Seed the eight defaults per user as now, and again per family on creation.

### `ReminderDispatch` — dedupe becomes per recipient

A family reminder now has several recipients, so the current unique key would let the
first recipient's row suppress everyone else's.

```prisma
userId String        // the recipient this row is about
user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
/// Set when this recipient was emailed, which is what the 12h overdue-email
/// throttle now reads. Replaces Reminder.lastEmailedAt.
emailedAt DateTime?

@@unique([reminderId, userId, cycleDueAt, kind, offsetMin])
```

Then **drop `Reminder.lastEmailedAt`** — throttling becomes per person, which is what
it should have been. `Reminder.lastNaggedAt` **stays** on the reminder: whether
something is overdue is a fact about the reminder, not about who is being told.

### `ActivityLog` — put it to work

It exists and is written by nothing. Rename `userId` → `actorId`, add
`entityId String?`, `detail Json?`, and `@@index([timestamp])`.

---

## 2. lib layer

**`lib/recipients.ts` (new)** — the one place that answers "who hears about this?"

```
audience "owner"    -> [reminder.userId]
audience "assignee" -> [assignedToId ?? userId]
audience "family"   -> every active member of familyId
```

Then filter to `status: "active"` and apply each recipient's own `emailOptIn` /
`pushOptIn`. Every fan-out decision lives here so it can be unit-tested and can't
drift between the dispatcher and the badge count.

**`lib/dispatch.ts`** — the largest change. Today it is one reminder → one owner.
It becomes one reminder → N recipients:

- Include `family.members` and `assignedTo` in the candidate query.
- Loop recipients inside the per-fire loop; claim a `ReminderDispatch` row per
  recipient before sending.
- Email throttle reads the newest `ReminderDispatch.emailedAt` for
  `(reminderId, userId)`.
- Write a `DispatchRun` row at the end, and prune old ones.
- Keep it idempotent — that property is what the smoke suite exists to protect.

**`lib/ownership.ts`** — extend from "is it yours?" to the matrix below. Keep
returning **404, not 403**, for anything not visible.

**`lib/audit.ts` (new)** — `record(actorId, action, entity, entityId?, detail?)`.
Called from approvals, role changes, deletions, family joins, login. Must never throw
into the caller: an audit failure shouldn't fail the action.

**`lib/push.ts`** — `countOutstanding(userId)` must now count personal reminders plus
family reminders where that user is a recipient, or the app badge will disagree with
what the person can actually see.

### Permission matrix

| Action | Personal reminder | Family reminder |
| --- | --- | --- |
| See | creator only | any member of the family |
| Create | anyone (own list) | any member, into the family list |
| Edit / delete | creator | creator **or** family head |
| Complete / snooze | creator | creator, assignee, **or** head |
| Change audience / assignee | n/a | creator or head |

Family head powers to build: approve/reject join requests, remove a member, rotate
the join code, rename the family, hand over headship, dissolve the family. A head
cannot remove themselves without handing over first — same rule that protects the
install admin from locking everyone out.

---

## 3. API

**Families** (members and heads)
- `POST /api/families` — create; caller becomes head, `accountType` → `family`, seeds default categories
- `GET /api/families/mine` — the family, members, pending requests (head only sees requests)
- `PATCH /api/families/mine` — rename, rotate join code, hand over headship *(head)*
- `DELETE /api/families/[id]` — dissolve *(head)*; **409 while any family reminder still exists**, listing the count. Head clears or moves them first. Nothing destructive, no orphan rules.
- `POST /api/families/join` — submit a join code → creates a `FamilyJoinRequest`
- `GET/PATCH /api/families/mine/requests/[id]` — approve/reject *(head)*
- `DELETE /api/families/mine/members/[id]` — remove a member *(head)*

**Reminders** — extend `sanitizeReminderInput` with `familyId`, `assignedToId`,
`audience`, all validated against the caller's own family. `familyId` must never be
accepted as an arbitrary value from the body: check membership, exactly as
`assertOwnedCategory` does today.

**Admin** (`jsonAdmin` on all of these)
- `GET /api/admin/overview` — counts, pending approvals, families, health summary
- `GET /api/admin/health` — SMTP/VAPID/cron configured; recent `DispatchRun` rows; push failure counts by device
- `POST /api/admin/health/test` — send a test push/email to the admin themselves
- `GET/POST/PATCH/DELETE /api/admin/families` — full family management
- `GET /api/admin/audit` — paginated, filterable by actor and action
- Extend existing `/api/users` with search, filtering and PIN reset

**`/api/auth/register`** — accept an account type, and optionally a join code so
someone can sign up straight into a family (still subject to admin approval first,
then the head's approval to join).

---

## 4. UI

**Signup** — add the solo/family choice, and for family either "create a new family"
or "enter a join code". Keep the fresh-install admin bootstrap path working.

**Reminders page** — a **Mine / Family** switch at the top for family accounts (solo
accounts never see it). In the form: which list, assignee, and audience — the last
two only shown for family reminders. Family reminders in the list should show who
they're assigned to.

**Settings → Family** (new card, family accounts only) — family name, join code with
copy and rotate, member list, pending join requests with approve/reject, leave family.

**`/admin` (new route group)**, admin only, nav entry visible only to admins:
- `/admin` — overview tiles, and anything currently red
- `/admin/accounts` — the approval queue and account management, **moved out of Settings**
- `/admin/families` — families, members, heads
- `/admin/health` — SMTP/VAPID/cron status, recent dispatch runs, device failures, test buttons
- `/admin/audit` — the log, filterable

Gate the layout on `useApp().isAdmin` with a redirect, but treat the **API as the real
boundary** — there's no middleware, so a client-side check is presentation only.

Keep the pending-approvals badge in the sidebar, pointing at `/admin` instead of
Settings.

---

## 5. Tests and docs

**`scripts/smoke-security.mjs`** — add the new highest-risk surface: **cross-family
isolation.** Two families, and assert that neither can read, edit, complete, snooze or
assign the other's reminders; that a family member can't see another member's
*personal* list; that a non-head can't approve join requests, remove members or rotate
the code; that `familyId` and `assignedToId` can't be forged through the request body;
and that a removed member immediately loses access.

**`scripts/smoke-dispatch.mjs`** — add per-recipient dedupe (each family member gets
exactly one alert per fire), the three audience modes, and the per-recipient email
throttle.

**Docs** — README gets the two account types and the family model; DEPLOY gets nothing
new; MERGE-STATUS stays as the historical record of the previous merge.

---

## 6. Suggested order

1. Fix the Vercel `DATABASE_URL` and redeploy — verify the app is healthy first
2. Schema + `prisma db push --force-reset`, regenerate the client
3. `lib/recipients.ts`, `lib/audit.ts`, then the `lib/dispatch.ts` fan-out
4. `lib/ownership.ts` matrix + reminder/category route scoping
5. Family API, then the admin API
6. UI: signup → reminders Mine/Family → Settings → Family → `/admin`
7. Extend both smoke suites; `npm run lint`, `npm run build`
8. Verify live, then commit straight to `main`

Steps 2–4 are the risky half: the dispatcher and the scoping rules are where a quiet
bug means either silence or a privacy leak. Steps 5–6 are volume, not danger.

## Open questions for tomorrow

1. **Dissolving a family** — delete its reminders, or hand them to the head as
   personal ones? The plan assumes delete-with-warning.
2. **Can one person be in two families?** The plan assumes no — one `familyId` per
   account. Multi-family means a join table and a "current family" selector.
3. **Should a solo account be convertible to family later** (and back)? Straightforward
   in this model — set `accountType` and join or create — but worth confirming it's
   wanted, and what happens to personal reminders on conversion (proposal: they stay
   personal, nothing moves).
4. **Does an admin need to see family reminder *content*** for support? Assumed no.
