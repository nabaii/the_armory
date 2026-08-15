-- ============================================================================
-- A MEMBER'S PASSWORD — the portal sign-in for people the club already knows.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES IS NOT "THERE IS NO LOGIN"
--
-- There is one. `/sign-in` sends a passwordless email link and has since the
-- leagues product shipped. What did not exist was RECOGNITION: `members.
-- person_id` (drizzle/0005) is the column that resolves a portal session to a
-- person in the management system, and until this migration nothing anywhere
-- wrote it.
--
-- So an admitted member could sign in, and every §6.2 screen — Book, Account,
-- My shooting — correctly reported that they had no membership, because the
-- session could not be resolved to one. This table is how a member proves which
-- person they are, once, so that column can be set.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE AND NOT A COLUMN ON `people`
--
-- A password belongs to an account, not to a human, and most `people` rows —
-- guests, applicants — will never have one.
--
-- The throttle needs `failed_count` and `locked_until`, and a failed sign-in
-- should not write to the table the desk reads to check somebody in.
--
-- And §10's erasure redacts `people` in place. src/domain/erasure.ts carries a
-- test asserting every column of `people` is classified as identifying or
-- retained; a password column would have to be classified, and "retained" would
-- leave a working credential on an erased person while the erasure reported
-- success. A separate table is deleted outright by `erasePerson` — see the
-- `ON DELETE cascade` below, which is the same answer stated twice.
--
-- ---------------------------------------------------------------------------
-- THIS IS INTERIM. §9 WANTS OTP AND SAYS WHY.
--
--   §9, SMS: "One-time passcodes only… Test on all major local networks before
--    launch; THIS IS THE FRONT DOOR TO EVERY ACCOUNT."
--   §7: "POST /auth/otp/request, /auth/otp/verify"
--
-- No SMS provider is configured (docs/M10_security_review.md). A password is
-- what lets the club test the member portal end to end before that lands, and
-- it is built to be switched OFF rather than unpicked: nothing else reads this
-- table, and deleting every row disables password sign-in without touching a
-- person, a membership or a session.
--
-- When OTP arrives this is dropped or left dormant. Nothing is built on it.
-- ============================================================================

CREATE TABLE "armory"."member_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"must_change" boolean DEFAULT true NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_signed_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armory"."member_credentials" ADD CONSTRAINT "member_credentials_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_credentials_person_key" ON "armory"."member_credentials" USING btree ("person_id");