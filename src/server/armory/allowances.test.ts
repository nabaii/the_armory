import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toDateColumn } from "@/lib/time";
import { allowancePeriod, overageException } from "./allowances";

/**
 * §3.2:  "One row per membership per period."
 * §8.3:  "TWO DEVICES, ONE ALLOWANCE… If the reconciliation finds the allowance
 *         exceeded, the visit stands — the guest is already on the premises —
 *         and the overage is charged to the host. The system never resolves a
 *         data conflict by embarrassing a member."
 * §12.1: "Allowance exhausted mid-booking → Overage offered in the portal with
 *         the price shown. Never discovered at the desk."
 * §12.1: seeds "an allowance period ending today" as a boundary case.
 *
 * The concurrency itself rests on `used_count = used_count + 1` being one
 * statement — see the header of allowances.ts — and no unit test can prove a row
 * lock. What IS testable here is the period arithmetic, which decides WHICH row
 * that statement touches. Getting it wrong hands a member a second year's guests
 * eight weeks after they joined.
 */

const period = (startedOn: string, now: string) =>
  allowancePeriod(new Date(startedOn), new Date(now));

describe("the allowance year runs from the membership anniversary", () => {
  it("is not the calendar year", () => {
    /* A member who joins in November and is given twelve guest visits would
       otherwise get twelve in November and twelve again in January — which the
       club discovers having already hosted them. */
    const { periodStart, periodEnd } = period(
      "2025-11-14T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    );

    assert.equal(toDateColumn(periodStart), "2025-11-14");
    assert.equal(toDateColumn(periodEnd), "2026-11-13");
  });

  it("rolls to the new year once the anniversary passes", () => {
    const { periodStart } = period(
      "2025-03-02T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );

    assert.equal(toDateColumn(periodStart), "2026-03-02");
  });

  it("stays in last year's period the day before the anniversary", () => {
    const { periodStart, periodEnd } = period(
      "2025-03-02T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    );

    assert.equal(toDateColumn(periodStart), "2025-03-02");
    assert.equal(toDateColumn(periodEnd), "2026-03-01");
  });

  it("starts the new period ON the anniversary, not the day after", () => {
    const { periodStart } = period(
      "2025-03-02T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    );

    assert.equal(toDateColumn(periodStart), "2026-03-02");
  });
});

describe("§12.1 — an allowance period ending today", () => {
  it("is still the current period on its final day", () => {
    /* The seeded boundary case. A period that ended at midnight this morning
       would leave a member with an allowance row nobody can find, and their
       guest refused at the desk on a technicality about dates. */
    const now = new Date("2026-03-01T18:00:00.000Z");
    const { periodStart, periodEnd } = period("2025-03-02T00:00:00.000Z", now.toISOString());

    assert.equal(toDateColumn(periodEnd), "2026-03-01");
    assert.equal(
      toDateColumn(periodEnd) >= toDateColumn(now),
      true,
      "the period ends before the day it is meant to cover",
    );
    assert.equal(toDateColumn(periodStart) <= toDateColumn(now), true);
  });

  it("leaves no gap between one period and the next", () => {
    /* End of one period and start of the next must be consecutive days. A gap
       is a day on which a member has no allowance row at all. */
    const first = period("2025-03-02T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
    const second = period("2025-03-02T00:00:00.000Z", "2026-03-02T00:00:00.000Z");

    const dayAfterEnd = new Date(first.periodEnd);
    dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);

    assert.equal(toDateColumn(dayAfterEnd), toDateColumn(second.periodStart));
  });
});

describe("the overage exception", () => {
  const result = {
    allowanceId: "a-1",
    usedCount: 7,
    includedQuota: 6,
    withinQuota: false,
    overageCount: 1,
  };

  it("is marked as an officer override when it happened at the desk", () => {
    /* §8.3: "Offline guest authorisation at the desk is an explicit officer
       override, recorded as an exception." */
    const draft = overageException({
      membershipId: "m-1",
      hostPersonId: "p-1",
      result,
      source: "desk_override",
    });

    assert.ok(draft.override);
    assert.match(draft.override.reason, /visit stands/);
  });

  it("is NOT an override when the member accepted the charge in the portal", () => {
    /* §12: the portal offers the overage with the price shown. That is a
       purchase the member chose, and putting it on the founder's exception list
       every time would bury the desk overrides that actually need review. */
    const draft = overageException({
      membershipId: "m-1",
      hostPersonId: "p-1",
      result,
      source: "portal",
    });

    assert.equal(draft.override, undefined);
  });

  it("records the counts a founder needs to bill from", () => {
    const draft = overageException({
      membershipId: "m-1",
      hostPersonId: "p-1",
      result,
      source: "portal",
    });

    assert.deepEqual(draft.after, {
      membershipId: "m-1",
      hostPersonId: "p-1",
      usedCount: 7,
      includedQuota: 6,
      overageCount: 1,
      source: "portal",
    });
  });
});
