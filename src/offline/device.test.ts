import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFLINE_GRACE_DAYS,
  OFFLINE_WARNING_DAYS,
  effectiveNow,
  evaluateDeviceTrust,
  isDayPackUsable,
  type DeviceClock,
  type DeviceRegistration,
} from "./device";
import { LOCAL_DATABASES } from "./revoke";

/**
 * §3.1 — "Desk and lane surfaces load only on a registered, unrevoked device."
 * §10  — "A lost or stolen tablet can be revoked server-side, and its cached
 *         day pack rendered unusable on next launch."
 *
 * The interesting cases are all in the gap between those and §8's requirement
 * that the desk work with no network at all. A revocation the device never
 * hears is not a revocation; a liveness check the device must pass is not
 * offline support.
 */

const NOW = new Date("2026-08-10T09:00:00Z");
const daysBefore = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000);

const registration = (lastVerifiedDaysAgo: number): DeviceRegistration => ({
  deviceId: "device-1",
  label: "Desk tablet",
  surface: "desk",
  registeredAt: daysBefore(200),
  lastVerifiedAt: daysBefore(lastVerifiedDaysAgo),
});

/**
 * A device whose clock is correct and which has been running normally, so its
 * high-water mark agrees with the current time. The default for every test that
 * is not specifically about the clock.
 */
const clock = (now: Date, highWaterAt: Date | null = now): DeviceClock => ({
  now,
  highWaterAt,
});

describe("device trust", () => {
  it("allows a registered device the server confirms", () => {
    const decision = evaluateDeviceTrust(
      registration(0),
      { reachable: true, revoked: false },
      clock(NOW),
    );
    assert.equal(decision.action, "allow");
  });

  it("§10: wipes when the server says revoked", () => {
    const decision = evaluateDeviceTrust(
      registration(0),
      { reachable: true, revoked: true },
      clock(NOW),
    );
    assert.equal(decision.action, "wipe");
  });

  it("refuses an unregistered device rather than wiping it", () => {
    const decision = evaluateDeviceTrust(null, { reachable: false }, clock(NOW));
    assert.equal(decision.action, "refuse");
  });

  it("§8: keeps working offline through an ordinary outage", () => {
    for (let days = 0; days < OFFLINE_GRACE_DAYS; days += 1) {
      const decision = evaluateDeviceTrust(
        registration(days),
        { reachable: false },
        clock(NOW),
      );
      assert.equal(
        decision.action,
        "allow",
        `a ${days}-day outage must not close the range`,
      );
    }
  });

  it("stops trusting a device that has been out of contact too long", () => {
    const decision = evaluateDeviceTrust(
      registration(OFFLINE_GRACE_DAYS),
      { reachable: false },
      clock(NOW),
    );
    assert.equal(decision.action, "refuse");
  });

  it("refuses rather than wipes when merely stale — queued records survive", () => {
    /* The device may be entirely legitimate and simply cut off. Destroying an
       unsynced afternoon of custody events because the uplink died for a week
       would be the system causing the exact loss it exists to prevent. */
    const decision = evaluateDeviceTrust(
      registration(OFFLINE_GRACE_DAYS + 30),
      { reachable: false },
      clock(NOW),
    );
    assert.equal(decision.action, "refuse");
    assert.notEqual(decision.action, "wipe");
  });

  it("warns before it locks, so the outage is not a surprise", () => {
    const quiet = evaluateDeviceTrust(
      registration(OFFLINE_WARNING_DAYS - 1),
      { reachable: false },
      clock(NOW),
    );
    assert.equal(quiet.action === "allow" && quiet.warning, null);

    const warned = evaluateDeviceTrust(
      registration(OFFLINE_WARNING_DAYS),
      { reachable: false },
      clock(NOW),
    );
    assert.equal(warned.action, "allow");
    assert.ok(
      warned.action === "allow" && warned.warning?.includes("stops working"),
      "an officer must be told before the desk locks itself",
    );
  });

  it("a reachable server always beats a stale local clock", () => {
    /* Even far past the grace period, a server that says "not revoked" is the
       authority — the bound exists only because the server is silent. */
    const decision = evaluateDeviceTrust(
      registration(OFFLINE_GRACE_DAYS + 90),
      { reachable: true, revoked: false },
      clock(NOW),
    );
    assert.equal(decision.action, "allow");
  });

  it("every refusal and warning is written for a person", () => {
    const cases = [
      evaluateDeviceTrust(null, { reachable: false }, clock(NOW)),
      evaluateDeviceTrust(registration(99), { reachable: false }, clock(NOW)),
      evaluateDeviceTrust(
        registration(0),
        { reachable: true, revoked: true },
        clock(NOW),
      ),
    ];

    for (const decision of cases) {
      const text =
        decision.action === "allow" ? (decision.warning ?? "") : decision.reason;
      assert.ok(text.length > 0);
      assert.ok(/[.]$/.test(text), `not a sentence: "${text}"`);
      assert.ok(
        !/error|invalid|denied|forbidden/i.test(text),
        `reads as a system error: "${text}"`,
      );
    }
  });

  it("a refusal always offers a way back", () => {
    const decision = evaluateDeviceTrust(
      registration(99),
      { reachable: false },
      clock(NOW),
    );
    assert.equal(decision.action, "refuse");
    if (decision.action !== "refuse") return;
    assert.match(decision.remedy, /connect/i);
  });
});

