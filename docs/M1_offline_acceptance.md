# M1 — the offline acceptance test

**Build Specification §8.5. This document is the protocol; it is not the evidence.**

> **Pull the power. Do not simulate it.**
>
> On a real tablet, with no network: check in a member and a guest, sign a waiver,
> issue a serialised firearm and forty rounds, record two scores, then pull the
> power mid-session.
>
> Restore power. Reopen. Every record must be present. Reconnect. Every record must
> reach the server exactly once.
>
> This test is the definition of done for the offline layer. Browser devtools
> offline mode does not substitute for it and must not be accepted as evidence.

§11 adds the scheduling consequence: *"M1 should be demonstrated with a real
workflow and a real power cut before M2 begins. If it cannot be, the schedule is
wrong and it is better to know in week five than in month four."*

---

## Why devtools offline mode is not accepted

Worth stating plainly, because the temptation is real and the substitution looks
harmless.

`Network > Offline` in devtools fails every request immediately with a clean
network error. That is not the failure this system is built for. §1.1 says the power
and the internet are unreliable, and the interesting failures are the ones that are
not clean:

| What devtools does | What a range floor does |
| --- | --- |
| `fetch` rejects at once | `fetch` hangs for 30s behind a captive portal, then rejects |
| IndexedDB transactions all commit | a `relaxed` transaction is acknowledged and lost when the OS dies |
| the page keeps running | the renderer is killed mid-`await`, between two writes |
| storage persists | the browser evicts the origin under pressure |
| the clock is correct | the tablet comes back from a dead battery in 1970 |

The two rows in the middle are the ones this milestone exists to survive, and
neither is reachable from a devtools checkbox. `durability: "strict"` in
`src/offline/db.ts` is there for exactly one of them, and the only way to know it
works is to cut the power to hardware.

---

## Before the run

Equipment:

- The **actual tablet model being purchased**. §12 is explicit: the one-second
  Today render is measured "on the actual tablet model being purchased". A
  developer laptop with the wifi off proves nothing about either number.
- A **serialised firearm** in the register, or a dummy with a serial recorded in it.
- An **ammunition lot** with at least 40 rounds remaining.
- A way to **physically interrupt power**: pull the charger and hold the hardware
  power button, or pull the battery if the model allows it. Not a software restart.
  Not "close the app".

State:

1. `npm run db:migrate` has been applied, including `0003_device_tokens`.
2. `npm run db:prove` passes — the append-only triggers from `0002` reject update
   and delete at the database level, which §12 requires and which nothing else
   checks.
3. `npm run db:seed` has been run. It creates §2.1's volume — a hundred members, the
   full tier matrix, ~300 sessions of history, a populated firearm register — and
   places the §12.1 boundary cases deliberately: a licence that expired yesterday,
   one expiring today, an allowance period ending today, an exhausted allowance, a
   waiver superseded yesterday.

   It is deterministic and re-runnable; it prints two device registration codes
   **once**, and the server keeps only their hashes.
4. The seed created a booking for **today** with an open session, one member shooter
   and one guest shooter whose invitation is `completed` — so the §12.1
   host-presence rule is live on the Today screen. Tomorrow's booking deliberately
   has **no** open session, which exercises the refusal in `buildCheckIn`.
5. The tablet has been enrolled at `/console` with the desk code, and has synced
   once online so the arrivals list is populated.

---

## The run

Record the time and the result of every step. A step that is skipped is recorded as
skipped, not omitted.

### 1 — Cold start with no network

1. Put the tablet in **airplane mode**, or switch off the building's access point.
   Prefer the access point: it reproduces the captive-portal and stalled-uplink
   cases that airplane mode does not.
2. Force-quit the app. Reopen from the home screen icon.
3. **Time from tap to a usable Today screen.** §2 and §6.4 both say under one
   second. Record the number, not an impression.
4. Confirm the sync bar is visible and says something true about being offline
   (§8.4: depth and last-sync at all times).

### 2 — The workflow, entirely offline

5. Check in the **member**. Confirm the row moves to checked-in.

   The seed plants members whose waiver is missing or superseded (every ninth).
   If the member you pick is one of them, their row offers **Sign waiver** in
   place of Check in — do step 9 first and come back. That is the intended
   order, not a fault.
6. Confirm the **guest** row is blocked, and that the reason **names the host**.
7. Check in the **host**, and confirm the guest's row clears **by itself** —
   §12.1: "no retry needed". Do not reload the page. If a reload was required, the
   test has failed even though the screen now looks correct.
