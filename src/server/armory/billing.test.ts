import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readIntent } from "./billing";

/**
 * §9: "Webhook-driven state, never client-reported success. Idempotent on
 *      gateway_reference."
 * §12.1: "Duplicate webhook from Paystack → One payment row."
 *
 * The idempotency itself is a unique index and is proved in
 * scripts/enforcement.test.sql — a TypeScript test cannot demonstrate a
 * database constraint, only that the TypeScript did not try to violate it.
 *
 * What IS testable here is the half that decides whether a signed webhook is
 * ours at all, and what it means. A signature proves Paystack sent the request;
 * it says nothing about the metadata inside, which arrives from a Paystack
 * account this codebase shares with the first-visit booking flow.
 */

const PERSON = "11111111-1111-4111-8111-111111111111";
const CHARGE = "22222222-2222-4222-8222-222222222222";

describe("reading a webhook's intent", () => {
  it("reads a well-formed club payment", () => {
    assert.deepEqual(
      readIntent({
        armoryPersonId: PERSON,
        armoryPurpose: "subscription",
        armoryChargeId: CHARGE,
      }),
      { personId: PERSON, purpose: "subscription", chargeId: CHARGE },
    );
  });

  it("reads a top-up, which settles no charge", () => {
    /* The empty string is "no charge" — metadata is kept to flat scalars
       because Paystack round-trips nested objects unevenly. */
    assert.deepEqual(
      readIntent({
        armoryPersonId: PERSON,
        armoryPurpose: "account_topup",
        armoryChargeId: "",
      }),
      { personId: PERSON, purpose: "account_topup", chargeId: null },
    );
  });

  it("refuses an event from the first-visit booking flow", () => {
    /* One Paystack account, two webhook endpoints. The one that does not
       recognise an event answers 200 and does nothing, and this is how it
       tells "not ours" from "ours and broken". */
    assert.equal(
      readIntent({ slotId: "2026-08-07T18:00", partySize: 2 }),
      null,
    );
  });

  it("refuses an event with no metadata at all", () => {
    assert.equal(readIntent(undefined), null);
    assert.equal(readIntent({}), null);
  });

  it("refuses a purpose nobody defined", () => {
    /* §3.5's PAYMENT_PURPOSES is a Postgres enum. An unrecognised value would
       fail at the insert; refusing here means it fails as a log line naming the
       payment rather than as an exception inside a webhook handler. */
    assert.equal(
      readIntent({
        armoryPersonId: PERSON,
        armoryPurpose: "donation",
        armoryChargeId: "",
      }),
      null,
    );
  });

  it("refuses a person id that is not a uuid", () => {
    assert.equal(
      readIntent({
        armoryPersonId: "'; DROP TABLE armory.payments; --",
        armoryPurpose: "subscription",
        armoryChargeId: "",
      }),
      null,
    );
  });

  it("records the payment when only the charge id is unusable", () => {
    /**
     * A judgement call, made deliberately.
     *
     * A member has paid. The person and the purpose are readable, so the money
     * can be credited to the right account — and refusing the whole event over
     * an unreadable charge reference would leave them debited by their bank
     * with nothing on their club account, which is the failure §9's whole
     * reconciliation apparatus exists to prevent.
     *
     * So the payment lands and the charge stays outstanding, which is a
     * discrepancy a human can see and fix. The other way round is a member who
     * has to prove they paid.
     */
    assert.deepEqual(
      readIntent({
        armoryPersonId: PERSON,
        armoryPurpose: "guest_overage",
        armoryChargeId: "not-a-uuid",
      }),
      { personId: PERSON, purpose: "guest_overage", chargeId: null },
    );
  });

  it("ignores metadata fields it does not own", () => {
    /* Paystack echoes anything set at initialisation, and the booking flow sets
       its own keys on the same account. Extra keys are not a reason to refuse. */
    assert.deepEqual(
      readIntent({
        armoryPersonId: PERSON,
        armoryPurpose: "subscription",
        armoryChargeId: CHARGE,
        custom_fields: [{ display_name: "Whatever" }],
        referrer: "https://example.test",
      }),
      { personId: PERSON, purpose: "subscription", chargeId: CHARGE },
    );
  });
});
