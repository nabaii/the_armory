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
6. Confirm the **guest** row is blocked, and that the reason **names the host**.
7. Check in the **host**, and confirm the guest's row clears **by itself** —
   §12.1: "no retry needed". Do not reload the page. If a reload was required, the
   test has failed even though the screen now looks correct.
8. Check in the guest.
9. Sign the **waiver** for one of them.
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
18. The session is still open, with the same participations, the same firearm
    issued and the same two scores.
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
| 17 | Records present after the cut | \_\_ / \_\_ | count what steps 5–8 produced |
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

- **Steps 5–8 are built. Steps 9–12 are not.**

  Check-in is complete and durable: it writes a participation to `armory-session`
  and queues `participations.checkin` plus an `audit_log.create` through the outbox
  (`src/offline/checkin.ts`). Presence is read back off the disk at boot, so the
  power cut at step 14 is a real test of steps 5–8 and of step 17 for those records.

  The **waiver, equipment-issue and score-capture** workflows are M5 and M7. Their
  writes are defined and replay-tested (`src/sync/operations.ts`) and the queue that
  carries them is complete, but there is no screen that originates them — so steps
  9–12 cannot be performed yet.

  What **can** be run today, and should be before M2 begins per §11: sections 1 and
  2 as far as step 8, the power cut at step 14, step 17 for the check-in records,
  section 5 in full, section 6, and sections 7 and 8 in full.

- **Check-ins are attributed to a device, not to a person.** §10 requires "every
  staff action attributable to a named person", and `checked_in_by_staff_id` is
  written as null because M1 has no officer sign-in. The column is nullable, the
  device is always recorded, and the audit row is still written — but a check-in
  made during this run names a tablet and honestly not a human.

  Not papered over with a dropdown of officers, which would be the shared login §10
  forbids under another name. The real fix is the device-bound session with a short
  local unlock (§10), which needs to work **offline** — so it cannot verify a PIN
  against the server, and the day pack deliberately does not carry
  `staff_users.pin_hash` (a pack holding every officer's PIN hash moves staff
  authentication onto a stealable tablet). The shape that resolves it: the officer
  signs in once while online, and the local unlock re-verifies only that one
  officer's stored verifier for the length of the shift. M5, with the desk.

- **No lane is assigned at check-in.** §6.4 says "three taps maximum from Today to
  checked in **with a lane assigned**"; `lane_id` is written as null. Lane
  assignment needs the lane list and occupancy, which is M5/M7.

- **Incidents cannot be recorded offline yet.** §6.5 requires it. An incident is two
  tables and the HTTP driver has no multi-statement transactions, so writing it
  idempotently needs a single CTE statement — deferred to M7 with the lane surface
  rather than shipped half-done. See the note in `src/sync/contract.ts`.

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