/* ===========================================================================
   THE CLOCK — §10 against a device in someone else's hands

   The seven-day bound is measured in elapsed time, and the only clock available
   offline is a setting on the tablet. These are the tests that the bound cannot
   be moved by changing it.
   ======================================================================== */

describe("the offline bound survives the device's own clock", () => {
  it("winding the date back does not buy a stolen tablet more grace", () => {
    /* The attack, in full: a device last verified nine days ago is refused. Its
       holder sets the date back a fortnight, which makes `now` earlier than
       `lastVerifiedAt` and, measured naively, makes the device look freshly
       confirmed. The high-water mark written by its last legitimate launch is
       still on disk and still counts. */
    const stale = registration(9);
    const windBackTo = new Date(NOW.getTime() - 14 * 86_400_000);

    const naive = evaluateDeviceTrust(stale, { reachable: false }, {
      now: windBackTo,
      highWaterAt: null,
    });
    assert.equal(
      naive.action,
      "allow",
      "sanity: with no mark, a rolled-back clock does read as fresh",
    );

    const defended = evaluateDeviceTrust(stale, { reachable: false }, {
      now: windBackTo,
      highWaterAt: NOW,
    });
    assert.equal(
      defended.action,
      "refuse",
      "a rolled-back clock must not reopen a device the bound has closed",
    );
  });

  it("a device inside its grace period is unaffected by the mark", () => {
    const decision = evaluateDeviceTrust(
      registration(2),
      { reachable: false },
      clock(NOW),
    );
    assert.equal(decision.action, "allow");
    assert.equal(decision.action === "allow" && decision.staleDays, 2);
  });

  it("the mark only ever moves time forward, never back", () => {
    const behind = new Date(NOW.getTime() - 5 * 86_400_000);
    const ahead = new Date(NOW.getTime() + 5 * 86_400_000);

    assert.equal(effectiveNow({ now: NOW, highWaterAt: behind }).getTime(), NOW.getTime());
    assert.equal(effectiveNow({ now: NOW, highWaterAt: ahead }).getTime(), ahead.getTime());
    assert.equal(effectiveNow({ now: NOW, highWaterAt: null }).getTime(), NOW.getTime());
  });

  it("says so plainly when the clock is wrong rather than failing silently", () => {
    /* Battery died, restored with a date in the past, first launch afterwards so
       there is no mark yet. The desk opens — locking it over a bad clock would
       be a self-inflicted outage — but the officer is told. */
    const decision = evaluateDeviceTrust(
      registration(-5),
      { reachable: false },
      { now: NOW, highWaterAt: null },
    );
    assert.equal(decision.action, "allow");
    assert.ok(
      decision.action === "allow" && /clock is wrong/.test(decision.warning ?? ""),
      "an unreliable clock must be visible, not silently trusted",
    );
  });
});

/* ===========================================================================
   DAY PACK STALENESS — §8.1
   ======================================================================== */

describe("day pack staleness", () => {
  const hoursBefore = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

  it("refuses to work from nothing", () => {
    const { usable } = isDayPackUsable(null, NOW);
    assert.equal(usable, false);
  });

  it("accepts a pack pulled yesterday evening — it covers today (§8.1)", () => {
    /* The pack holds "today's and tomorrow's expected arrivals", so one pulled
       18 hours ago still has today's. A 24-hour bound would refuse a pack that
       is entirely correct. */
    const { usable } = isDayPackUsable(hoursBefore(18), NOW);
    assert.equal(usable, true);
  });

  it("refuses a pack more than a day and a half old", () => {
    const { usable, line } = isDayPackUsable(hoursBefore(37), NOW);
    assert.equal(usable, false);
    assert.match(line, /more than a day old/);
  });

  it("says plainly when it is working from older information", () => {
    const fresh = isDayPackUsable(hoursBefore(1), NOW);
    assert.match(fresh.line, /current/);

    const older = isDayPackUsable(hoursBefore(14), NOW);
    assert.equal(older.usable, true);
    assert.match(older.line, /earlier today/);
  });
});

/* ===========================================================================
   THE WIPE LIST — §10

   Completeness of the list is enforced in db.test.ts, which checks that every
   database is opened through the typed opener and therefore cannot exist without
   being named here.
   ======================================================================== */

describe("revocation", () => {
  it("names the day pack, the device record, the outbox and today's work", () => {
    assert.deepEqual(
      [...LOCAL_DATABASES].sort(),
      ["armory-daypack", "armory-device", "armory-outbox", "armory-session"],
      "a local store was added or renamed without updating the wipe list",
    );
  });
});
