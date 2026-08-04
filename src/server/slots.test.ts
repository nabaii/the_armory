/**
 * Slot generation and booking capacity.
 *
 * The timezone tests are the point of this file. Slot times are West Africa
 * Time, and the server almost certainly is not — a Vercel or Cloudflare
 * deployment runs UTC or a US region. If generation ever reads the host's local
 * clock zone, every visitor is told the wrong hour and turns up at the wrong
 * time. That failure is invisible in local development in Lagos and invisible in
 * CI, so it has to be asserted.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSlots, findSlot, groupSlotsByDate } from "./slots";
import {
  InMemoryBookingStore,
  slotIdToInstant,
  HOLD_TTL_MS,
} from "./booking-store";
import type { SessionTemplate } from "@/content/booking";

/** A fixed config so tests do not move when the real schedule changes. */
const config = {
  sessions: [
    { weekday: 4, start: "18:00", capacity: 6 }, // Thursday
    { weekday: 6, start: "11:00", capacity: 4 }, // Saturday
  ] as readonly SessionTemplate[],
  leadTimeHours: 24,
  horizonDays: 14,
  maxPartySize: 12,
  durationMinutes: 90,
  pricing: { perPersonNaira: 25_000, depositNaira: 10_000 },
  policyVersion: "v1",
} as const;

/** Wednesday 5 August 2026, 09:00 UTC (10:00 WAT). */
const NOW = new Date("2026-08-05T09:00:00.000Z");

