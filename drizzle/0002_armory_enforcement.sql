-- ===========================================================================
-- THE ARMORY MANAGEMENT SYSTEM — INTEGRITY ENFORCEMENT
--
-- Build Specification §12, Definition of done:
--
--   "Every append-only table rejects update and delete at the DATABASE LEVEL,
--    not merely in application code."
--
-- That sentence is why this file exists and why it is hand-written rather than
-- generated. Drizzle expresses tables; it does not express "this table may
-- never be updated", "this counter is derived and may not be set", or "an
-- override without a reason is not an override". Those are the rules the
-- club's licence rests on, and a rule enforced only in TypeScript is a rule
-- that survives exactly until someone writes a migration script, opens psql to
-- fix a typo, or adds a second service.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ENFORCED HERE
--
--   1. Append-only tables reject UPDATE and DELETE.                    §1.2(3)
--   2. Two near-append-only tables permit exactly one narrow mutation. §3.3
--   3. firearms.status is DERIVED from custody_events and cannot be
--      written by anything else.                                       §3.4
--   4. Derived counters: ammunition remaining, account balance.        §3.4/3.5
--   5. Structural rules the model states in prose.                     §3
--   6. Sequential, never-reused member numbers.                        §3.1
--
-- ---------------------------------------------------------------------------
-- ON THE ESCAPE HATCH
--
-- There is none, deliberately. §3.4 is explicit — "No update. No delete.
-- Ever." A superuser can still drop the trigger, and that is the correct
-- boundary: it requires someone with database ownership to take a deliberate,
-- logged action, rather than an ORM call doing it by accident at 9pm on a
-- Friday. Correcting a custody event is a `correction` row, which is an
-- INSERT, and which this file leaves entirely unobstructed.
-- ===========================================================================


-- ===========================================================================
-- 0. UUIDv7 IN THE DATABASE TOO
--
-- §2 requires UUIDv7 keys "generated client-side where the record can
-- originate offline", and src/lib/uuidv7.ts does exactly that — every write
-- from the portal, the desk or the lane names its own row before the network
-- is involved, which is what makes §7's idempotency work.
--
-- But not every row comes from a device. Seed data, the staging fixture set
-- §2.1 asks for, a migration backfill, a founder running one statement in
-- psql — all of those would otherwise have to invent an id by hand, and the
-- first person to reach for gen_random_uuid() would quietly put a v4 in a
-- column the whole system assumes is time-ordered.
--
-- So the database can mint one too. Postgres gained a native uuidv7() only in
-- v18; this is the same layout in plpgsql, and it needs no extension —
-- randomness comes from gen_random_uuid(), which is built in from v13.
--
-- The client-side generator remains the primary path. This is the floor.
-- ===========================================================================

CREATE OR REPLACE FUNCTION armory.uuidv7() RETURNS uuid
  LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_millis bigint;
  v_bytes  bytea;
BEGIN
  v_millis := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  -- 16 random bytes, from the built-in v4 generator.
  v_bytes := uuid_send(gen_random_uuid());

  -- Bytes 0-5: 48-bit big-endian millisecond timestamp.
  v_bytes := set_byte(v_bytes, 0, ((v_millis >> 40) & 255)::int);
  v_bytes := set_byte(v_bytes, 1, ((v_millis >> 32) & 255)::int);
  v_bytes := set_byte(v_bytes, 2, ((v_millis >> 24) & 255)::int);
  v_bytes := set_byte(v_bytes, 3, ((v_millis >> 16) & 255)::int);
  v_bytes := set_byte(v_bytes, 4, ((v_millis >>  8) & 255)::int);
  v_bytes := set_byte(v_bytes, 5, ( v_millis        & 255)::int);

  -- Byte 6 high nibble: version 7. Byte 8 high bits: RFC 4122 variant.
  v_bytes := set_byte(v_bytes, 6, ((get_byte(v_bytes, 6) & 15) | 112));
  v_bytes := set_byte(v_bytes, 8, ((get_byte(v_bytes, 8) & 63) | 128));

  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION armory.uuidv7() IS
  'RFC 9562 UUIDv7. Mirrors src/lib/uuidv7.ts for rows that do not originate on a device.';

