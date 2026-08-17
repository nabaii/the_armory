-- ===========================================================================
-- SERVICE HOURS, AND THE CLOCK ON THE FIFTEEN SECONDS
--
-- Management System Design Specification §7.1 and §11.4, and findings F3 and
-- F4 of the product panel of 17 August 2026.
--
-- Two pieces of capture that cannot be reconstructed later, which is the whole
-- reason they precede every screen in the management system. A trend cannot be
-- backfilled from memory the way a roster can.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. SERVICE HOURS — when the kitchen and bar actually serve
--
-- §7.1: "Service hours are separate from range hours and this is the point. A
-- club that can only express when the range is open cannot express a Thursday
-- evening where the kitchen serves and nobody shoots — which is the exact
-- behaviour the business depends on."
--
-- The club could already SAY this and could not MODEL it. `opening_hours.label`
-- carries "Deck and kitchen only" and is documented as never parsed, and table
-- availability ran the entire opening day against one global cover count. So a
-- member could book a table at 09:15 on a day the kitchen opens at noon.
--
-- A separate table rather than a `serving` flag on an opening period, because
-- the slot grid restarts at every opening-period boundary: splitting a
-- 09:00–18:00 range day into three to express a 12:00–15:00 kitchen would
-- silently forbid any shooting session spanning noon. Service hours have to cut
-- across the range's day without perturbing it.
--
-- NO SEED, AND NO DEFAULT WEEK. Zero rows means the club has not said when it
-- serves, which yields no table slots and one honest sentence. The founder has
-- not settled kitchen hours; that is registered as `kitchen-hours` in
-- src/lib/content-gate.ts rather than guessed here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "armory"."service_hours" (
  "id" uuid PRIMARY KEY NOT NULL,
  "weekday" smallint NOT NULL,
  "opens_minute" integer NOT NULL,
  "closes_minute" integer NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "service_hours_weekday_idx"
  ON "armory"."service_hours" ("weekday");--> statement-breakpoint

-- One window may not be entered twice for the same weekday and start. Two
-- identical windows would not double a cover — the grid is a set of starts, not
-- a sum — but they would disagree the moment one is edited.
CREATE UNIQUE INDEX IF NOT EXISTS "service_hours_period_key"
  ON "armory"."service_hours" ("weekday", "opens_minute");--> statement-breakpoint

-- The same constraints `opening_hours` carries, for the same reasons. A window
-- that closes before it opens produces a negative day; a weekday outside 0–6
-- matches no calendar and would simply never render, which is the failure mode
-- nobody notices.
ALTER TABLE "armory"."service_hours"
  ADD CONSTRAINT service_hours_weekday_is_a_weekday
  CHECK (weekday BETWEEN 0 AND 6);--> statement-breakpoint

ALTER TABLE "armory"."service_hours"
  ADD CONSTRAINT service_hours_period_is_forward
  CHECK (opens_minute >= 0 AND closes_minute > opens_minute AND closes_minute <= 1440);--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. THE CHECK-IN CLOCK — §11.4
--
-- "The club's central operating promise is currently unmeasured… The console
-- can timestamp arrival and completion at almost no cost. Once it does, the
-- promise becomes a number that can be watched, and every claim made about the
-- portal reducing desk work becomes testable rather than asserted."
--
-- The specification budgeted two fields. It needs one: `checked_in_at` has
-- always recorded the completion, so what was missing is the START — the moment
-- the officer opened the sheet on a person already standing at the desk.
--
-- NULLABLE, and null means unmeasured rather than zero. Every participation
-- written before today has no start, and back-filling one would invent a
-- duration. More importantly a check-in must complete whether or not the clock
-- started: if a measurement bug could refuse a member at the counter, the
-- measurement would matter more than the thing it measures, which is how
-- instrumentation ends up switched off.
-- ---------------------------------------------------------------------------

ALTER TABLE "armory"."participations"
  ADD COLUMN IF NOT EXISTS "arrival_at" timestamp with time zone;--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. THE APPEND-ONLY GUARANTEE HAS TO BE TOLD ABOUT THE NEW COLUMN
--
-- §12 requires append-only tables to "reject update and delete at the DATABASE
-- level, not merely in application code", and 0002 installed that for
-- participations by enumerating every column that must stay byte-identical to
-- what was checked in.
--
-- An enumerated guard does not extend itself. `arrival_at` added and left out
-- of that tuple is a column on an append-only table that anyone may rewrite
-- afterwards — and it would be invisible, because the table would still refuse
-- every OTHER edit and the guarantee would look intact.
--
-- That matters more here than the column's own importance suggests. The point
-- of the check-in clock is that it measures the desk honestly; a duration that
-- can be adjusted after the fact is not a measurement, and the first person to
-- discover it can be adjusted will be somebody whose figures look bad.
--
-- Recreated whole rather than patched, because a trigger function is replaced
-- atomically and a half-edited guard has no safe intermediate state.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION armory.participations_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'armory.participations is append-only: a check-in is never deleted.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.checked_out_at IS NOT NULL AND NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at THEN
    RAISE EXCEPTION
      'This participation is already checked out (at %). A checkout is recorded once.',
      OLD.checked_out_at
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Every other column must be byte-identical to what was checked in.
  -- `arrival_at` joined this tuple in 0010; see the note above for why leaving
  -- it out would have been invisible.
  IF (NEW.id, NEW.session_id, NEW.person_id, NEW.role, NEW.host_person_id,
      NEW.lane_id, NEW.tier_snapshot, NEW.checked_in_at, NEW.arrival_at,
      NEW.checked_in_by_staff_id, NEW.recorded_at, NEW.device_id)
     IS DISTINCT FROM
     (OLD.id, OLD.session_id, OLD.person_id, OLD.role, OLD.host_person_id,
      OLD.lane_id, OLD.tier_snapshot, OLD.checked_in_at, OLD.arrival_at,
      OLD.checked_in_by_staff_id, OLD.recorded_at, OLD.device_id)
  THEN
    RAISE EXCEPTION
      'Only checked_out_at may be set on an existing participation.'
      USING HINT = 'To correct a check-in, record an incident or an audit entry citing it.',
        ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