8. Check in the guest.
9. Sign the **waiver** for one of them. Pick somebody the seed left on a
   superseded version, so the signature has a block to clear.

   Confirm the waiver **text** is on screen before the signing area — a tablet
   that cannot show the document refuses to take a mark against it. Sign with a
   finger. Confirm the row clears **by itself**, exactly as the guest's did at
   step 7: no reload. The row then offers Check in, where it offered nothing
   before.
10. Issue the **serialised firearm** against the participation.
11. Issue **forty rounds** from the lot.
12. Record **two scores**.
13. Confirm the sync bar depth has risen and reads as records waiting, not as an
    error.

### 3 — The power cut

14. **While the session is open and the queue is non-empty, pull the power.** Mid
    action if possible — during step 12's second score is the most useful moment,
    because it is the write most likely to be in flight.
15. Wait a full minute with the device dead.
16. Restore power. Boot. Reopen the app, still with **no network**.

### 4 — What must be true

17. **Every record from steps 5–12 is present.** Check each one individually
    against the list, not by glancing at a count.
18. The session is still open, with the same participations, the same waiver
    signature, the same firearm issued and the same two scores. Confirm the
    signed row is still clear on Today — read from `armory-session`, not from the
    server, which has not been asked yet.
19. The sync bar shows the same depth as before the cut, or one more if a write
    landed during step 14.
20. Nothing reads as an error, and no record has silently vanished.

### 5 — Reconnection

21. Restore the network.
22. Watch the queue drain. Record how long it takes.
23. **On the server, count the rows.** Every record appears **exactly once**.
    Check `armory.participations`, `armory.waiver_signatures`,
    `armory.custody_events`, `armory.ammunition_issues` and `armory.rounds` by the
    ids the tablet generated.
24. Confirm the firearm's derived status matches its custody log (§3.4 —
    it is computed by trigger, so a mismatch here is a schema problem, not a sync
    one).
25. Confirm the sync bar returns to clear and reports a recent last-sync.

### 6 — Deliberate duplication

The replay path is unit-tested over every operation
(`src/sync/push.test.ts`), and §8.5 asks for it on hardware:

26. With the network restored, force one record to be delivered twice — pull the
    network mid-push so an `inflight` item is retried on the next drain.
27. Confirm **one row**, not two. The endpoint reports `duplicate` on the second
    delivery; the row count is what matters.

### 7 — Revocation (§10)

28. From the owner dashboard, revoke the tablet.
29. Reopen the console **with** the network. Confirm it refuses, states that the
    device has been signed out, and that the local databases are gone —
    `armory-daypack`, `armory-device`, `armory-outbox`.
30. Reopen **without** the network. Confirm it does not open, and that the
    previously cached shell does not show yesterday's roster.

### 8 — The clock (§10)

31. Re-register the tablet and let it sync. Then take it offline and set the date
    **backwards two weeks**.
32. Confirm the desk still opens and warns that the clock is wrong.
33. Take a device whose `lastVerifiedAt` is older than the seven-day bound, wind the
    clock back, and confirm it is **still refused**. This is the high-water mark in
    `src/offline/device.ts` doing its job; without it the bound is a setting.

---

## Recording sheet

| # | Step | Result | Notes |
| --- | --- | --- | --- |
| 3 | Cold start to usable Today | \_\_\_ ms | budget 1000 ms |
| 7 | Guest cleared without a reload | pass / fail | §12.1 |
| 9 | Waiver cleared the block without a reload | pass / fail | §3.1 |
| 9 | Signature image held on the tablet | held / lost | see the note below |
| 12 | Two scores recorded at the lane | \_\_\_ s each | budget 20 s (§6.5) |
| 17 | Records present after the cut | \_\_ / \_\_ | count what steps 5–12 produced |
| 17 | Presence survived the reboot | pass / fail | read from `armory-session` |
| 22 | Queue drained in | \_\_\_ s | |
| 23 | Rows on the server | exactly once / duplicated | §7 |
| 27 | Deliberate replay | one row / two rows | §7 |
| 29 | Revoked, online | wiped / not wiped | §10 |
| 30 | Revoked, offline | refused / opened | §10 |
| 33 | Clock wound back on a stale device | refused / opened | §10 |

Signed: \_\_\_\_\_\_\_\_\_\_\_\_\_\_ Date: \_\_\_\_\_\_\_\_ Tablet model: \_\_\_\_\_\_\_\_\_\_\_\_\_\_

---

## Known gaps this run will expose