-- Apply it as the default on every uuid primary key in the schema. Written as
-- a loop rather than 30 ALTER statements so that a table added later cannot be
-- forgotten — re-running this block picks it up.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'armory'
      AND c.relkind = 'r'
      AND a.attname = 'id'
      AND a.atttypid = 'uuid'::regtype
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'ALTER TABLE armory.%I ALTER COLUMN id SET DEFAULT armory.uuidv7()',
      r.table_name
    );
  END LOOP;
END;
$$;


-- ===========================================================================
-- 1. APPEND-ONLY
--
-- §8.2 lists the append-only class: custody_events, waiver_signatures, rounds,
-- ammunition_issues, participations, incidents, account_transactions,
-- audit_log. Two of those — participations and ammunition_issues — have one
-- legitimate later mutation each, so they get their own guards in section 2.
--
-- The error message names the correction path, because the person who hits
-- this is a developer at 2am and the message is the only documentation they
-- will read.
-- ===========================================================================

CREATE OR REPLACE FUNCTION armory.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Table armory.% is append-only (Build Specification §1.2 rule 3). % is not permitted.',
    TG_TABLE_NAME, TG_OP
    USING HINT =
      'Record a new row that references the one being corrected. '
      'Nothing in this system is edited and nothing is deleted.',
      ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION armory.reject_mutation() IS
  'Append-only guard. §12 requires this at the database level, not in application code.';

-- ---------------------------------------------------------------------------
-- TRUNCATE NEEDS ITS OWN GUARD.
--
-- A row-level BEFORE DELETE trigger does not fire for TRUNCATE — Postgres
-- removes the rows without visiting them. So `TRUNCATE armory.custody_events`
-- would empty the club's licence-bearing register while every guard above
-- stayed silent. That is the single largest hole an append-only design can
-- have, and it is invisible until someone finds it.
--
-- TRUNCATE triggers are statement-level and cannot be FOR EACH ROW.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION armory.reject_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Table armory.% is append-only and cannot be truncated (Build Specification §1.2 rule 3).',
    TG_TABLE_NAME
    USING HINT = 'There is no bulk-erase path for these tables by design.',
      ERRCODE = 'restrict_violation';
END;
$$;

-- custody_events — §3.4: "No update. No delete. Ever."
CREATE TRIGGER custody_events_append_only
  BEFORE UPDATE OR DELETE ON armory.custody_events
  FOR EACH ROW EXECUTE FUNCTION armory.reject_mutation();

CREATE TRIGGER custody_events_no_truncate
  BEFORE TRUNCATE ON armory.custody_events
  EXECUTE FUNCTION armory.reject_truncate();

-- waiver_signatures — §3.1: "A resignature is a new row."
CREATE TRIGGER waiver_signatures_append_only
  BEFORE UPDATE OR DELETE ON armory.waiver_signatures
  FOR EACH ROW EXECUTE FUNCTION armory.reject_mutation();

CREATE TRIGGER waiver_signatures_no_truncate
  BEFORE TRUNCATE ON armory.waiver_signatures
  EXECUTE FUNCTION armory.reject_truncate();

-- rounds — §3.3. A corrected score is a new row citing the old one.
CREATE TRIGGER rounds_append_only
  BEFORE UPDATE OR DELETE ON armory.rounds
  FOR EACH ROW EXECUTE FUNCTION armory.reject_mutation();

CREATE TRIGGER rounds_no_truncate
  BEFORE TRUNCATE ON armory.rounds
  EXECUTE FUNCTION armory.reject_truncate();

-- incidents — §3.3. The narrative of what happened on a live range is
-- evidence; follow-up belongs in a new row, not in an edit to this one.
CREATE TRIGGER incidents_append_only
  BEFORE UPDATE OR DELETE ON armory.incidents
  FOR EACH ROW EXECUTE FUNCTION armory.reject_mutation();

CREATE TRIGGER incidents_no_truncate
  BEFORE TRUNCATE ON armory.incidents
  EXECUTE FUNCTION armory.reject_truncate();

