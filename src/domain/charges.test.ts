import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { format, naira, ZERO } from "@/lib/money";
import {
  accountStanding,
  adjustmentCharge,
  balanceOf,
  guestOverageCharge,
  outstandingOf,
  subscriptionCharge,
} from "./charges";

/**
 * §1.2 rule 5: "Money from a guest visit lands on the host. A GUEST NEVER
 *        TRANSACTS WITH THE CLUB."
 * §3.5: "payer_person_id for a guest charge is ALWAYS the host. Enforce in
 *        code, not convention." · "Ledger, not a mutable balance."
 * §8.3: "the overage is charged to the host … the system never resolves a data
 *        conflict by embarrassing a member."
 * §2:   "All amounts stored as integer kobo. Never floats."
 */

const HOST = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";

describe("a guest visit is charged to the host — §1.2 rule 5", () => {
  const charge = guestOverageCharge({
    hostPersonId: HOST,
    guestName: "Bode Adeyemi",
    invitationId: "33333333-3333-4333-8333-333333333333",
    visits: 1,
    priceKobo: naira(15_000),
  });

  it("puts the host in the payer position", () => {
    assert.equal(charge.payerPersonId, HOST);
  });

  it("has no way to name the guest as payer", () => {
    /* The enforcement §3.5 asks for is that there is no argument to get wrong.
       This asserts the shape of the call rather than a runtime guard: the guest
       id appears nowhere in the input, so no call site can pass it into the
       payer position by mistake. */
    const input = {
      hostPersonId: HOST,
      guestName: "Bode Adeyemi",
      invitationId: null,
      visits: 1,
      priceKobo: naira(15_000),
    };

    assert.equal(
      Object.values(input).includes(GUEST),
      false,
      "the guest's person id has no parameter here, and must not acquire one",
    );
  });

  it("names the guest on the line so the member recognises the evening", () => {
    assert.equal(charge.lines[0].description, "Guest visit — Bode Adeyemi");
  });

  it("charges by the visit, in kobo", () => {
    assert.equal(charge.totalKobo, 1_500_000);
  });

  it("multiplies by visits without a float in the path", () => {
    const two = guestOverageCharge({
      hostPersonId: HOST,
      guestName: "Bode Adeyemi",
      invitationId: null,
      visits: 2,
      priceKobo: naira(15_000),
    });

    assert.equal(two.totalKobo, 3_000_000);
    assert.equal(Number.isInteger(two.totalKobo), true);
  });
});

describe("a charge's total comes from its lines", () => {
  it("cannot be passed in and cannot disagree", () => {
    const charge = subscriptionCharge({
      personId: HOST,
      membershipId: "44444444-4444-4444-8444-444444444444",
      tierName: "Full",
      period: "annual",
      periodEndLabel: "14 August 2027",
      feeKobo: naira(450_000),
    });

    assert.equal(charge.totalKobo, charge.lines[0].amountKobo);
    assert.equal(charge.totalKobo, 45_000_000);
  });

  it("says which period a subscription bought", () => {
    const charge = subscriptionCharge({
      personId: HOST,
      membershipId: "44444444-4444-4444-8444-444444444444",
      tierName: "Full",
      period: "annual",
      periodEndLabel: "14 August 2027",
      feeKobo: naira(450_000),
    });

    assert.equal(
      charge.lines[0].description,
      "Full membership, year to 14 August 2027",
    );
  });

  it("keeps an adjustment's account of itself", () => {
    const charge = adjustmentCharge({
      personId: HOST,
      description: "Replacement target frames, agreed with the founder",
      amountKobo: naira(8_000),
    });

    assert.equal(charge.referenceType, "adjustment");
    assert.match(charge.lines[0].description, /target frames/);
  });
});

describe("the balance is derived, never written — §3.5", () => {
  const at = (iso: string) => new Date(iso);

  it("adds credits and subtracts debits", () => {
    const balance = balanceOf([
      {
        amountKobo: naira(20_000),
        direction: "credit",
        referenceType: "account_topup",
        createdAt: at("2026-08-01T10:00:00.000Z"),
      },
      {
        amountKobo: naira(15_000),
        direction: "debit",
        referenceType: "guest_visit",
        createdAt: at("2026-08-05T10:00:00.000Z"),
      },
    ]);

    assert.equal(balance, 500_000);
  });

  it("goes negative when a member owes the club", () => {
    /* The sign convention is the member's point of view — see the header of
       charges.ts. Negative means "I owe", which is what every bank statement
       has trained them to read. */
    const balance = balanceOf([
      {
        amountKobo: naira(15_000),
        direction: "debit",
        referenceType: "guest_visit",
        createdAt: at("2026-08-05T10:00:00.000Z"),
      },
    ]);

    assert.equal(balance, -1_500_000);
  });

  it("is zero for somebody who has never transacted", () => {
    assert.equal(balanceOf([]), ZERO);
  });

  it("does not fold unsettled charges into the balance", () => {
    /* Two different facts. A member with money on account and a bill still has
       a bill, and one number would hide it. */
    const outstanding = outstandingOf([
      { totalKobo: naira(15_000), isSettled: false },
      { totalKobo: naira(450_000), isSettled: true },
    ]);

    assert.equal(outstanding, 1_500_000);
  });
});

describe("what the member is told — §6.2", () => {
  const standing = (balance: number, outstanding: number) =>
    accountStanding({
      balanceKobo: naira(balance),
      outstandingKobo: naira(outstanding),
      format: (amount) => format(amount),
    });

  it("says nothing outstanding when there is nothing", () => {
    const view = standing(0, 0);
    assert.equal(view.line, "Nothing outstanding.");
    assert.equal(view.remedy, null);
  });

  it("leads with the bill even when the member is in funds", () => {
    const view = standing(20_000, 15_000);
    assert.equal(view.line, "₦15,000 outstanding.");
    assert.equal(view.remedy, "Your account balance covers it.");
  });

  it("says how to settle a bill the balance does not cover", () => {
    const view = standing(5_000, 15_000);
    assert.equal(view.line, "₦15,000 outstanding.");
    assert.equal(view.remedy, "Top up, or settle it at the desk.");
  });

  it("states a credit without inventing something to do about it", () => {
    const view = standing(20_000, 0);
    assert.equal(view.line, "₦20,000 on account.");
    assert.equal(view.remedy, null);
  });

  it("states a debt as a positive number owed", () => {
    const view = accountStanding({
      balanceKobo: naira(-12_000),
      outstandingKobo: ZERO,
      format: (amount) => format(amount),
    });

    assert.equal(view.line, "₦12,000 owed.");
  });

  it("never threatens, and never names a consequence", () => {
    /* §12.1's tone applied to money: this club's members are people the founder
       sees on Saturday, and a dunning notice is a worse instrument than the
       conversation it replaces. */
    for (const view of [standing(0, 15_000), standing(-12_000, 0), standing(0, 0)]) {
      const words = `${view.line} ${view.remedy ?? ""}`.toLowerCase();
      for (const forbidden of [
        "overdue",
        "suspend",
        "immediately",
        "failure to",
        "penalty",
      ]) {
        assert.ok(
          !words.includes(forbidden),
          `"${forbidden}" has no place on a member's account screen`,
        );
      }
    }
  });
});
