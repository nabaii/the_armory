import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFLINE_GRACE_DAYS,
  OFFLINE_WARNING_DAYS,
  evaluateDeviceTrust,
  isDayPackUsable,
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

describe("device trust", () => {
  it("allows a registered device the server confirms", () => {
    const decision = evaluateDeviceTrust(
      registration(0),
      { reachable: true, revoked: false },
      NOW,
    );
    assert.equal(decision.action, "allow");
  });

  it("§10: wipes when the server says revoked", () => {
    const decision = evaluateDeviceTrust(
      registration(0),
      { reachable: true, revoked: true },
      NOW,
    );
    assert.equal(decision.action, "wipe");
  });

  it("refuses an unregistered device rather than wiping it", () => {
    const decision = evaluateDeviceTrust(null, { reachable: false }, NOW);
    assert.equal(decision.action, "refuse");
  });

  it("§8: keeps working offline through an ordinary outage", () => {
    for (let days = 0; days < OFFLINE_GRACE_DAYS; days += 1) {
      const decision = evaluateDeviceTrust(
        registration(days),
        { reachable: false },
        NOW,
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
      NOW,
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
      NOW,
    );
    assert.equal(decision.action, "refuse");
    assert.notEqual(decision.action, "wipe");
  });

  it("warns before it locks, so the outage is not a surprise", () => {
    const quiet = evaluateDeviceTrust(
      registration(OFFLINE_WARNING_DAYS - 1),
      { reachable: false },
      NOW,
    );
    assert.equal(quiet.action === "allow" && quiet.warning, null);

    const warned = evaluateDeviceTrust(
      registration(OFFLINE_WARNING_DAYS),
      { reachable: false },
      NOW,
    );
    assert.equal(warned.action, "allow");
    assert.ok(
      warned.action === "allow" && warned.warning?.includes("stops working"),
      "an officer must be told before the desk locks itself",
    );
  });

  it("survives a tablet whose clock came back wrong", () => {
    /* Battery died, restored with a date in the past. Locking the desk over a
       bad clock would be a self-inflicted outage. */
    const future = registration(-5);
    const decision = evaluateDeviceTrust(future, { reachable: false }, NOW);
    assert.equal(decision.action, "allow");
  });

  it("a reachable server always beats a stale local clock", () => {
    /* Even far past the grace period, a server that says "not revoked" is the
       authority — the bound exists only because the server is silent. */
    const decision = evaluateDeviceTrust(
      registration(OFFLINE_GRACE_DAYS + 90),
      { reachable: true, revoked: false },
      NOW,
    );
    assert.equal(decision.action, "allow");
  });

  it("every refusal and warning is written for a person", () => {
    const cases = [
      evaluateDeviceTrust(null, { reachable: false }, NOW),
      evaluateDeviceTrust(registration(99), { reachable: false }, NOW),
      evaluateDeviceTrust(registration(0), { reachable: true, revoked: true }, NOW),
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
      NOW,
    );
    assert.equal(decision.action, "refuse");
    if (decision.action !== "refuse") return;
    assert.match(decision.remedy, /connect/i);
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
   ======================================================================== */

describe("revocation", () => {
  it("names every local database, so a new one cannot be forgotten", () => {
    /* This assertion is a tripwire. Adding a fourth IndexedDB database
       without adding it to LOCAL_DATABASES means revocation silently leaves
       it on the device — and revocation would still report success. */
    assert.deepEqual(
      [...LOCAL_DATABASES].sort(),
      ["armory-daypack", "armory-device", "armory-outbox"],
      "a local store was added or renamed without updating the wipe list",
    );
  });
});
