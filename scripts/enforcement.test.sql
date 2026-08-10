-- ===========================================================================
-- ENFORCEMENT PROOF — run against a database with all migrations applied.
--
--   npm run db:prove
--
-- §12 requires that append-only tables "reject update and delete at the
-- DATABASE level, not merely in application code". A TypeScript test cannot
-- demonstrate that, because it proves only that the TypeScript did not try.
-- These assertions go straight at the tables with SQL and expect to be
-- refused.
--
-- Every assertion is written so that a PASS is silence and a FAILURE raises.
-- The script runs in one transaction and rolls back, so it leaves nothing
-- behind and can be run against staging.
-- ===========================================================================

BEGIN;

\set ON_ERROR_STOP on
-- NOTICE, not WARNING: the PASS lines below are raised as notices and are the
-- entire output of this script.
SET client_min_messages TO NOTICE;

-- Helper: assert that a statement fails.
CREATE OR REPLACE FUNCTION pg_temp.must_fail(sql text, what text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS  %  (refused: %)', what, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % — the database ALLOWED it', what;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.must_equal(actual text, expected text, what text)
  RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL  % — expected %, got %', what, expected, actual;
  END IF;
  RAISE NOTICE 'PASS  %  (= %)', what, expected;
END;
$$;

-- ---------------------------------------------------------------------------
-- FIXTURES
-- ---------------------------------------------------------------------------

INSERT INTO armory.tiers (id, name, discipline_access, can_host, can_own_firearm)
VALUES ('00000000-0000-7000-8000-000000000a01'::uuid, 'Full',
        ARRAY['10m-air-rifle'], true, true);

INSERT INTO armory.people (id, first_name, last_name, phone)
VALUES ('00000000-0000-7000-8000-000000000101'::uuid, 'Ada', 'Nwosu', '+2348000000001'),
       ('00000000-0000-7000-8000-000000000102'::uuid, 'Bem', 'Tarka', '+2348000000002');

INSERT INTO armory.staff_users (id, person_id, role)
VALUES ('00000000-0000-7000-8000-000000000201'::uuid,
        '00000000-0000-7000-8000-000000000101'::uuid, 'range_officer');

INSERT INTO armory.licences (id, person_id, licence_number, issuing_authority, calibres, status)
VALUES ('00000000-0000-7000-8000-000000000301'::uuid,
        '00000000-0000-7000-8000-000000000101'::uuid,
        'NG-1', 'NPF', ARRAY['.22 LR'], 'verified');

INSERT INTO armory.firearms (id, serial_number, make, model, calibre, ownership)
VALUES ('00000000-0000-7000-8000-000000000401'::uuid,
        'CL-0012', 'Anschutz', '1907', '.22 LR', 'club');

-- ===========================================================================
-- 1. APPEND-ONLY — §12
-- ===========================================================================

INSERT INTO armory.custody_events (id, firearm_id, event_type, actor_staff_id, occurred_at)
VALUES ('00000000-0000-7000-8000-000000000501'::uuid,
        '00000000-0000-7000-8000-000000000401'::uuid,
        'issued', '00000000-0000-7000-8000-000000000201'::uuid, now());

SELECT pg_temp.must_fail(
  $$UPDATE armory.custody_events SET note = 'tidy up'
     WHERE id = '00000000-0000-7000-8000-000000000501'$$,
  'custody_events rejects UPDATE');

SELECT pg_temp.must_fail(
  $$DELETE FROM armory.custody_events
     WHERE id = '00000000-0000-7000-8000-000000000501'$$,
  'custody_events rejects DELETE');

INSERT INTO armory.waiver_versions (id, version, body, effective_from, is_active)
VALUES ('00000000-0000-7000-8000-000000000601'::uuid, 'v1', 'text', now(), true);

INSERT INTO armory.waiver_signatures (id, person_id, waiver_version_id, signed_at)
VALUES ('00000000-0000-7000-8000-000000000701'::uuid,
        '00000000-0000-7000-8000-000000000101'::uuid,
        '00000000-0000-7000-8000-000000000601'::uuid, now());

SELECT pg_temp.must_fail(
  $$UPDATE armory.waiver_signatures SET signed_at = now()
     WHERE id = '00000000-0000-7000-8000-000000000701'$$,
  'waiver_signatures rejects UPDATE');

-- An audit row must EXIST before DELETE is a meaningful test: a row-level
-- trigger never fires when nothing matches, so deleting from an empty table
-- succeeds trivially and would have made this assertion a false pass.
INSERT INTO armory.audit_log (action, entity_type, occurred_at)
VALUES ('issue_firearm', 'custody_event', now());

SELECT pg_temp.must_fail(
  $$DELETE FROM armory.audit_log WHERE true$$,
  'audit_log rejects DELETE');

-- TRUNCATE bypasses row-level triggers entirely. Without a statement-level
-- guard the whole append-only guarantee has a one-word bypass.
SELECT pg_temp.must_fail(
  $$TRUNCATE armory.custody_events CASCADE$$,
  'custody_events rejects TRUNCATE');

SELECT pg_temp.must_fail(
  $$TRUNCATE armory.audit_log$$,
  'audit_log rejects TRUNCATE');

SELECT pg_temp.must_fail(
  $$TRUNCATE armory.waiver_signatures$$,
  'waiver_signatures rejects TRUNCATE');

-- ===========================================================================
-- 2. §3.1 — exactly one active waiver version
-- ===========================================================================

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.waiver_versions (version, body, effective_from, is_active)
    VALUES ('v2', 'text', now(), true)$$,
  'only one waiver version may be active');