Recorded here so they are not discovered as surprises mid-test, and so nobody
records a pass against a step the build does not yet support.

- **~~Steps 5–11 are built. Step 12 is not.~~ Closed at M7. The whole protocol runs.**

  Check-in is complete and durable: it writes a participation to `armory-session`
  and queues `participations.checkin` plus an `audit_log.create` through the outbox
  (`src/offline/checkin.ts`). Presence is read back off the disk at boot, so the
  power cut at step 14 is a real test of those records and of step 17.

  **Updated at M5.** Equipment issue now has an originating layer —
  `src/offline/equipment.ts` builds the `custody_events.create` and
  `ammunition_issues.create` writes that §6.4 requires to work offline, so steps
  10 and 11 can be performed.

  **Closed at M7.** Step 12 is built. `src/offline/score.ts` builds the
  `rounds.create` write, `src/components/console/ScoreSheet.tsx` takes the total
  on a keypad that never raises the system keyboard, and the card is written to
  `armory-session` before it is queued — the same order, for the same reason, as
  a check-in and a signature.

  **Step 12 is performed on the LANE tablet, not the desk.** §6.5 puts scoring
  on the lane surface, and the device's registration decides which surface it
  shows. If the protocol is being run on one tablet, register it as `lane` for
  steps 8 and 12 and as `desk` for the rest — or run it on two, which is what the
  club will actually have.

  **What to check on this run:** that the two scores are still on the relay after
  the reboot at step 16, read from `armory-session` and not from the server; and
  at step 23, that `armory.rounds` holds exactly two rows for them.

  **Corrected.** The M5 edit above moved this heading from "steps 5–8" to "steps
  5–11" on the strength of the equipment work alone, which quietly claimed **step
  9** as well. It was not built: nothing anywhere originated a
  `waiver_signatures.create`. It is built now — see the next entry — and the
  heading is true as it stands.

  **The whole protocol can now be run.** Sections 1 to 8, every step, with no
  step recorded as skipped — which was not true of any earlier revision of this
  document and is the reason to re-read the recording sheet rather than the
  headings.

- **~~The waiver cannot be signed at the desk.~~ Closed.**

  §6.4 puts the waiver on the desk and §3.1 makes a signature append-only. The
  write was defined in `src/sync/contract.ts`, parsed in `src/sync/operations.ts`
  and replay-tested from the beginning; nothing built one.

  It was not a cosmetic gap. `WAIVER_MISSING` and `WAIVER_SUPERSEDED` are
  **not overridable** (`src/domain/capability/reasons.ts`) and their stated remedy
  is "at the desk" — so a member in either state met a block the desk could not
  clear and an officer could not waive, and `scripts/seed.ts` plants both
  deliberately. The Today row disabled its own check-in button and offered
  nothing else. It was the only dead end on the screen.

  `src/offline/waiver.ts` builds the signature and its audit row;
  `src/components/console/WaiverSheet.tsx` shows the document and takes the mark;
  the signature is written to `armory-session` before it is queued, in the same
  order and for the same reason as a check-in. The block clears from local state
  alone, by the same mechanism as §12.1's host rule — `subjectFor` takes desk
  signatures as an argument, so the row re-evaluates rather than refetching.

  **The signature image, decided rather than deferred.** `waiver_signatures` is
  append-only and drizzle/0002 rejects UPDATE, so whatever `signature_image_url`
  holds at insert is what it holds forever — a null written offline could never
  be filled in later, and those signatures are exactly the ones most likely to be
  contested. So the key is derived from the signature's own UUIDv7 at the moment
  of signing and travels in the row, and the bytes stay on the tablet in
  `armory-session` until there is somewhere to send them. This is the pattern
  `src/server/armory/licences.ts` already uses from the other side: a
  client-chosen id that the row and the object both agree on.

  **What this leaves open, stated plainly:** there is no uploader, and no object
  storage is configured in this repository at all. Between signing and upload the
  key names an object that does not exist. The bytes are durable on the device
  throughout — that is what the second step-9 line on the recording sheet checks,
  and it is checked *after* the power cut, because the image is the one artefact
  here that exists in a single copy.

  **What to check on this run:** that the waiver text appears before the signing
  area; that the row clears with no reload; that the signature is still there
  after the reboot at step 16; and at step 23, that `armory.waiver_signatures`
  holds exactly one row for it, carrying a `signature_image_url` and a
  `device_id`.

