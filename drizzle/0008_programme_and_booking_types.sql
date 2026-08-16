-- ===========================================================================
-- THE CLUB'S WEEK — opening hours, booking types, and the programme
--
-- Members Portal Design Specification §12, items 2, 4 and 5. Three pieces of
-- data work that were sequenced together for one reason: they touch the same
-- area and can be reviewed and deployed once.
--
--   2. Opening hours. "Currently blocks the booking calendar entirely."
--   4. booking_type and table capacity. "Ride it alongside item 2."
--   5. The events entity. "Net-new. Absent from M0-M10."
--
-- ---------------------------------------------------------------------------
-- WHAT THIS UNBLOCKS, AND WHAT IT DOES NOT
--
-- It unblocks the availability grid, the operating-rhythm feed, the one-off
-- feed, the red BOOK action and table-only bookings. It does NOT publish any
-- hours: the tables arrive empty, and an empty `opening_hours` produces no
-- slots and one honest sentence, exactly as it does today. Somebody still has
-- to tell the club's system when the club is open. That is the point — the
-- alternative is a plausible default week which works, survives into
-- production, and becomes the club's opening hours by accident.
--
-- ---------------------------------------------------------------------------
-- THE ONE DESTRUCTIVE-LOOKING LINE IS NOT
--
-- `bookings.discipline` drops NOT NULL. Nothing is dropped and no row changes:
-- every existing booking keeps its discipline, and the CHECK added at the
-- bottom makes the column mandatory again for exactly the bookings that touch
-- a firing line. What the nullability buys is the ability to express a booking
-- that does not — which is §7.4's design rule, and the point at which the
-- hospitality-first frame stops being a principle and becomes a column.
-- ===========================================================================

CREATE TYPE "armory"."booking_type" AS ENUM('shoot', 'table', 'both', 'spectate');--> statement-breakpoint
CREATE TYPE "armory"."programme_kind" AS ENUM('event', 'fixture', 'closure');--> statement-breakpoint
CREATE TABLE "armory"."events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "armory"."programme_kind" DEFAULT 'event' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"on_date" date NOT NULL,
	"starts_minute" integer,
	"ends_minute" integer,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "armory"."opening_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_minute" integer NOT NULL,
	"closes_minute" integer NOT NULL,
	"staffed" boolean DEFAULT true NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armory"."bookings" ALTER COLUMN "discipline" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "armory"."bookings" ADD COLUMN "booking_type" "armory"."booking_type" DEFAULT 'shoot' NOT NULL;--> statement-breakpoint
ALTER TABLE "armory"."club_settings" ADD COLUMN "session_minutes" integer;--> statement-breakpoint
ALTER TABLE "armory"."club_settings" ADD COLUMN "booking_lead_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "armory"."club_settings" ADD COLUMN "table_capacity" integer;--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "armory"."events" USING btree ("on_date");--> statement-breakpoint
CREATE INDEX "events_published_idx" ON "armory"."events" USING btree ("published","on_date");--> statement-breakpoint
CREATE INDEX "opening_hours_weekday_idx" ON "armory"."opening_hours" USING btree ("weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_hours_period_key" ON "armory"."opening_hours" USING btree ("weekday","opens_minute");--> statement-breakpoint

-- ===========================================================================
-- STRUCTURAL RULES — hand-written, in the manner of 0002
--
-- Drizzle expresses tables. It does not express "a booking that consumes no
-- lane may not name a discipline", and §12's definition of done puts rules of
-- that kind at the database level rather than in application code. Each one
-- below is a sentence from the specification that would otherwise be enforced
-- by whichever screen happened to remember it.
-- ===========================================================================

-- §7.4: shoot and both occupy a firing line and must say which; table and
-- spectate occupy none and must not. A discipline on a booking that consumes
-- no lane is how the availability query starts counting people who are not
-- shooting against the range's capacity.
ALTER TABLE "armory"."bookings"
  ADD CONSTRAINT bookings_discipline_matches_type
  CHECK (
    (booking_type IN ('shoot', 'both') AND discipline IS NOT NULL)
    OR
    (booking_type IN ('table', 'spectate') AND discipline IS NULL)
  );--> statement-breakpoint

-- A period must have length and must fall inside one day. Minutes since Lagos
-- midnight, so 1440 is the end of it. A period that closes before it opens
-- produces a silently empty day rather than an error, which is the failure a
-- founder would never find.
ALTER TABLE "armory"."opening_hours"
  ADD CONSTRAINT opening_hours_period_is_ordered
  CHECK (closes_minute > opens_minute);--> statement-breakpoint

ALTER TABLE "armory"."opening_hours"
  ADD CONSTRAINT opening_hours_period_is_within_a_day
  CHECK (opens_minute >= 0 AND closes_minute <= 1440);--> statement-breakpoint

ALTER TABLE "armory"."opening_hours"
  ADD CONSTRAINT opening_hours_weekday_is_a_weekday
  CHECK (weekday BETWEEN 0 AND 6);--> statement-breakpoint

-- The same shape for an event's optional times: either both are absent (an
-- all-day entry, which is how the club will write most of them) or they are
-- ordered and inside the day.
ALTER TABLE "armory"."events"
  ADD CONSTRAINT events_times_are_absent_or_ordered
  CHECK (
    (starts_minute IS NULL AND ends_minute IS NULL)
    OR
    (
      starts_minute IS NOT NULL AND ends_minute IS NOT NULL
      AND ends_minute > starts_minute
      AND starts_minute >= 0 AND ends_minute <= 1440
    )
  );--> statement-breakpoint

-- Capacities are counts. Zero is meaningful — a club with no covers has none —
-- and negative is a data entry error that would read as capacity.
ALTER TABLE "armory"."club_settings"
  ADD CONSTRAINT club_settings_capacities_are_not_negative
  CHECK (
    (table_capacity IS NULL OR table_capacity >= 0)
    AND (session_minutes IS NULL OR session_minutes > 0)
    AND (booking_lead_time_minutes IS NULL OR booking_lead_time_minutes >= 0)
  );
