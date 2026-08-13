-- ============================================================================
-- ONE SIGN-IN, TWO SYSTEMS OF RECORD.
--
-- The portal (§6.2) is member-facing: book a session, invite a guest, see an
-- allowance. Every one of those reads and writes the MANAGEMENT system, and
-- until this migration a signed-in portal session could not be resolved to a
-- person in it.
--
-- The two products identify people differently and both are right to:
--
--   public.members    email + display name. A ladder needs a name to show and
--                     no phone number to show it with.
--   armory.people     phone, unique, E.164. src/db/armory/schema.ts: "The
--                     club's primary channel is WhatsApp (§9) and OTP is sent
--                     by SMS, so the phone number is the account identifier —
--                     email is optional and secondary, which is the reverse of
--                     the leagues product."
--
-- ---------------------------------------------------------------------------
-- WHY NOT A SECOND SIGN-IN
--
-- Build Specification §7 sketches an armoury identity group of its own
-- (`/auth/otp/request`, `/auth/otp/verify`), while stating that its resource
-- list is "indicative, not a contract. Shape it as the team prefers."
--
-- Two sign-ins for one club is a worse product than one: a member who books a
-- lane and checks a ladder should not hold two credentials, and the club should
-- not run two account-recovery paths for the same hundred people. So the portal
-- session stays the single front door and this column is what it resolves to.
--
-- The decision is reversible. If the club later wants phone-OTP as the primary
-- sign-in, this column is exactly the link that migration would need.
--
-- ---------------------------------------------------------------------------
-- WHY NULLABLE, AND WHY ON DELETE SET NULL
--
-- Nullable because a leagues account can exist before admission — §3.1 makes
-- applicant, guest and member states of a person, and someone who signed in to
-- look at a ladder is none of them yet.
--
-- SET NULL rather than CASCADE because §10's erasure path anonymises a person
-- IN PLACE rather than deleting them (see anonymisePerson in
-- src/server/armory/people.ts), so a delete here should never happen — and if
-- it somehow does, losing the link is the correct outcome. Cascading would
-- delete a leagues account, its display name and its standings history because
-- of a change in a different product's table.
-- ============================================================================

ALTER TABLE "members" ADD COLUMN "person_id" uuid;--> statement-breakpoint

ALTER TABLE "members"
  ADD CONSTRAINT "members_person_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "armory"."people"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- One leagues account per person. Without this, two email accounts could point
-- at the same human and the club would have two views of one member's
-- allowance — which §8.3 already shows is the failure mode that matters here.
CREATE UNIQUE INDEX "members_person_id_key"
  ON "members" USING btree ("person_id")
  WHERE "person_id" IS NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN "members"."person_id" IS
  'The same human in armory.people. The portal session resolves through this; see drizzle/0005.';
