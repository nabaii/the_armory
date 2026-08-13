-- ============================================================================
-- DEVICE TOKENS — what makes /sync/* something other than an open endpoint.
--
-- §3.1: "Desk and lane surfaces load only on a registered, unrevoked device."
-- §10:  "No shared logins. Device-bound sessions with a short local unlock."
-- §10:  "A lost or stolen tablet can be revoked server-side."
--
-- The devices table arrived in 0001 with an identity and a revocation timestamp
-- and no secret, which is enough to NAME a device and not enough to
-- AUTHENTICATE one. That gap matters more here than it would elsewhere:
-- GET /sync/daypack returns the full roster, the firearm register and every
-- guest invitation in the window. Without a secret on this table, knowing a
-- device UUID — which every pushed record carries — is enough to fetch all of it.
--
-- Generated from src/db/armory/schema.ts, where the full reasoning for the hash
-- choice and for the absence of an expiry lives on the columns themselves.
-- ============================================================================

ALTER TABLE "armory"."devices" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "armory"."devices" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_key" ON "armory"."devices" USING btree ("token_hash") WHERE "armory"."devices"."token_hash" IS NOT NULL;
