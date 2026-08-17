-- ===========================================================================
-- THE DEGRADATION LADDER, NEAR-MISSES, AND AN OWNER FOR AN APPLICATION
--
-- Management System Design Specification §6.2, §8.2, §9.2.
--
-- Three controls the club cannot open without, and all three are governance
-- rather than convenience: the ladder decides what happens on an understaffed
-- evening, the near-miss form decides whether the club ever hears about the
-- evening, and the owner column decides whether an applicant is ever answered.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. THE OPERATING LEVEL
--
-- §6.2: "The club's degradation order under staffing pressure is already
-- defined: guest numbers cap first, then live fire closes, then the full range
-- closes, then the clubhouse trades only. It currently lives in a document,
-- which means that under real pressure it lives in somebody's memory."
--
-- The ORDER is the content, which is why this is an ordered enum: these are four
-- rungs the club comes down in sequence, not four states it picks between.
--
-- Note the last rung is "range closed", not "closed". The clubhouse trades at
-- every level, which is the hospitality-first principle surviving a bad evening.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "armory"."operating_level" AS ENUM (
    'normal',
    'guests_capped',
    'live_fire_closed',
    'range_closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "armory"."degradation_cause" AS ENUM (
    'staffing',
    'coverage',
    'weather',
    'equipment',
    'stadium',
    'safety',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Defaults to 'normal', which is the one default in club_settings that is a real
-- answer rather than an absence. A club that has said nothing about its level is
-- running normally; treating the unset case as degraded would close a range
-- nobody closed.
ALTER TABLE "armory"."club_settings"
  ADD COLUMN IF NOT EXISTS "operating_level" "armory"."operating_level"
  NOT NULL DEFAULT 'normal';--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. EVERY MOVE OF IT
--
-- The column above is only the current value. THIS is the feature: §6.2 says the
-- reason is "not a free-text afterthought… the value of this control over a
-- season is the record of why the club degraded, which is an operational
-- analytic in §11.3 and a staffing argument the founder will otherwise have to
-- make from memory."
--
-- A club storing only the current level can answer "are we degraded" and never
-- "how often, and why" — which is the question that decides whether to hire.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "armory"."operating_level_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "from_level" "armory"."operating_level",
  "to_level" "armory"."operating_level" NOT NULL,
  "cause" "armory"."degradation_cause" NOT NULL,
  "note" text NOT NULL,
  "set_by_staff_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "armory"."operating_level_events"
  ADD CONSTRAINT "operating_level_events_set_by_fk"
  FOREIGN KEY ("set_by_staff_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "operating_level_events_created_idx"
  ON "armory"."operating_level_events" ("created_at");--> statement-breakpoint

-- The same twelve-character floor as an override, a grant and a capacity
-- override. A mandatory field that accepts 'ok' is not mandatory, and this one
-- is read next quarter with nobody left to ask.
ALTER TABLE "armory"."operating_level_events"
  ADD CONSTRAINT "operating_level_events_note_is_a_note"
  CHECK (length(btrim(note)) >= 12);--> statement-breakpoint

-- A move to where you already were is not a move. It would double-count every
-- episode in §11.3's degradation summary.
ALTER TABLE "armory"."operating_level_events"
  ADD CONSTRAINT "operating_level_events_is_a_change"
  CHECK (from_level IS NULL OR from_level <> to_level);--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. NEAR-MISSES
--
-- S5: "Near-miss reporting is a culture problem before it is a system feature.
-- The system can only fail to help. A reporting surface that is slow,
-- attributive, punitive or visible to the wrong people will produce silence and
-- the club will conclude, wrongly, that nothing is happening."
--
-- WHAT IS ABSENT HERE IS THE DESIGN. No severity — somebody would argue about
-- it, and arguing about a near-miss is how the next one goes unreported. No
-- subject — the form has nowhere to put a name because the table has nowhere to
-- put one. No outcome — a near-miss by definition had none, and a column for it
-- would invite this to become a second incident register.
--
-- THE REPORTER IS NULLABLE BECAUSE THEY CHOOSE. Founder's decision, 17 August
-- 2026: per report, not per person, because the choice belongs at the moment the
-- person knows what it costs them. Null means "filed anonymously" and never "we
-- lost track" — and nothing in the application may infer a reporter from a
-- session, a device or a timestamp. An anonymous report that can be
-- de-anonymised is worse than none, because somebody trusted it.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "armory"."near_miss_kind" AS ENUM (
    'line_discipline',
    'equipment',
    'ammunition',
    'movement',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "armory"."near_miss_reports" (
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" "armory"."near_miss_kind" NOT NULL,
  "what_happened" text NOT NULL,
  "location" text,
  "reported_by_staff_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- SET NULL matters more here than anywhere else in the schema: a staff member
-- leaving must not take their near-miss reports with them, and the reports are
-- worth keeping without them.
ALTER TABLE "armory"."near_miss_reports"
  ADD CONSTRAINT "near_miss_reports_reported_by_fk"
  FOREIGN KEY ("reported_by_staff_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "near_miss_reports_created_idx"
  ON "armory"."near_miss_reports" ("created_at");--> statement-breakpoint

-- Twenty characters, set against §9.2's thirty-second budget rather than against
-- a quality bar. Roughly "muzzle came off target during a reload", which is a
-- usable report. A longer minimum buys better prose and fewer reports, and fewer
-- reports is the failure.
ALTER TABLE "armory"."near_miss_reports"
  ADD CONSTRAINT "near_miss_reports_has_a_narrative"
  CHECK (length(btrim(what_happened)) >= 20);--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. BOTH REGISTERS ARE APPEND-ONLY
--
-- §12's class, applied to the two records whose trustworthiness is the entire
-- reason they exist. A degradation somebody edited afterwards is worth LESS than
-- one nobody recorded, because it looks trustworthy. A near-miss that can be
-- softened after the fact is a near-miss nobody will believe.
--
-- Near-misses admit exactly one later write: clearing the reporter. That is the
-- de-anonymisation path in reverse — a person may withdraw their name from a
-- report they filed, and nothing else about it may change.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION armory.operating_level_events_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'armory.operating_level_events is append-only: the club degraded, and that stands.'
    USING HINT = 'Record another change. The history is the analytic.',
      ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS operating_level_events_guard ON armory.operating_level_events;--> statement-breakpoint

CREATE TRIGGER operating_level_events_guard
  BEFORE UPDATE OR DELETE ON armory.operating_level_events
  FOR EACH ROW EXECUTE FUNCTION armory.operating_level_events_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION armory.operating_level_events_no_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'armory.operating_level_events is append-only: it cannot be truncated.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS operating_level_events_no_truncate ON armory.operating_level_events;--> statement-breakpoint

CREATE TRIGGER operating_level_events_no_truncate
  BEFORE TRUNCATE ON armory.operating_level_events
  FOR EACH STATEMENT EXECUTE FUNCTION armory.operating_level_events_no_truncate();--> statement-breakpoint


CREATE OR REPLACE FUNCTION armory.near_miss_reports_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'armory.near_miss_reports is append-only: a report is never deleted.'
      USING HINT = 'A report withdrawn is still evidence that somebody looked.',
        ERRCODE = 'restrict_violation';
  END IF;

  -- The one permitted write: a reporter withdrawing their name, once, in the
  -- direction of MORE anonymity and never less. Re-attaching a name to an
  -- anonymous report is the de-anonymisation the header forbids.
  IF NEW.reported_by_staff_id IS NOT NULL
     AND OLD.reported_by_staff_id IS DISTINCT FROM NEW.reported_by_staff_id THEN
    RAISE EXCEPTION
      'A near-miss reporter may be cleared, never set or changed.'
      USING HINT = 'An anonymous report that can be de-anonymised is worse than none.',
        ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.id, NEW.kind, NEW.what_happened, NEW.location, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.kind, OLD.what_happened, OLD.location, OLD.created_at)
  THEN
    RAISE EXCEPTION
      'A near-miss report cannot be edited after filing.'
      USING HINT = 'File a second report, or record an incident citing this one.',
        ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS near_miss_reports_guard ON armory.near_miss_reports;--> statement-breakpoint

CREATE TRIGGER near_miss_reports_guard
  BEFORE UPDATE OR DELETE ON armory.near_miss_reports
  FOR EACH ROW EXECUTE FUNCTION armory.near_miss_reports_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION armory.near_miss_reports_no_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'armory.near_miss_reports is append-only: it cannot be truncated.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS near_miss_reports_no_truncate ON armory.near_miss_reports;--> statement-breakpoint

CREATE TRIGGER near_miss_reports_no_truncate
  BEFORE TRUNCATE ON armory.near_miss_reports
  FOR EACH STATEMENT EXECUTE FUNCTION armory.near_miss_reports_no_truncate();--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. AN OWNER FOR AN APPLICATION — §8.2
--
-- Not `decided_by_staff_id`, and conflating the two was the defect. That column
-- records who CLOSED an application, so it is null for every OPEN one by
-- definition — which is exactly the set the queue is about. Reading it as
-- ownership reports a queue where every live application is unowned and every
-- dead one is owned: precisely backwards, and it would have looked like data.
--
-- Nullable, with no default. §8.2 says the underlying problem "is a staffing
-- decision rather than a software one" — defaulting to whoever holds
-- people_write would produce a column that always has a value and never has an
-- owner.
-- ---------------------------------------------------------------------------

ALTER TABLE "armory"."applications"
  ADD COLUMN IF NOT EXISTS "owner_staff_id" uuid;--> statement-breakpoint

ALTER TABLE "armory"."applications"
  ADD CONSTRAINT "applications_owner_fk"
  FOREIGN KEY ("owner_staff_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "applications_owner_idx"
  ON "armory"."applications" ("owner_staff_id");
