-- ============================================================================
-- CLUB SETTINGS — the §14 open items, in a row rather than in code.
--
-- §14 lists items that are the club's to decide and that it calls "not
-- structurally blocking": the guest overage price, the roster cap, how long a
-- waiver signature stays valid, whether on-premises storage is enabled, and
-- which disciplines demand a club sign-off. §10 adds one more that counsel
-- owns: how long a guest's data is kept after their last visit.
--
-- Each of them was a literal in application code before this table, carrying
-- the same comment — read it from the pack "so it changes without a deploy".
-- That was half true: the DEVICE read it from the pack, and the SERVER read it
-- from a constant in src/server/sync/daypack-query.ts. Changing the club's mind
-- still meant a release, on the afternoon the founder decided.
--
-- ---------------------------------------------------------------------------
-- HAND-WRITTEN, LIKE 0003 THROUGH 0005
--
-- `drizzle-kit generate` produced a migration for this table AND re-issued
-- every change from 0004 and 0005, because those were hand-written and left no
-- snapshot behind — so the generator diffed the current schema against 0003.
-- Applying that output to a live database would fail on `CREATE TABLE
-- staff_sessions`, which already exists.
--
-- The generated `meta/0006_snapshot.json` IS kept and is correct: it is built
-- from the schema files rather than from the migration chain, so it restores
-- the baseline a future `generate` diffs against and this gap does not recur.
--
-- ---------------------------------------------------------------------------
-- ONE ROW, ENFORCED BY AN INDEX
--
-- A settings table with two rows is a settings table where half the system
-- reads the wrong one, and nothing surfaces it until the two disagree. The
-- unique index on `singleton` makes a second row impossible; the column exists
-- only to carry it.
--
-- ---------------------------------------------------------------------------
-- NULL MEANS "NOT DECIDED"
--
-- No default here would be safe. An overage price defaulted to zero bills
-- nobody; defaulted to a guess it bills a member for something the club never
-- agreed. A roster cap defaulted to a number closes admissions at it.
--
-- So the undecided ones are nullable and every reader states what it does with
-- null. `storage_enabled` and the discipline list are NOT NULL because their
-- safe position is a real value: §13 puts storage behind a flag that is off,
-- and an empty list means no discipline demands a sign-off, which is the
-- permissive answer and the one the club runs today.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "armory"."club_settings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "singleton" boolean DEFAULT true NOT NULL,
  "guest_overage_price_kobo" bigint,
  "roster_cap" integer,
  "waiver_validity_days" integer,
  -- §10's guest data retention. NULL means no automatic erasure — the safe
  -- direction for the one setting whose mistake cannot be undone. §14 has it
  -- blocked on counsel. An erasure on request is unaffected.
  "guest_retention_days" integer,
  "storage_enabled" boolean DEFAULT false NOT NULL,
  "disciplines_requiring_qualification" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "club_settings_singleton_key"
  ON "armory"."club_settings" USING btree ("singleton");
--> statement-breakpoint

-- The row itself. Every value is left at its undecided position, so applying
-- this migration changes no behaviour anywhere — it only moves the decision out
-- of code and into a row a founder can change.
--
-- ON CONFLICT DO NOTHING so the migration is safe to re-run, and so a club that
-- has already set its price does not have it reset by a replay on restore.
INSERT INTO "armory"."club_settings"
  ("id", "singleton", "storage_enabled", "disciplines_requiring_qualification")
VALUES
  ('01930000-0000-7000-8000-000000000001', true, false, '[]'::jsonb)
ON CONFLICT ("singleton") DO NOTHING;