-- account_transactions — §3.5: "Ledger, not a mutable balance."
CREATE TRIGGER account_transactions_append_only
  BEFORE UPDATE OR DELETE ON armory.account_transactions
  FOR EACH ROW EXECUTE FUNCTION armory.reject_mutation();

CREATE TRIGGER account_transactions_no_truncate
  BEFORE TRUNCATE ON armory.account_transactions
  EXECUTE FUNCTION armory.reject_truncate();

-- audit_log — §3.6. An audit log that can be edited is not an audit log.
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON armory.audit_log
  FOR EACH ROW EXECUTE FUNCTION armory.reject_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON armory.audit_log
  EXECUTE FUNCTION armory.reject_truncate();


-- ===========================================================================
-- 2. NEAR-APPEND-ONLY — one narrow mutation each, and no other.
--
-- These two tables are in the append-only class but have a real second write
-- in their lifecycle. Rather than exclude them from the guarantee, each gets a
-- trigger permitting precisely the fields that later write touches, once.
-- ===========================================================================

-- participations — §3.3: "APPEND-ONLY on check-in."
--
-- The one permitted mutation is setting checked_out_at, from NULL, once.
-- Everything else — who, when, under whose hosting, on which lane, at what
-- tier — is the record that an incident investigation starts from.
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
  IF (NEW.id, NEW.session_id, NEW.person_id, NEW.role, NEW.host_person_id,
      NEW.lane_id, NEW.tier_snapshot, NEW.checked_in_at,
      NEW.checked_in_by_staff_id, NEW.recorded_at, NEW.device_id)
     IS DISTINCT FROM
     (OLD.id, OLD.session_id, OLD.person_id, OLD.role, OLD.host_person_id,
      OLD.lane_id, OLD.tier_snapshot, OLD.checked_in_at,
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

CREATE TRIGGER participations_guard
  BEFORE UPDATE OR DELETE ON armory.participations
  FOR EACH ROW EXECUTE FUNCTION armory.participations_guard();

CREATE TRIGGER participations_no_truncate
  BEFORE TRUNCATE ON armory.participations
  EXECUTE FUNCTION armory.reject_truncate();

-- ammunition_issues — §3.4: reconciled per participation, once.
--
-- "qty_issued must equal qty_fired plus qty_returned at reconciliation." The
-- check is here rather than in the application because it is the one arithmetic
-- statement the club's ammunition accounting rests on, and §6.4 will not let a
-- range be locked until it holds.
CREATE OR REPLACE FUNCTION armory.ammunition_issues_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'armory.ammunition_issues is append-only: an issue is never deleted.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.reconciled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This ammunition issue was already reconciled at %.', OLD.reconciled_at
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.id, NEW.lot_id, NEW.participation_id, NEW.qty_issued,
      NEW.issued_by_staff_id, NEW.issued_at, NEW.recorded_at, NEW.device_id)
     IS DISTINCT FROM
     (OLD.id, OLD.lot_id, OLD.participation_id, OLD.qty_issued,
      OLD.issued_by_staff_id, OLD.issued_at, OLD.recorded_at, OLD.device_id)
  THEN
    RAISE EXCEPTION
      'Only the reconciliation fields may be set on an ammunition issue.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.reconciled_at IS NOT NULL THEN
    IF NEW.qty_fired IS NULL OR NEW.qty_returned IS NULL THEN
      RAISE EXCEPTION
        'Reconciling needs both a fired and a returned count.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.qty_issued <> NEW.qty_fired + NEW.qty_returned THEN
      RAISE EXCEPTION
        'Ammunition does not balance: % issued, % fired, % returned (§3.4).',
        NEW.qty_issued, NEW.qty_fired, NEW.qty_returned
        USING HINT = 'Fired plus returned must equal issued before a session can close.',
          ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ammunition_issues_guard
  BEFORE UPDATE OR DELETE ON armory.ammunition_issues
  FOR EACH ROW EXECUTE FUNCTION armory.ammunition_issues_guard();

CREATE TRIGGER ammunition_issues_no_truncate
  BEFORE TRUNCATE ON armory.ammunition_issues
  EXECUTE FUNCTION armory.reject_truncate();


