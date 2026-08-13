-- ============================================================================
-- STAFF SESSIONS — what makes "attributable to a named person" possible.
--
-- §10: "No shared logins. Every staff action attributable to a named person.
--       Device-bound sessions with a short local unlock. Shared accounts
--       destroy the attribution the custody log exists to provide."
--
-- Every write in this system carries an `actor_staff_id`, and until this
-- migration there was no way to obtain one. The consequence is recorded in
-- docs/M1_offline_acceptance.md: check-ins made during M1 "name a tablet and
-- honestly not a human". M3 makes that untenable rather than merely regrettable
-- — an admission decision is the one action in the club that most obviously
-- belongs to a person, and `applications.decided_by_staff_id` has no honest
-- value without this table.
--
-- ---------------------------------------------------------------------------
-- WHY THE SESSION IS BOUND TO A DEVICE
--
-- Because §10 says so, and because the alternative is a password. A four-to-six
-- digit PIN is not a credential on its own — it is the second factor on a
-- tablet the founder registered and can revoke. The device token (0003) proves
-- WHICH TABLET; the PIN proves WHICH OFFICER is holding it. Neither is
-- sufficient alone and that is the design, not a compromise.
--
-- It also means device revocation is total. Revoking a stolen tablet ends every
-- staff session on it, because the sessions cascade from the device row.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS NO `pin_attempts` COLUMN HERE
--
-- Rate limiting a PIN matters — six digits is a million guesses and a patient
-- attacker with the tablet has all of them. But the counter belongs on
-- `staff_users`, not on a session: an attacker guessing a PIN has no session
-- yet, so a per-session counter would reset on every attempt and count nothing.
-- The column is added to staff_users below for that reason.
--
-- Generated to match src/db/armory/schema.ts, where the reasoning for the hash
-- choice and the binding lives on the columns themselves.
-- ============================================================================

CREATE TABLE "armory"."staff_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "armory"."staff_sessions"
  ADD CONSTRAINT "staff_sessions_staff_user_id_fk"
  FOREIGN KEY ("staff_user_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "armory"."staff_sessions"
  ADD CONSTRAINT "staff_sessions_device_id_fk"
  FOREIGN KEY ("device_id") REFERENCES "armory"."devices"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "staff_sessions_token_hash_key"
  ON "armory"."staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_idx"
  ON "armory"."staff_sessions" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_device_idx"
  ON "armory"."staff_sessions" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_expiry_idx"
  ON "armory"."staff_sessions" USING btree ("expires_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- PIN THROTTLING — on the user, not on the session.
--
-- A six-digit PIN is a million guesses. On a tablet in a public building, an
-- attacker has physical access and unlimited time, so the only thing standing
-- between them and a named officer's identity is how fast they may try.
--
-- `pin_failed_count` and `pin_locked_until` live here rather than in memory
-- because the desk is a PWA that can be force-quit between attempts, and an
-- in-process counter would be reset by closing the app.
-- ---------------------------------------------------------------------------

ALTER TABLE "armory"."staff_users"
  ADD COLUMN "pin_failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "armory"."staff_users"
  ADD COLUMN "pin_locked_until" timestamp with time zone;--> statement-breakpoint

COMMENT ON TABLE "armory"."staff_sessions" IS
  '§10 device-bound staff sessions. A session exists only on a registered device; revoking the device ends every session on it.';
