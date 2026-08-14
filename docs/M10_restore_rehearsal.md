# M10 — the restore rehearsal

**Build Specification §10 and §2. This document is the protocol; it is not the evidence.**

> §10, Backup: **"Automated daily off-site. A restore must be performed and
> documented BEFORE launch. A backup never restored is a hope."**
>
> §2, Hosting: "Automated daily off-site backup with a **tested restore**."

The specification says this twice, in two different sections, and phrases it as a
prohibition rather than a task. That is the whole of why this document exists: a
backup job that reports success every night is indistinguishable from one that
writes empty files, right up until the morning somebody needs it.

---

## Why this is harder here than in an ordinary application

Three properties of this system make a restore unusually consequential, and each
one gives the rehearsal a step it would not otherwise have.

**The append-only tables cannot be repaired by hand.** `drizzle/0002` puts
`reject_mutation` and `reject_truncate` triggers on `custody_events`,
`waiver_signatures`, `rounds`, `incidents`, `account_transactions` and
`audit_log`. That is §12 working as designed and it means a restore cannot be
tidied up afterwards: whatever lands is what the club has, permanently. A partial
restore of the custody log is not a smaller custody log — it is a firearm
register that disagrees with itself, which §3.4 says will eventually happen and
which this would cause on purpose.

**Derived columns are rebuilt by trigger, not restored.** `firearms.status`,
`ammunition_lots.quantity_remaining` and `accounts.balance_kobo` are maintained
by the functions in `0002`. A restore that brings back the tables without the
triggers produces a database that looks complete and stops updating the moment
somebody writes to it. Step 6 exists for exactly this.

**Tablets hold records the server has never seen.** §8 is built on the desk
working for days without an uplink, so at any moment the outbox on a device may
hold custody events and signatures that exist nowhere else. A restore to a point
before those were sent does not lose them — they are still queued — but it does
mean the reconnection after a restore is part of the test, and it is step 9.

---

## Before the rehearsal