-- ===========================================================================
-- 3. §3.4 — firearm status is DERIVED and cannot be written
-- ===========================================================================

SELECT pg_temp.must_equal(
  (SELECT status::text FROM armory.firearms
    WHERE id = '00000000-0000-7000-8000-000000000401'),
  'issued',
  'firearm status derived from its custody log');

SELECT pg_temp.must_fail(
  $$UPDATE armory.firearms SET status = 'in_service'
     WHERE id = '00000000-0000-7000-8000-000000000401'$$,
  'firearms.status rejects a direct write');

-- A return moves it back, through the log rather than the column.
INSERT INTO armory.custody_events (id, firearm_id, event_type, actor_staff_id, occurred_at)
VALUES ('00000000-0000-7000-8000-000000000502'::uuid,
        '00000000-0000-7000-8000-000000000401'::uuid,
        'returned', '00000000-0000-7000-8000-000000000201'::uuid, now() + interval '1 hour');

SELECT pg_temp.must_equal(
  (SELECT status::text FROM armory.firearms
    WHERE id = '00000000-0000-7000-8000-000000000401'),
  'in_service',
  'a returned firearm derives back to in_service');

-- §1.2 rule 3 — a correction withdraws the event it cites.
INSERT INTO armory.custody_events (id, firearm_id, event_type, actor_staff_id, occurred_at)
VALUES ('00000000-0000-7000-8000-000000000503'::uuid,
        '00000000-0000-7000-8000-000000000401'::uuid,
        'taken_out', '00000000-0000-7000-8000-000000000201'::uuid, now() + interval '2 hours');

SELECT pg_temp.must_equal(
  (SELECT status::text FROM armory.firearms
    WHERE id = '00000000-0000-7000-8000-000000000401'),
  'off_site',
  'taken_out derives off_site');

INSERT INTO armory.custody_events
  (id, firearm_id, event_type, actor_staff_id, occurred_at, corrects_event_id, note)
VALUES ('00000000-0000-7000-8000-000000000504'::uuid,
        '00000000-0000-7000-8000-000000000401'::uuid,
        'correction', '00000000-0000-7000-8000-000000000201'::uuid,
        now() + interval '3 hours',
        '00000000-0000-7000-8000-000000000503'::uuid,
        'Recorded against the wrong firearm.');