-- ===========================================================================
-- 3. FIREARM STATUS IS DERIVED
--
-- §3.4, the architectural instruction:
--
--   "custody_events is append-only and is the sole source of truth for where
--    any firearm is. Firearm status is derived from it, not maintained
--    independently — if the two can disagree, they eventually will."
--
-- So the column is maintained here and nowhere else. Two mechanisms:
--
--   · An AFTER INSERT trigger on custody_events recomputes the firearm.
--   · A BEFORE UPDATE trigger on firearms rejects any other writer.
--
-- ⚠ THIS DERIVATION IS IMPLEMENTED TWICE, ON PURPOSE.
--
-- The mapping below is the same mapping as STATUS_BY_EVENT in
-- src/domain/state-machines.ts, which the desk uses to show status offline
-- from the day pack. The two must agree; changing one is changing both, in the
-- same commit.
-- ===========================================================================

CREATE OR REPLACE FUNCTION armory.derive_firearm_status(p_firearm_id uuid)
  RETURNS armory.firearm_status
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (
      SELECT CASE e.event_type
               WHEN 'issued'                THEN 'issued'
               WHEN 'returned'              THEN 'in_service'
               WHEN 'brought_in'            THEN 'in_service'
               WHEN 'taken_out'             THEN 'off_site'
               WHEN 'stored'                THEN 'in_storage'
               WHEN 'withdrawn'             THEN 'in_service'
               WHEN 'sent_for_service'      THEN 'at_service'
               WHEN 'returned_from_service' THEN 'in_service'
               WHEN 'decommissioned'        THEN 'decommissioned'
             END::armory.firearm_status
      FROM armory.custody_events e
      WHERE e.firearm_id = p_firearm_id
        AND e.event_type <> 'correction'
        -- §1.2 rule 3: a correction withdraws the event it references, so
        -- events that have been corrected are not part of the derivation.
        AND NOT EXISTS (
          SELECT 1 FROM armory.custody_events c
          WHERE c.corrects_event_id = e.id
        )
      -- Tie-broken by id, which is UUIDv7 and therefore time-ordered. Two
      -- events share a timestamp whenever an outbox replays a batch.
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT 1
    ),
    'in_service'::armory.firearm_status
  );
$$;