1. **A production-shaped database.** Staging with `npm run db:seed` applied
   (§2.1's hundred members, several hundred sessions, a populated register).
   A restore rehearsed against an empty database proves the credentials work and
   nothing else.
2. **The backup you intend to rely on.** Not a fresh `pg_dump` taken for the
   occasion — the actual automated off-site artefact, fetched the way an
   engineer would fetch it at two in the morning with the range shut.
3. **A target that is not production.** A fresh database on the same platform
   and the same Postgres major version.
4. **A stopwatch.** The number this rehearsal produces that nobody can guess is
   how long it takes.

---

## The rehearsal

Record the time and the result of every step. A step that is skipped is recorded
as skipped, not omitted.

### 1 — Retrieve

1. Fetch the most recent off-site backup. **Record how you found it** — the
   console, the bucket, the command. The rehearsal is as much about whether a
   second person can find the backup as about whether it restores.
2. Record its timestamp and its size. A size that has not changed in a week is
   the failure this whole document exists to catch.

### 2 — Restore

3. Create the target database. Record the Postgres version; a restore into an
   older major version fails in ways that look like data corruption.
4. Restore. **Start the stopwatch.** Record the finish time and any warnings —
   warnings during a restore are not noise, they are the list of things that did
   not come back.

### 3 — Prove the structure

5. Run the migrations against the restored database to confirm it is at the
   expected revision:

   ```bash
   DATABASE_URL=<restored> npm run db:migrate
   ```

   This must report **nothing to apply**. Anything else means the backup predates
   a migration and the restore is not the shape the application expects.

6. **Run the enforcement proof. This is the load-bearing step.**

   ```bash
   DATABASE_URL=<restored> npm run db:prove
   ```

   Twenty-nine assertions, in one rolled-back transaction, that the append-only
   triggers and the derived-column guards are present and refusing. A restore
   that brought back every row and none of the triggers passes every casual
   inspection and silently discards the club's central guarantee.

   Record the pass count, not "it passed".

### 4 — Prove the data

7. Count the rows the club's licence rests on, and compare against production:

   ```sql
   SELECT 'custody_events',      count(*) FROM armory.custody_events
   UNION ALL SELECT 'waiver_signatures',   count(*) FROM armory.waiver_signatures
   UNION ALL SELECT 'rounds',               count(*) FROM armory.rounds
   UNION ALL SELECT 'participations',       count(*) FROM armory.participations
   UNION ALL SELECT 'ammunition_issues',    count(*) FROM armory.ammunition_issues
   UNION ALL SELECT 'account_transactions', count(*) FROM armory.account_transactions
   UNION ALL SELECT 'audit_log',            count(*) FROM armory.audit_log
   UNION ALL SELECT 'payments',             count(*) FROM armory.payments;
   ```

8. **Check the derived columns against what they derive from.** This is the check
   that finds a restore which came back without its triggers, and it is the same
   comparison `armouryExceptionReport` makes:

   ```sql
   -- Every firearm's status column against its own custody log.
   -- Expect zero rows.
   SELECT f.serial_number, f.status
     FROM armory.firearms f
    WHERE f.status <> armory.derive_firearm_status(f.id);

   -- Every account balance against its ledger. Expect zero rows.
   SELECT a.id, a.balance_kobo
     FROM armory.accounts a
    WHERE a.balance_kobo <> COALESCE((
            SELECT SUM(CASE WHEN t.direction = 'credit'
                            THEN t.amount_kobo ELSE -t.amount_kobo END)
              FROM armory.account_transactions t
             WHERE t.account_id = a.id), 0);
   ```

   > If `armory.derive_firearm_status` does not exist as a callable function in
   > the restored database, compare `firearms.status` against the latest
   > `custody_events` row per firearm by hand. Do not skip the check.

### 5 — Prove the application

9. Point a **staging** deployment at the restored database and:
   - open `/console` on an enrolled tablet and confirm Today renders the expected
     arrivals;
   - open `/api/dashboard` as the founder and confirm the roster count matches
     step 7;
   - **reconnect a tablet that has queued records** and confirm they land exactly
     once (§7). This is the step that proves a restore and the offline layer do
     not fight: the outbox will re-deliver, and the ids are what stop it
     duplicating.

10. Confirm the guest link at `/visit/<token>` still resolves for an unexpired
    invitation. It is the only public surface that reads a hashed credential, and
    a restore that lost the hash column would surface here first.

### 6 — Record the numbers

11. **Restore duration**, from step 4.
12. **Data loss window** — the gap between the backup's timestamp and the moment
    you would have needed it. This is the number the founder actually has to
    accept, and it is a business decision rather than a technical one.

---

## Recording sheet

| # | Step | Result | Notes |
| --- | --- | --- | --- |
| 1 | Backup located | \_\_\_ | how, and by whom |
| 2 | Backup timestamp / size | \_\_\_ | |
| 4 | Restore duration | \_\_\_ min | |
| 5 | Migrations pending after restore | none / \_\_\_ | must be none |
| 6 | `db:prove` assertions passed | \_\_ / 29 | §12's database enforcement |
| 7 | Row counts match production | yes / no | list any that do not |
| 8 | Derived columns consistent | \_\_ mismatches | must be 0 |
| 9 | Queued records landed exactly once | pass / fail | §7 |
| 10 | Guest link resolves | pass / fail | |
| 12 | Accepted data loss window | \_\_\_ | founder's decision |

Restored by: \_\_\_\_\_\_\_\_\_\_\_\_\_\_ Witnessed by: \_\_\_\_\_\_\_\_\_\_\_\_\_\_ Date: \_\_\_\_\_\_\_\_

---

## What a failure here means

A failed rehearsal is not a reason to delay the rehearsal. It is the finding.

§10 makes a tested restore a precondition of launch, and the specification's own
sentence is the standard to hold: **a backup never restored is a hope.** A club
whose firearm custody log cannot be restored is a club that cannot demonstrate
where its firearms have been, which is the record §3.4 says its licence rests on.

Re-run this document in full after any change to the backup configuration, the
hosting platform, or the Postgres major version — and at least once a quarter
regardless, because the failure this catches is one that develops quietly in a
system nobody has touched.