describe("generateSlots", () => {
  it("only emits the configured weekdays", () => {
    const slots = generateSlots(NOW, config);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      const weekday = new Date(slot.startsAt).getUTCDay();
      /* 18:00 WAT is 17:00Z and 11:00 WAT is 10:00Z, so neither crosses a day
         boundary — the UTC weekday still matches the WAT weekday here. */
      assert.ok([4, 6].includes(weekday), `unexpected weekday ${weekday}`);
    }
  });

  it("respects the lead time", () => {
    const slots = generateSlots(NOW, config);
    const earliest = NOW.getTime() + config.leadTimeHours * 3_600_000;
    for (const slot of slots) {
      assert.ok(
        slot.startsAt.getTime() >= earliest,
        `${slot.id} is inside the lead time`,
      );
    }
  });

  it("respects the horizon", () => {
    const slots = generateSlots(NOW, config);
    const latest = NOW.getTime() + config.horizonDays * 86_400_000;
    for (const slot of slots) {
      assert.ok(slot.startsAt.getTime() <= latest, `${slot.id} is past the horizon`);
    }
  });

  it("returns slots in chronological order", () => {
    const slots = generateSlots(NOW, config);
    for (let i = 1; i < slots.length; i += 1) {
      assert.ok(
        slots[i].startsAt.getTime() > slots[i - 1].startsAt.getTime(),
        "slots are not sorted",
      );
    }
  });

  it("produces unique slot ids", () => {
    const ids = generateSlots(NOW, config).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("is deterministic for a given `now`", () => {
    const a = generateSlots(NOW, config).map((s) => s.id);
    const b = generateSlots(NOW, config).map((s) => s.id);
    assert.deepEqual(a, b);
  });

  /* ---------------------------------------------------------------- TIMEZONE */

  it("interprets session times as WAT, not as the host's local time", () => {
    const slots = generateSlots(NOW, config);
    const thursday = slots.find((s) => s.id.endsWith("T18:00"));
    assert.ok(thursday, "expected an 18:00 WAT session");
    /* WAT is UTC+1, so 18:00 local is 17:00Z — regardless of where this runs. */
    assert.equal(thursday.startsAt.getUTCHours(), 17);
  });

  it("labels the time in WAT wall clock, not UTC", () => {
    const slots = generateSlots(NOW, config);
    const thursday = slots.find((s) => s.id.endsWith("T18:00"));
    assert.equal(thursday?.timeLabel, "6:00 pm");
  });

  it("generates identical slots whatever TZ the process runs in", () => {
    /* The real regression this guards: the same build deployed to a US region
       must produce the same sessions as one deployed to Lagos. */
    const original = process.env.TZ;
    const ids: string[][] = [];
    for (const tz of ["UTC", "America/New_York", "Africa/Lagos", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      ids.push(generateSlots(NOW, config).map((s) => `${s.id}|${s.timeLabel}`));
    }
    process.env.TZ = original;
    for (const set of ids.slice(1)) assert.deepEqual(set, ids[0]);
  });

  it("rolls over month ends correctly", () => {
    /* Late August, so the 14-day horizon crosses into September. */
    const lateAugust = new Date("2026-08-25T09:00:00.000Z");
    const slots = generateSlots(lateAugust, config);
    assert.ok(
      slots.some((s) => s.id.startsWith("2026-09")),
      "expected slots in September",
    );
    for (const slot of slots) {
      assert.match(slot.id, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    }
  });
});

describe("findSlot", () => {
  it("finds a slot that the generator produced", () => {
    const first = generateSlots(NOW, config)[0];
    assert.equal(findSlot(first.id, NOW, config)?.id, first.id);
  });

  it("returns null for an id that is not currently bookable", () => {
    /* The submission path relies on this: a stale tab posting yesterday's slot
       must be rejected rather than booked. */
    assert.equal(findSlot("2020-01-01T18:00", NOW, config), null);
  });

  it("returns null for a malformed id", () => {
    assert.equal(findSlot("not-a-slot", NOW, config), null);
  });
});

describe("groupSlotsByDate", () => {
  it("groups by date and preserves order within each group", () => {
    const groups = groupSlotsByDate(generateSlots(NOW, config));
    assert.ok(groups.length > 0);
    for (const group of groups) {
      assert.ok(group.slots.length > 0);
      for (const slot of group.slots) assert.equal(slot.dateLabel, group.dateLabel);
    }
  });
});

describe("slotIdToInstant", () => {
  it("treats the id as WAT", () => {
    assert.equal(
      slotIdToInstant("2026-08-06T18:00"),
      Date.UTC(2026, 7, 6, 17, 0, 0, 0),
    );
  });

  it("returns null for a malformed id", () => {
    assert.equal(slotIdToInstant("2026-8-6T18:00"), null);
    assert.equal(slotIdToInstant(""), null);
  });
});

describe("InMemoryBookingStore", () => {
  const base = {
    slotId: "2026-08-06T18:00",
    name: "Test Visitor",
    email: "visitor@example.com",
    phone: "+2348000000000",
    policyVersion: "v1",
  };

  const hold = (store: InMemoryBookingStore, reference: string, partySize: number) =>
    store.hold({ ...base, reference, partySize }, 6);

  it("starts with full capacity", async () => {
    const store = new InMemoryBookingStore();
    assert.equal(await store.remainingCapacity(base.slotId, 6), 6);
  });

  it("reduces capacity when a hold is taken", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 2);
    assert.equal(await store.remainingCapacity(base.slotId, 6), 4);
  });

  it("refuses a hold larger than the remaining capacity", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 5);
    const result = await hold(store, "ARM-2", 2);
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === "slot-full") {
      assert.equal(result.remaining, 1);
    } else {
      assert.fail("expected slot-full");
    }
  });

  it("allows a hold that exactly fills the session", async () => {
    const store = new InMemoryBookingStore();
    const result = await hold(store, "ARM-1", 6);
    assert.equal(result.ok, true);
    assert.equal(await store.remainingCapacity(base.slotId, 6), 0);
  });

  it("rejects a duplicate reference", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 1);
    const result = await hold(store, "ARM-1", 1);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "duplicate-reference");
  });

  it("does not let a hold on one slot consume another slot's capacity", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 6);
    assert.equal(await store.remainingCapacity("2026-08-08T11:00", 4), 4);
  });

  /* ------------------------------------------------------------ IDEMPOTENCY */

  it("confirms a held booking", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 2);
    const outcome = await store.confirm("ARM-1", 2_000_000);
    assert.equal(outcome.status, "confirmed");
    if (outcome.status === "confirmed") {
      assert.equal(outcome.record.amountKobo, 2_000_000);
      assert.equal(outcome.record.status, "confirmed");
    }
  });

  it("is idempotent: a replayed webhook does not double-count capacity", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 2);
    await store.confirm("ARM-1", 2_000_000);
    const remainingAfterFirst = await store.remainingCapacity(base.slotId, 6);

    const replay = await store.confirm("ARM-1", 2_000_000);
    assert.equal(replay.status, "already-confirmed");
    assert.equal(await store.remainingCapacity(base.slotId, 6), remainingAfterFirst);
  });

  it("reports an unknown reference rather than inventing a booking", async () => {
    const store = new InMemoryBookingStore();
    const outcome = await store.confirm("ARM-NOPE", 1000);
    assert.equal(outcome.status, "unknown-reference");
  });

  it("honours payment on a hold that has just lapsed", async () => {
    /* Money is real. Denying a paid booking because a timer expired is far worse
       than an over-booked session a human can resolve. */
    const store = new InMemoryBookingStore();
    await store.hold(
      { ...base, reference: "ARM-LATE", partySize: 1, expiresAt: Date.now() - 1000 },
      6,
    );
    const outcome = await store.confirm("ARM-LATE", 1_000_000);
    assert.equal(outcome.status, "confirmed");
  });

  /* ----------------------------------------------------------------- EXPIRY */

  it("returns capacity when a hold expires", async () => {
    const store = new InMemoryBookingStore();
    await store.hold(
      { ...base, reference: "ARM-OLD", partySize: 4, expiresAt: Date.now() - 1 },
      6,
    );
    /* remainingCapacity sweeps expired holds first. */
    assert.equal(await store.remainingCapacity(base.slotId, 6), 6);
  });

  it("keeps a hold that has not yet expired", async () => {
    const store = new InMemoryBookingStore();
    await store.hold(
      { ...base, reference: "ARM-NEW", partySize: 4, expiresAt: Date.now() + HOLD_TTL_MS },
      6,
    );
    assert.equal(await store.remainingCapacity(base.slotId, 6), 2);
  });

  /* ---------------------------------------------------------------- RELEASE */

  it("releases a hold and returns its capacity", async () => {
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 3);
    await store.release("ARM-1");
    assert.equal(await store.remainingCapacity(base.slotId, 6), 6);
  });

  it("never releases a confirmed booking", async () => {
    /* Releasing a paid booking would silently cancel someone's visit. */
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 3);
    await store.confirm("ARM-1", 3_000_000);
    await store.release("ARM-1");
    assert.equal((await store.get("ARM-1"))?.status, "confirmed");
    assert.equal(await store.remainingCapacity(base.slotId, 6), 3);
  });

  it("records the policy version against the booking", async () => {
    /* Required for dispute defence — §9 wants the terms the customer saw. */
    const store = new InMemoryBookingStore();
    await hold(store, "ARM-1", 1);
    await store.confirm("ARM-1", 1_000_000);
    assert.equal((await store.get("ARM-1"))?.policyVersion, "v1");
  });
});