SELECT pg_temp.must_equal(
  (SELECT status::text FROM armory.firearms
    WHERE id = '00000000-0000-7000-8000-000000000401'),
  'in_service',
  'a correction withdraws the event it cites');

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.custody_events (firearm_id, event_type, actor_staff_id, occurred_at)
    VALUES ('00000000-0000-7000-8000-000000000401', 'correction',
            '00000000-0000-7000-8000-000000000201', now())$$,
  'a correction must cite the event it corrects');

-- ===========================================================================
-- 4. §3.6 — an override is never silent
-- ===========================================================================

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.audit_log
      (action, entity_type, is_override, occurred_at)
    VALUES ('check_in', 'participation', true, now())$$,
  'an override without a reason is refused');

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.audit_log
      (action, entity_type, is_override, override_reason, occurred_at)
    VALUES ('check_in', 'participation', true, 'ok', now())$$,
  'an override with a perfunctory reason is refused');

INSERT INTO armory.audit_log (action, entity_type, is_override, override_reason, occurred_at)
VALUES ('check_in', 'participation', true,
        'Renewing by transfer this afternoon, confirmed with the founder.', now());

-- ===========================================================================
-- 5. §3.4 — member-owned firearms need an owner and a licence
-- ===========================================================================

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.firearms (serial_number, make, model, calibre, ownership)
    VALUES ('AX-4471', 'Walther', 'LG400', '.22 LR', 'member')$$,
  'a member-owned firearm needs an owner and a licence');

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.firearms
      (serial_number, make, model, calibre, ownership, owner_person_id)
    VALUES ('CL-0013', 'Anschutz', '1907', '.22 LR', 'club',
            '00000000-0000-7000-8000-000000000101')$$,
  'a club firearm may not have an owner');

-- ===========================================================================
-- 6. §3.1 — member numbers are sequential and never reused
-- ===========================================================================

INSERT INTO armory.memberships (id, person_id, tier_id, status)
VALUES ('00000000-0000-7000-8000-000000000801'::uuid,
        '00000000-0000-7000-8000-000000000101'::uuid,
        '00000000-0000-7000-8000-000000000a01'::uuid, 'active');

INSERT INTO armory.memberships (id, person_id, tier_id, status)
VALUES ('00000000-0000-7000-8000-000000000802'::uuid,
        '00000000-0000-7000-8000-000000000102'::uuid,
        '00000000-0000-7000-8000-000000000a01'::uuid, 'active');

SELECT pg_temp.must_equal(
  (SELECT (max(member_number) - min(member_number))::text FROM armory.memberships),
  '1',
  'member numbers are allocated sequentially');

SELECT pg_temp.must_fail(
  $$UPDATE armory.memberships SET principal_membership_id = id
     WHERE id = '00000000-0000-7000-8000-000000000801'$$,
  'a membership may not be its own principal');

-- ===========================================================================
-- 7. §3.3 — participations are append-only except for one checkout
-- ===========================================================================

INSERT INTO armory.sessions (id, session_date)
VALUES ('00000000-0000-7000-8000-000000000901'::uuid, current_date);

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.participations
      (session_id, person_id, role, checked_in_at)
    VALUES ('00000000-0000-7000-8000-000000000901',
            '00000000-0000-7000-8000-000000000102', 'guest_shooter', now())$$,
  'a guest participation must name its host');

INSERT INTO armory.participations
  (id, session_id, person_id, role, checked_in_at)
VALUES ('00000000-0000-7000-8000-000000000b01'::uuid,
        '00000000-0000-7000-8000-000000000901'::uuid,
        '00000000-0000-7000-8000-000000000101'::uuid, 'member_shooter', now());

SELECT pg_temp.must_fail(
  $$UPDATE armory.participations SET person_id = '00000000-0000-7000-8000-000000000102'
     WHERE id = '00000000-0000-7000-8000-000000000b01'$$,
  'a participation rejects any edit other than checkout');

