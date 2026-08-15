# M10 — the security review

**Build Specification §10, reviewed against the code as it stands.**

> §10: "This system holds a concentration of sensitive personal data — identity
> documents, photographs, addresses, dates of birth and firearm licences — for
> **guests as well as members**. Nigerian data protection obligations apply and
> are being confirmed with counsel. Build to the requirements below in the
> meantime."

This is a review, not a checklist. Each of §10's eight requirements is stated,
then what the code actually does, then what is **outstanding** — because a
security document that only lists what was done is a document that reads as a
pass when it is not.

The short version: the requirements that are about *shape* are met and are
enforced by construction. The ones that are about *infrastructure* — encryption
at rest, object storage, off-site backup — cannot be met by this repository and
are outstanding on the hosting decision. They are listed as blockers, not as
notes.

---

## 1. Encryption — "TLS in transit. Encryption at rest for database and object storage."

**In transit.** Every outbound call this codebase makes is `https://`
(`src/server/paystack.ts`), and the application is served over TLS by the
platform. Nothing here downgrades or pins.

**At rest — OUTSTANDING, and it is a hosting decision.** The application cannot
encrypt its own database volume. This is met by choosing a managed Postgres with
encryption at rest enabled, and the §2 hosting decision ("region with low latency
to Nigeria, managed platform preferred over self-managed") is still open.

> **Blocker for launch.** Record the provider and the encryption-at-rest setting
> in the go-live sheet. A default is not evidence; the setting is.

---

## 2. Document access — "Licence scans readable only by the founder role. Not by range officers. Not on the desk or lane surfaces."

**Met, and enforced by the shape of the type rather than by a permission check.**

`PackLicence` in `src/offline/daypack.ts` carries status, calibres and expiry —
everything `MAY_USE_OWN_FIREARM` needs — and **has no `documentUrl` field at
all**. A day pack containing a licence scan does not compile.

The server side matches: `daypack-query.ts` does not select `document_url`, and
`LicenceRow` has nowhere to put it.

Because the pack arrives as JSON and TypeScript is not there when it does,
`assertNoRestrictedFields()` walks an incoming pack at runtime and rejects it
outright if a forbidden key appears at any depth.

`PackPerson` likewise omits `address`, `dateOfBirth`, `notes` and the emergency
contact. The emergency contact is the interesting omission: it is not needed to
check somebody in, only when there is an incident — a moment where fetching one
record is entirely acceptable and far better than holding every member's next of
kin on a device in a public building.

**Outstanding:** no object storage is configured in this repository, so there is
no signed-URL path to review yet. See §5 below.

---

## 3. No shared logins — "Every staff action attributable to a named person. Device-bound sessions with a short local unlock."

**Met.** Two factors, neither sufficient alone:

- `POST /api/auth/staff/unlock` requires `requireDevice` **first** — a registered,
  unrevoked tablet — and then a PIN. The route's own comment states why the order
  matters: without the device check the endpoint is an oracle for grinding
  six-digit PINs against every officer in the club from anywhere on the internet.
- Offline, `src/offline/officer.ts` derives a PBKDF2 verifier **in the browser**
  at the moment of a successful online unlock. The day pack therefore carries no
  `staff_users.pin_hash`, and a stolen tablet exposes at most the last officer to
  sign in on it.
- Three wrong PINs offline and the tablet requires a connection. The shift expires
  after twelve hours; only an online unlock creates another.

**Reviewed at M9 and noted:** the staff session **bearer token** is now kept on
the device (`OfficerShift.sessionToken`) so §6.6's dashboard can authenticate as
a named person. It lives in `armory-device`, which revocation destroys, and it
expires with the server session. This is a deliberate widening of what a tablet
holds and it is the one in this review.

**Outstanding:** PIN length and rotation policy are the club's to set. Six digits
with a five-attempt server lockout is what `staff-session.ts` implements.

---

## 4. Device revocation — "A lost or stolen tablet can be revoked server-side, and its cached day pack rendered unusable on next launch."

**Met, with a bounded offline grace period that is a deliberate trade.**

- The day pack response carries the server's verdict on the requesting device.
  `revoked: true` triggers `wipeLocalState()`, which deletes every database in
  `LOCAL_DATABASES` (`src/offline/revoke.ts`). **A test asserts the contents of
  that list** — adding a store without adding it there would leave data on a
  revoked device while revocation still reported success.
- A registration is trusted offline for **seven days** since the server last
  confirmed it, with a warning from day four. The reasoning is recorded in
  `device.ts`: a device that trusts its cache forever works indefinitely in a
  thief's hands; one that demands a live check closes the range during an
  ordinary power cut. Wrong in the safe direction — refusing a legitimate device
  costs one phone call, trusting a stolen one costs every member's address.
- Stale devices are **refused, not wiped**. They may be legitimate and merely cut
  off, and wiping would destroy an unsynced afternoon of custody events. Only an
  explicit "revoked" wipes.
- The clock is not trusted: `device.ts` keeps a high-water mark, so winding a
  stale tablet backwards does not restore it. Step 33 of
  `docs/M1_offline_acceptance.md` tests this on hardware.

**~~Outstanding: revocation has no founder-facing button.~~ Closed.**

`src/server/armory/devices.ts`, `POST /api/devices/:id` and the Tablets panel on
the dashboard. A founder revokes with a reason, from the screen §12 already
requires them to open every morning — no settings area to find while somebody is
telling them a tablet is missing.

Two decisions in it are worth knowing about:

- **The token is destroyed, not flagged.** Setting `revoked_at` alone would be
  enough for the wipe, since the sync endpoints check it. The hash is cleared as
  well so the credential matches no row at all — the protection then does not
  depend on every future endpoint author remembering to check a condition.
- **Restore is not undo.** By the time a mislaid tablet is found it has very
  likely already wiped itself, so restore clears the flag and the tablet still
  needs a fresh token (`reissue`, a separate act, refused while the device is
  revoked). Presenting it as undo would leave a founder holding a tablet that
  claims to be registered and shows nothing.

---

## 5. Guest data — "A guest who does not join has provided data for a single visit. A defined retention position is required from counsel; build the deletion path now."

**The path is built. The retention period is still with counsel.**

The model is right: §3.1 makes applicant, guest and member states of one person,
so there is no separate guest table to forget about, and `guest_visit_summary`
counts visits across all hosts rather than per host.

**~~The deletion path does not exist.~~ Built.** `src/domain/erasure.ts` (the
policy, pure and tested) and `src/server/armory/erasure.ts` (the write), reached
through `GET`/`POST /api/people/:id/erase`.

It is redaction, not deletion, and it could not have been anything else: a
guest's `participations`, `waiver_signatures` and `rounds` are append-only and
rejected for DELETE at the database level, and `people` is referenced with
`ON DELETE RESTRICT`. So the identifying columns are cleared in place and
`anonymised_at` is stamped — a column M0 added for exactly this. The activity
survives as rows belonging to somebody nobody can identify.

Three guards refuse, each about an obligation that outlives the request: a live
membership, a firearm still recorded as issued to them (§3.4's log names a
counterparty), and a firearm they own on the register.

**Money owed deliberately does NOT refuse.** A data-protection request is not a
debt-collection instrument, and the charge survives erasure as a row against an
anonymised person — the club can still see the number, it just cannot ring them
about it. That is a judgement worth a second opinion, and it is tested by name.

**A guard worth knowing about:** a test compares `IDENTIFYING_FIELDS` and
`RETAINED_FIELDS` against the real Drizzle columns of `people`, so a column
added in two years that nobody classified fails the build rather than being
silently left populated by an erasure that reports success.

> **Still blocked on counsel:** the retention PERIOD.
> `club_settings.guest_retention_days` is null, and null means the automatic
> sweep finds nobody — erasing on a guessed schedule is the one mistake here
> that cannot be undone. Erasure on request works today, which is the obligation
> with a deadline. The waiver signature's own retention period is a separate
> question for counsel.

---

## 6. Backup — "Automated daily off-site. A restore must be performed and documented BEFORE launch."

**OUTSTANDING.** The protocol is written — `docs/M10_restore_rehearsal.md` — and
has not been executed, because it needs the hosting decision and a real off-site
artefact.

> **Blocker for launch**, and §10 phrases it as a prohibition rather than a task:
> *a backup never restored is a hope.*

---

## 7. Rate limiting — "On OTP request and on the guest token endpoint."

**Met on both, plus the two §10 does not name.**

- `src/server/rate-limit.ts` is the shared limiter.
- OTP request: limited. The guest token endpoint (`/api/visit/[token]`,
  `/visit/[token]`): limited — and the token itself is 256 bits from a CSPRNG and
  is **stored hashed**, so the limit is a backstop rather than the only defence.
- The staff unlock is limited by the device check plus a server-side lockout after
  five failures, which is the stronger control for that endpoint.

**Outstanding, and the code says so itself.** `rate-limit.ts` opens by stating
what it is not: *"a fixed-window counter held in module memory… NOT a distributed
rate limiter, and it must not be mistaken for one. On a serverless or edge host,
each cold start gets its own empty map, and concurrent instances do not share
counts."*

That candour is the right disposition and it does not discharge the requirement.
The consequences differ by endpoint:

- **Guest token** — acceptable as-is. The real defence is 256 bits of entropy in
  a hashed token; the limiter is a backstop against noise.
- **OTP** — **not acceptable on a multi-instance deployment.** §9 calls SMS "the
  front door to every account", and a limit that multiplies by the instance count
  is a limit an attacker walks through by arriving twice.

The module names the fix: the real protection belongs in front of the
application, at the CDN or WAF. Record the instance count and the CDN rule at
go-live. One instance and no rule is defensible; several instances and no rule is
the blocker below.

---

## 8. Audit — "Append-only, covering every gated action and every override."

**Met, and enforced at the database.**

- `audit_log` rejects UPDATE, DELETE and TRUNCATE (`drizzle/0002`), and
  `scripts/enforcement.test.sql` proves it against a live database.
- An override with no reason is rejected by the database, not merely by
  application code — so an audit row that claims an override always carries the
  sentence the officer typed.
- **Blocks are audited, not only successes.** The reasoning is in
  `src/server/armory/record.ts`: §4.3 says a member must never first learn of a
  problem at the desk in front of their guest, and the only way to know whether
  that is happening is to have a record of every block the desk ever showed. This
  is why a refusal still commits.
- Overrides reach the founder within the day (§12) through `/api/dashboard`.

**Outstanding:** nothing structural. The audit log has no retention policy, which
is correct until counsel sets one.

---

## Findings outside §10's list

Recorded because a review that only answers the questions it was given is not a
review.

**A dependency audit has not been run in this document.** `npm audit` is a
one-line check and belongs in CI rather than in prose; it is listed in the
go-live sheet.

**The Paystack webhook answers 200 on internal failure.** This is deliberate and
argued in the route: a non-2xx makes Paystack retry with backoff and eventually
**disable the webhook**, and losing the endpoint is worse than losing one event —
every payment is recoverable through §9's reconciliation job, and a disabled
webhook is not recoverable at all.

**~~Outstanding: schedule the reconciliation sweep.~~ Built.**
`src/server/armory/reconcile.ts`, reachable at `POST /api/payments/reconcile` by
a scheduler holding `CRON_SECRET` or by a founder with a staff session. The
founder path exists because the sweep is also the answer to "a member says they
paid and it is not showing", asked at a counter and needing an answer now.

The job **decides nothing**: for each stale payment it asks Paystack and acts on
the answer. Not paid stays pending — an abandoned checkout is not a failure the
club should assert. Unreachable is reported and retried, and the summary line
never lets a run that confirmed nothing read like a clean sweep.

Writing it surfaced a defect that would have made the sweep useless: the obvious
implementation calls `recordGatewayPayment`, which inserts — and the pending row
**already holds that `gateway_reference`**, so the insert would conflict, do
nothing, and report a recovery that credited nobody. Recovery settles the
existing row instead (`settlePendingPayment`, guarded on `status = 'pending'`).

> **Still requires a human:** setting `CRON_SECRET` and adding the schedule on
> the hosting platform. The endpoint is safe at any frequency — the guard makes
> two schedulers, or a scheduler racing the webhook, produce one credit.

**Two webhook endpoints share one Paystack account.** `/api/paystack/webhook`
(bookings) and `/api/armory/paystack/webhook` (the club). Paystack allows one
URL per account, so **only one is reachable at a time** and the club must
configure whichever it is running. Both verify the signature on the raw body
before parsing and both ignore events whose metadata they do not recognise.

**Signature images are held on the tablet with no uploader.** Recorded in
`docs/M1_offline_acceptance.md`: the key is derived at signing and travels in the
row, the bytes stay in `armory-session` until there is somewhere to send them.
Between signing and upload the key names an object that does not exist. The bytes
are durable throughout — that is what the second step-9 line on the acceptance
sheet checks — but **object storage is outstanding** and this is the workflow
waiting on it.

---

## Launch blockers, in one list

Three of the original seven were engineering work and are closed. The four that
remain are decisions or acts outside this repository — which is the honest shape
of a pre-launch list, and the reason none of them can be closed by writing more
code.

| # | Blocker | Owner | Status |
| --- | --- | --- | --- |
| 1 | Encryption at rest, confirmed and recorded | Hosting decision | **open** |
| 2 | Restore rehearsal executed and signed (`M10_restore_rehearsal.md`) | Founder + engineering | **open** — protocol written, not run |
| 3 | Object storage configured; licence scans, photographs and signature images off the application database | Hosting decision | **open** |
| 4 | OTP rate limiting shared across instances, or one instance confirmed | Hosting decision | **open** |
| 5 | Founder-facing device revocation control | Engineering | closed |
| 6 | Guest data redaction path built | Engineering | closed — retention period still with counsel |
| 7 | Payment reconciliation sweep | Engineering | closed — `CRON_SECRET` and a schedule still needed |

**One consequence of closing #6 is worth carrying forward.** Erasure clears
`photo_url` and `document_url` from the database and cannot delete the objects
they point at, because there is no object storage yet. `erasedObjectKeys()`
returns exactly what will need deleting, so the list does not have to be
reconstructed later from a table that no longer holds the URLs — but until #3
lands, an erased person's photograph still exists in whatever bucket the club
eventually configures. **Whoever closes #3 owns closing that.**

Reviewed by: \_\_\_\_\_\_\_\_\_\_\_\_\_\_ Date: \_\_\_\_\_\_\_\_ Against commit: \_\_\_\_\_\_\_\_