- **~~Check-ins are attributed to a device, not to a person.~~ Closed at M5.**

  §10 requires "every staff action attributable to a named person".
  `checked_in_by_staff_id` was written as null throughout M1 because there was no
  officer sign-in, so a check-in named a tablet and honestly not a human.

  The two halves now exist. Online: `POST /api/auth/staff/unlock`
  (`src/server/armory/staff-session.ts`) exchanges a registered device plus a PIN
  for a session — two factors, neither sufficient alone, which is what §10's
  "device-bound sessions with a short local unlock" describes. Offline:
  `src/offline/officer.ts` derives a verifier **in the browser** from the PIN at
  the moment of a successful online unlock and keeps it for the shift, so the day
  pack still carries no `staff_users.pin_hash` and a stolen tablet exposes at most
  the last officer to sign in on it.

  Three wrong PINs offline and the tablet requires a connection. The shift expires
  after twelve hours and only an online unlock creates another.

  **What to check on this run:** that a check-in performed after an offline unlock
  carries a `checked_in_by_staff_id`, and that one performed with no live shift
  still carries null rather than a stale name.

- **~~No lane is assigned at check-in.~~ Closed at M5.**

  §6.4 says "three taps maximum from Today to checked in **with a lane assigned**".
  The day pack now carries lanes (`PackLane`, projected in
  `src/server/daypack-projection.ts`) and `src/offline/lanes.ts` computes occupancy
  from local participations — including ones still in the outbox, for the same
  reason the host-presence rule reads local state.

  The officer is offered the lowest-numbered free lane as a default they can
  change; the desk never assigns silently. **What to check:** that a check-in
  writes a non-null `lane_id`, and that a lane under maintenance is shown and
  refused rather than hidden.

- **~~Incidents cannot be recorded offline yet.~~ Closed at M7.**

  §6.5 requires it, and the earlier note here was wrong about the obstacle: it
  said the write "needs a single CTE statement" because "the HTTP driver has no
  multi-statement transactions". That is true of the LEAGUES driver. The
  management system holds a pooled TCP connection with real transactions
  (`src/db/armory/client.ts`), which exists for §8.3's allowance write, and
  `incidents.create` uses it — both inserts, each `ON CONFLICT DO NOTHING`,
  committed together.

  `src/offline/incident.ts` builds the record and
  `src/components/console/IncidentSheet.tsx` takes it. The button is in the lane
  header on every screen of that surface, which is §6.5's "never more than one
  tap away", and the builder refuses on exactly two things — a category and an
  account of what happened. Everything else it would have insisted on is a way
  for a safety record not to exist.

  **Worth adding to the run**, though §8.5 does not ask for it: record an
  incident before the power cut and confirm it is still there afterwards. It is
  the one record on this list that exists because something went wrong, and it is
  the one nobody would think to check twice.

- **Sessions cannot be opened offline.** A check-in belongs to a session, and
  `sessions` is in neither of §8.2's two classes, so it has no offline strategy yet.
  The day pack carries `sessionId` on arrivals whose session is already open, which
  is why step 3 of the setup requires the session to be opened **while online**. A
  check-in against a booking with no open session is refused with a sentence rather
  than failing later as a foreign key violation in the queue.

- **The sync endpoints have not been run against a live database.** They are typed
  against the DDL in `drizzle/0001` and `0002` and the pure layers are unit-tested,
  but the SQL itself is unverified. The first item to check is that every
  `AS "camelCase"` alias in `src/server/sync/daypack-query.ts` matches
  `src/server/rows.ts` — a mismatch shows up as an undefined field on the desk.

  **Two queries were added after that note and carry the same warning:** the
  `participations` projection (M7, so a lane tablet can see who the desk checked
  in) and the `club_settings` read (M8, so §14's values come from a row rather
  than a literal). Both are unverified SQL. A settings row that fails to read
  falls back to the undecided position and the range still opens, which is
  deliberate — but confirm on the first sync that the desk's day pack carries a
  non-empty `participations` array once somebody is checked in.

  The same applies to `scripts/seed.ts`: its inserts are typed against the same DDL
  and have never executed. Run it before the protocol, not during it.

- **Background sync delivers but records nothing.** `public/console/sw.js` will send
  queued records when connectivity returns with the desk closed (§2: "background sync
  where supported"), and it deliberately never writes to IndexedDB — so those records
  are sent again on next open and the server answers `duplicate`. That is the intended
  behaviour and it means step 27's replay count may be higher than the one deliberate
  duplication you introduce. Count rows on the server, not deliveries.

  Chromium only. Safari and Firefox have no Background Sync API, so on those the
  closed-tab case is not covered and the queue drains on the app's own timer instead.
