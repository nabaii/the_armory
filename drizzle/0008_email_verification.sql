-- ============================================================================
-- PROVING AN EMAIL ADDRESS — a second way in, and the only way back.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM: ONE DOOR, AND NO WAY THROUGH IT IF THE KEY IS LOST
--
-- §3.1 makes the phone the club's identifier and leaves `people.email`
-- nullable, which is correct. The consequence, unnoticed until a member had it:
-- a member with no email has exactly one way in — phone and password — and no
-- way to recover it. `linkPortalAccount` synthesises `person+<id>@armory.invalid`
-- for `members.email`, which is NOT NULL, so the magic-link door is not merely
-- unused for them, it is addressed to a mailbox RFC 2606 guarantees can never
-- exist.
--
-- Nothing in the application wrote an email address either — not the portal,
-- not the desk. The only writers were scripts/bootstrap.ts and
-- scripts/apply-credentials.ts, both of which need a terminal and the database
-- password. A member locked out of their own club could not fix it from the
-- device they were locked out on.
--
-- ---------------------------------------------------------------------------
-- WHY A TOKEN TABLE AND NOT A COLUMN
--
-- Because a proposed address must be inert until it is proved. Written straight
-- to `people.email` it would immediately become the club's way of reaching that
-- member, and src/server/armory/member-password.ts already says what an
-- unverified address is worth: "One transposed character that happens to land
-- on a real address hands a stranger a member's bookings, guest allowance,
-- shooting history and account balance."
--
-- So the address waits here, where nothing reads it, until the member proves
-- the mailbox is theirs. `people.email_verified_at` then records that it was
-- proved — the column that separates an address staff typed from one a member
-- owns.
--
-- ---------------------------------------------------------------------------
-- WHY NOT `auth_tokens`, WHICH IS ALREADY EXACTLY THIS SHAPE
--
-- It is the same shape and the opposite meaning. Redeeming an `auth_tokens` row
-- signs the holder in as the account for that address; pointed at an address a
-- member is merely proposing, it would find or create the wrong member row and
-- issue a session for it. Redeeming one of these proves a mailbox and grants
-- nothing.
--
-- The security properties are copied deliberately: the raw token never lands in
-- the database, only its SHA-256, for the reason src/server/auth/session.ts
-- gives about session cookies — a token that leaks into a log or a screenshot
-- must not be usable. Single use, and expiring, so a link forwarded or left in
-- a mailbox stops working.
-- ============================================================================

CREATE TABLE "armory"."email_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armory"."people" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "armory"."email_verifications" ADD CONSTRAINT "email_verifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verifications_token_hash_key" ON "armory"."email_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verifications_person_idx" ON "armory"."email_verifications" USING btree ("person_id");