-- The session flag that distinguishes the derivation from any other writer.
CREATE OR REPLACE FUNCTION armory.apply_firearm_status(p_firearm_id uuid)
  RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('armory.deriving_status', 'on', true);
  UPDATE armory.firearms
     SET status = armory.derive_firearm_status(p_firearm_id),
         updated_at = now()
   WHERE id = p_firearm_id;
  PERFORM set_config('armory.deriving_status', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION armory.custody_events_recompute() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM armory.apply_firearm_status(NEW.firearm_id);
  -- A correction may reference an event on this same firearm; recomputing the
  -- corrected event's firearm too costs nothing and covers the case where an
  -- officer corrected an event recorded against the WRONG firearm entirely.
  IF NEW.corrects_event_id IS NOT NULL THEN
    PERFORM armory.apply_firearm_status(
      (SELECT firearm_id FROM armory.custody_events WHERE id = NEW.corrects_event_id)
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER custody_events_recompute
  AFTER INSERT ON armory.custody_events
  FOR EACH ROW EXECUTE FUNCTION armory.custody_events_recompute();

CREATE OR REPLACE FUNCTION armory.firearms_status_is_derived() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('armory.deriving_status', true), 'off') <> 'on'
  THEN
    RAISE EXCEPTION
      'firearms.status is derived from armory.custody_events and cannot be set directly (§3.4).'
      USING HINT =
        'Record the custody event that actually happened. The status will follow.',
        ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER firearms_status_is_derived
  BEFORE UPDATE ON armory.firearms
  FOR EACH ROW EXECUTE FUNCTION armory.firearms_status_is_derived();


-- ===========================================================================
-- 4. THE OTHER DERIVED COUNTERS
--
-- Same principle, same reason. §3.4: ammunition remaining is "derived from
-- issues, not decremented independently". §3.5: an account balance is
-- "derived from account_transactions, never written directly".
-- ===========================================================================

CREATE OR REPLACE FUNCTION armory.ammunition_lots_recompute() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_lot uuid := COALESCE(NEW.lot_id, OLD.lot_id);
BEGIN
  UPDATE armory.ammunition_lots l
     SET quantity_remaining = l.quantity_received - COALESCE((
           -- Before reconciliation the whole issued quantity is out of the
           -- lot. After it, only what was actually fired has left.
           SELECT SUM(CASE WHEN i.reconciled_at IS NULL
                           THEN i.qty_issued
                           ELSE i.qty_fired END)
           FROM armory.ammunition_issues i
           WHERE i.lot_id = l.id
         ), 0),
         updated_at = now()
   WHERE l.id = v_lot;
  RETURN NULL;
END;
$$;

CREATE TRIGGER ammunition_issues_recompute_lot
  AFTER INSERT OR UPDATE ON armory.ammunition_issues
  FOR EACH ROW EXECUTE FUNCTION armory.ammunition_lots_recompute();

CREATE OR REPLACE FUNCTION armory.accounts_recompute() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE armory.accounts a
     SET balance_kobo = COALESCE((
           SELECT SUM(CASE WHEN t.direction = 'credit'
                           THEN t.amount_kobo ELSE -t.amount_kobo END)
           FROM armory.account_transactions t
           WHERE t.account_id = a.id
         ), 0),
         updated_at = now()
   WHERE a.id = NEW.account_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER account_transactions_recompute
  AFTER INSERT ON armory.account_transactions
  FOR EACH ROW EXECUTE FUNCTION armory.accounts_recompute();


-- ===========================================================================
-- 5. STRUCTURAL RULES THE MODEL STATES IN PROSE
--
-- Each of these is a sentence in §3 that would otherwise be enforced only by
-- the code path that happens to be writing.
-- ===========================================================================

-- §3.1: "Exactly one active version at a time."
CREATE UNIQUE INDEX waiver_versions_one_active
  ON armory.waiver_versions ((is_active))
  WHERE is_active;

-- §3.3: "Every guest_shooter must carry a guest_invitation_id."
-- The join between the acquisition funnel and the door. An unattributed guest
-- is both a lost conversion metric and a person nobody authorised.
ALTER TABLE armory.booking_participants
  ADD CONSTRAINT booking_participants_guest_needs_invitation
  CHECK (role <> 'guest_shooter' OR guest_invitation_id IS NOT NULL);

-- §3.3: "host_person_id required when role is guest_shooter."
-- This column is what the host-presence rule in §4 is evaluated against.
ALTER TABLE armory.participations
  ADD CONSTRAINT participations_guest_needs_host
  CHECK (role <> 'guest_shooter' OR host_person_id IS NOT NULL);

-- A person cannot host themselves.
ALTER TABLE armory.participations
  ADD CONSTRAINT participations_host_is_someone_else
  CHECK (host_person_id IS NULL OR host_person_id <> person_id);

-- §3.4: "owner_person_id and licence_id required when ownership is member."
ALTER TABLE armory.firearms
  ADD CONSTRAINT firearms_member_owned_needs_owner
  CHECK (
    ownership <> 'member'
    OR (owner_person_id IS NOT NULL AND licence_id IS NOT NULL)
  );

-- A club firearm has no owner. Stated both ways so neither drifts.
ALTER TABLE armory.firearms
  ADD CONSTRAINT firearms_club_owned_has_no_owner
  CHECK (ownership <> 'club' OR owner_person_id IS NULL);

-- §3.4: corrects_event_id belongs to a correction and to nothing else.
ALTER TABLE armory.custody_events
  ADD CONSTRAINT custody_events_correction_cites_an_event
  CHECK (
    (event_type = 'correction' AND corrects_event_id IS NOT NULL)
    OR (event_type <> 'correction' AND corrects_event_id IS NULL)
  );

-- A correction cannot cite itself.
ALTER TABLE armory.custody_events
  ADD CONSTRAINT custody_events_correction_is_not_circular
  CHECK (corrects_event_id IS NULL OR corrects_event_id <> id);

-- §3.6: "An override is permitted but never silent — override_reason is
-- mandatory when present." A mandatory field that accepts an empty string is
-- not mandatory, so the check tests for content rather than for NOT NULL.
ALTER TABLE armory.audit_log
  ADD CONSTRAINT audit_log_override_states_a_reason
  CHECK (
    NOT is_override
    OR (override_reason IS NOT NULL AND length(trim(override_reason)) >= 12)
  );

-- §3.2: an allowance period must be a period.
ALTER TABLE armory.host_allowances
  ADD CONSTRAINT host_allowances_period_is_ordered
  CHECK (period_end > period_start);

-- §3.2: used_count and overage_count are counts.
ALTER TABLE armory.host_allowances
  ADD CONSTRAINT host_allowances_counts_are_not_negative
  CHECK (used_count >= 0 AND overage_count >= 0 AND included_quota >= 0);

-- §2: money is integer kobo, and a charge is for something.
ALTER TABLE armory.charges
  ADD CONSTRAINT charges_total_is_not_negative CHECK (total_kobo >= 0);

ALTER TABLE armory.payments
  ADD CONSTRAINT payments_amount_is_positive CHECK (amount_kobo > 0);

ALTER TABLE armory.account_transactions
  ADD CONSTRAINT account_transactions_amount_is_positive
  CHECK (amount_kobo > 0);

-- §3.3: a booking slot must have duration.
ALTER TABLE armory.bookings
  ADD CONSTRAINT bookings_slot_is_ordered CHECK (slot_end > slot_start);

-- §3.4: ammunition quantities are counts.
ALTER TABLE armory.ammunition_issues
  ADD CONSTRAINT ammunition_issues_quantities_are_sane
  CHECK (
    qty_issued > 0
    AND (qty_fired IS NULL OR qty_fired >= 0)
    AND (qty_returned IS NULL OR qty_returned >= 0)
  );

-- §3.1: a membership may not be its own principal.
ALTER TABLE armory.memberships
  ADD CONSTRAINT memberships_principal_is_someone_else
  CHECK (principal_membership_id IS NULL OR principal_membership_id <> id);

ALTER TABLE armory.memberships
  ADD CONSTRAINT memberships_principal_fk
  FOREIGN KEY (principal_membership_id) REFERENCES armory.memberships(id)
  ON DELETE RESTRICT;

-- §3.3/§3.4: self-referencing correction links.
ALTER TABLE armory.rounds
  ADD CONSTRAINT rounds_corrects_fk
  FOREIGN KEY (corrects_round_id) REFERENCES armory.rounds(id) ON DELETE RESTRICT;

ALTER TABLE armory.custody_events
  ADD CONSTRAINT custody_events_corrects_fk
  FOREIGN KEY (corrects_event_id) REFERENCES armory.custody_events(id)
  ON DELETE RESTRICT;

-- §3.3: a corrected score states why (§1.2 rule 3).
ALTER TABLE armory.rounds
  ADD CONSTRAINT rounds_correction_states_a_reason
  CHECK (
    corrects_round_id IS NULL
    OR (correction_reason IS NOT NULL AND length(trim(correction_reason)) > 0)
  );


-- ===========================================================================
-- 6. MEMBER NUMBERS — §3.1: "unique, sequential, never reused."
--
-- A Postgres sequence rather than MAX()+1. Two reasons, and the second is the
-- one that matters:
--
--   · MAX()+1 races. Two admissions in the same transaction window produce the
--     same number, and one of them fails on the unique index — during the
--     founding intake, which is the busiest admission period the club will
--     ever have.
--   · A sequence does not reuse. If an admission is rolled back the number is
--     consumed and skipped, which is exactly right: a reissued member number
--     is a permanent ambiguity in the custody log and in the club's own paper
--     records, where the same number would appear against two people.
-- ===========================================================================

CREATE SEQUENCE IF NOT EXISTS armory.member_number_seq AS integer START WITH 1;

ALTER TABLE armory.memberships
  ALTER COLUMN member_number SET DEFAULT nextval('armory.member_number_seq');

COMMENT ON SEQUENCE armory.member_number_seq IS
  'Member numbers are sequential and never reused (§3.1). Gaps are expected and correct.';
