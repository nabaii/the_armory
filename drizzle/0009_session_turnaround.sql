-- ===========================================================================
-- THE OPERATIONAL BUFFER BETWEEN SESSIONS
--
-- Founder decision, 16 August 2026: "A standard session is 60 minutes. Make
-- the booking system slot-based. 60-minute default + 15-minute operational
-- buffer."
--
-- `session_minutes` already existed and holds the first half. This column holds
-- the second, and the two are deliberately separate rather than one combined
-- "slot length", because they belong to different people:
--
--   session_minutes      the MEMBER's. What their booking says, what the desk
--                        expects, and how long the lane is theirs.
--   turnaround_minutes   the CLUB's. Clearing the line, resetting targets,
--                        walking one relay off and briefing the next.
--
-- Folded into one number, a member booking 09:00 would appear to hold the lane
-- until 10:15 — which is not what they were sold and not what the desk would
-- enforce. Kept apart, the booking ends at 10:00 and the next bookable slot
-- starts at 10:15, which is what both parties actually agreed to.
--
-- ---------------------------------------------------------------------------
-- WHY NULL MEANS ZERO HERE AND NOTHING ELSEWHERE
--
-- Every other unset value in club_settings produces nothing rather than a
-- guess, because guessing an overage price bills somebody and guessing a
-- session length puts a number in front of members that nobody agreed. Zero
-- turnaround is different: it is a coherent operating decision — back-to-back
-- sessions — and it is exactly the behaviour every club running this system had
-- before this column existed. Defaulting to it invents nothing.
-- ===========================================================================

ALTER TABLE "armory"."club_settings" ADD COLUMN "turnaround_minutes" integer;--> statement-breakpoint

-- A buffer is a duration. Negative would overlap one session with the next,
-- which is the one value that would quietly hand two relays the same lane.
ALTER TABLE "armory"."club_settings"
  ADD CONSTRAINT club_settings_turnaround_is_not_negative
  CHECK (turnaround_minutes IS NULL OR turnaround_minutes >= 0);
