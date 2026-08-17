-- ===========================================================================
-- SEPARATION OF DUTIES, AS ROWS
--
-- Management System Design Specification §5, §12.1, §18.
--
--   §5.1: "Separation of duties becomes visible, and refused rather than
--    trusted… Written in a charter, those are promises. Generated into the
--    navigation, they are facts."
--
-- The authority a member of staff holds moves out of `staff_users.role` and
-- into rows, because a role is a label and authority has a lifetime: it
-- expires, it is attributed, and it is revoked rather than deleted.
--
-- `staff_users.role` is untouched and keeps the job it already had — naming the
-- post, and resolving the founder for apply-credentials.ts and permits.ts.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. THE POSTS THE CLUB ACTUALLY HAS
--
-- Additive only. The three original values are load-bearing outside permission
-- and none is renamed or removed.
--
-- ADD VALUE inside a transaction is permitted from PostgreSQL 12 provided the
-- new value is not USED in the same transaction. Nothing below references these
-- labels, so this is safe under drizzle-kit's transactional migrate.
-- ---------------------------------------------------------------------------

ALTER TYPE "armory"."staff_role" ADD VALUE IF NOT EXISTS 'front_of_house';--> statement-breakpoint
ALTER TYPE "armory"."staff_role" ADD VALUE IF NOT EXISTS 'armourer';--> statement-breakpoint
ALTER TYPE "armory"."staff_role" ADD VALUE IF NOT EXISTS 'duty_manager';--> statement-breakpoint
ALTER TYPE "armory"."staff_role" ADD VALUE IF NOT EXISTS 'finance';--> statement-breakpoint
ALTER TYPE "armory"."staff_role" ADD VALUE IF NOT EXISTS 'safety_officer';--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. THE GRANT VOCABULARY
--
-- Every split here exists because a FORBIDDEN COMBINATION needs it; nothing is
-- split for tidiness. See src/domain/enums.ts for which, and why.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "armory"."staff_grant" AS ENUM (
    'desk',
    'programme',
    'people_read',
    'people_write',
    'custody',
    'safety_report',
    'safety_manage',
    'ledger',
    'intelligence_operational',
    'intelligence_commercial',
    'grants'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. THE GRANTS THEMSELVES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "armory"."staff_grants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "staff_user_id" uuid NOT NULL,
  "grant" "armory"."staff_grant" NOT NULL,
  "granted_by_staff_id" uuid,
  "reason" text NOT NULL,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by_staff_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "armory"."staff_grants"
  ADD CONSTRAINT "staff_grants_staff_user_id_fk"
  FOREIGN KEY ("staff_user_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "armory"."staff_grants"
  ADD CONSTRAINT "staff_grants_granted_by_fk"
  FOREIGN KEY ("granted_by_staff_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "armory"."staff_grants"
  ADD CONSTRAINT "staff_grants_revoked_by_fk"
  FOREIGN KEY ("revoked_by_staff_id") REFERENCES "armory"."staff_users"("id")
  ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_grants_staff_idx"
  ON "armory"."staff_grants" ("staff_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "staff_grants_expiry_idx"
  ON "armory"."staff_grants" ("expires_at");--> statement-breakpoint

-- One LIVE row per person per grant. Partial on revoked_at IS NULL, so the
-- history of a grant given, taken back and given again survives — which is
-- precisely the sequence a register exists to show — while the same authority
-- cannot be held twice at once.
CREATE UNIQUE INDEX IF NOT EXISTS "staff_grants_live_key"
  ON "armory"."staff_grants" ("staff_user_id", "grant")
  WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- §12.1 makes a reason mandatory on role assignment, and a mandatory field that
-- accepts 'ok' is not mandatory. The same twelve characters `applyOverride`
-- demands, enforced where the row lands rather than only where it is built.
ALTER TABLE "armory"."staff_grants"
  ADD CONSTRAINT "staff_grants_reason_is_a_reason"
  CHECK (length(btrim(reason)) >= 12);--> statement-breakpoint

-- An acting grant that lapses before it was created never granted anything, and
-- a row saying otherwise is a register entry that misleads whoever reads it.
ALTER TABLE "armory"."staff_grants"
  ADD CONSTRAINT "staff_grants_expiry_follows_issue"
  CHECK (expires_at IS NULL OR expires_at > created_at);--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. A GRANT IS REVOKED, NEVER DELETED
--
-- §12's append-only class, applied to the governance record. A deleted row is a
-- separation that was crossed and then tidied away, and the tidying is the part
-- an auditor would most want to see.
--
-- UPDATE is permitted only to revoke: setting revoked_at and revoked_by, once,
-- from null. Everything else must stay byte-identical — the same shape as the
-- participations guard in 0002, and for the same reason.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION armory.staff_grants_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'armory.staff_grants is append-only: a grant is revoked, never deleted.'
      USING HINT = 'Set revoked_at. The history is the point.',
        ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION
      'This grant was already revoked at %. A revocation is recorded once.',
      OLD.revoked_at
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.id, NEW.staff_user_id, NEW.grant, NEW.granted_by_staff_id,
      NEW.reason, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.staff_user_id, OLD.grant, OLD.granted_by_staff_id,
      OLD.reason, OLD.expires_at, OLD.created_at)
  THEN
    RAISE EXCEPTION
      'Only revoked_at and revoked_by_staff_id may be set on an existing grant.'
      USING HINT = 'To change what somebody holds, revoke this grant and issue another.',
        ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS staff_grants_guard ON armory.staff_grants;--> statement-breakpoint

CREATE TRIGGER staff_grants_guard
  BEFORE UPDATE OR DELETE ON armory.staff_grants
  FOR EACH ROW EXECUTE FUNCTION armory.staff_grants_guard();--> statement-breakpoint

-- TRUNCATE bypasses row-level triggers, and without this the whole guarantee
-- has a one-word bypass that is invisible until somebody finds it. The same
-- second guard every append-only table in 0002 carries.
CREATE OR REPLACE FUNCTION armory.staff_grants_no_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'armory.staff_grants is append-only: it cannot be truncated.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS staff_grants_no_truncate ON armory.staff_grants;--> statement-breakpoint

CREATE TRIGGER staff_grants_no_truncate
  BEFORE TRUNCATE ON armory.staff_grants
  FOR EACH STATEMENT EXECUTE FUNCTION armory.staff_grants_no_truncate();