SELECT pg_temp.must_fail(
  $$DELETE FROM armory.participations
     WHERE id = '00000000-0000-7000-8000-000000000b01'$$,
  'a participation is never deleted');

-- The one permitted mutation.
UPDATE armory.participations SET checked_out_at = now()
 WHERE id = '00000000-0000-7000-8000-000000000b01';

SELECT pg_temp.must_fail(
  $$UPDATE armory.participations SET checked_out_at = now() + interval '1 hour'
     WHERE id = '00000000-0000-7000-8000-000000000b01'$$,
  'a checkout is recorded once and not revised');

-- ===========================================================================
-- 8. §3.4 — ammunition must balance at reconciliation
-- ===========================================================================

INSERT INTO armory.ammunition_lots
  (id, calibre, quantity_received, quantity_remaining, received_on)
VALUES ('00000000-0000-7000-8000-000000000c01'::uuid, '.22 LR', 500, 500, current_date);

INSERT INTO armory.ammunition_issues
  (id, lot_id, participation_id, qty_issued, issued_at)
VALUES ('00000000-0000-7000-8000-000000000d01'::uuid,
        '00000000-0000-7000-8000-000000000c01'::uuid,
        '00000000-0000-7000-8000-000000000b01'::uuid, 40, now());

SELECT pg_temp.must_equal(
  (SELECT quantity_remaining::text FROM armory.ammunition_lots
    WHERE id = '00000000-0000-7000-8000-000000000c01'),
  '460',
  'issuing ammunition derives the lot balance down');

SELECT pg_temp.must_fail(
  $$UPDATE armory.ammunition_issues
       SET qty_fired = 30, qty_returned = 5, reconciled_at = now()
     WHERE id = '00000000-0000-7000-8000-000000000d01'$$,
  'reconciliation refuses figures that do not balance');

UPDATE armory.ammunition_issues
   SET qty_fired = 34, qty_returned = 6, reconciled_at = now()
 WHERE id = '00000000-0000-7000-8000-000000000d01';

SELECT pg_temp.must_equal(
  (SELECT quantity_remaining::text FROM armory.ammunition_lots
    WHERE id = '00000000-0000-7000-8000-000000000c01'),
  '466',
  'reconciliation returns the unfired rounds to the lot');

-- ===========================================================================
-- 9. §3.5 — an account balance is derived from its ledger
-- ===========================================================================

INSERT INTO armory.accounts (id, person_id)
VALUES ('00000000-0000-7000-8000-000000000e01'::uuid,
        '00000000-0000-7000-8000-000000000101'::uuid);

INSERT INTO armory.account_transactions
  (account_id, amount_kobo, direction, reference_type)
VALUES ('00000000-0000-7000-8000-000000000e01'::uuid, 5000000, 'credit', 'topup'),
       ('00000000-0000-7000-8000-000000000e01'::uuid, 1500000, 'debit', 'guest_overage');

SELECT pg_temp.must_equal(
  (SELECT balance_kobo::text FROM armory.accounts
    WHERE id = '00000000-0000-7000-8000-000000000e01'),
  '3500000',
  'account balance is derived from the ledger');

-- ===========================================================================
-- 10. §12 — one payment row per gateway reference (duplicate webhook)
-- ===========================================================================

INSERT INTO armory.payments (person_id, amount_kobo, purpose, gateway_reference, status)
VALUES ('00000000-0000-7000-8000-000000000101'::uuid, 1500000,
        'guest_overage', 'ps_ref_001', 'succeeded');

SELECT pg_temp.must_fail(
  $$INSERT INTO armory.payments
      (person_id, amount_kobo, purpose, gateway_reference, status)
    VALUES ('00000000-0000-7000-8000-000000000101', 1500000,
            'guest_overage', 'ps_ref_001', 'succeeded')$$,
  'a duplicate gateway reference cannot create a second payment');

ROLLBACK;
