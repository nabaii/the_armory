import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveConsoleGate, type BootFacts } from "./boot";
import { OFFLINE_GRACE_DAYS, OFFLINE_WARNING_DAYS, type DeviceRegistration } from "./device";

/**
 * What an officer sees when they open the desk, decided without a browser.
 *
 * §3.1, §8 and §10 disagree about what should happen on a device that cannot reach
 * the server, and boot.ts resolves that in a fixed order. These are the tests that
 * the order holds — particularly the one case that must never be friendly.
 */

const NOW = new Date("2026-08-12T08:00:00.000Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const registration = (lastVerifiedDaysAgo: number): DeviceRegistration => ({
  deviceId: "device-1",
  label: "Desk tablet",
  surface: "desk",
  registeredAt: daysAgo(300),
  lastVerifiedAt: daysAgo(lastVerifiedDaysAgo),
});

const facts = (overrides: Partial<BootFacts> = {}): BootFacts => ({
  registration: registration(0),
  verdict: { reachable: false },
  clock: { now: NOW, highWaterAt: NOW },
  packPulledAt: hoursAgo(2),
  storagePersistent: true,
  ...overrides,
});

describe("opening the console", () => {
  it("opens for a registered device with a fresh pack", () => {
    const gate = resolveConsoleGate(facts());
    assert.equal(gate.open, true);
    assert.equal(gate.open && gate.canRunSession, true);
  });

  it("§10: a revoked device is wiped and shown nothing", () => {
    const gate = resolveConsoleGate(
      facts({ verdict: { reachable: true, revoked: true } }),
    );
    assert.equal(gate.open, false);
    assert.equal(gate.open === false && gate.wipe, true);
  });

  it("a stale device is refused WITHOUT a wipe — unsynced records survive", () => {
    const gate = resolveConsoleGate(
      facts({ registration: registration(OFFLINE_GRACE_DAYS + 1) }),
    );
    assert.equal(gate.open, false);
    assert.equal(
      gate.open === false && gate.wipe,
      false,
      "refusing a cut-off device must not destroy an afternoon of custody events",
    );
    assert.ok(gate.open === false && gate.remedy);
  });

  it("checks trust before it checks the pack", () => {
    /* The ordering test, and the reason boot.ts is a function. A revoked tablet
       whose pack is also stale must get the revocation, not the friendly "download
       today's information" screen — the stolen-device path must not be reachable
       by having old data. */
    const gate = resolveConsoleGate(
      facts({
        verdict: { reachable: true, revoked: true },
        packPulledAt: daysAgo(9),
      }),
    );

    assert.equal(gate.open, false);
    assert.equal(gate.open === false && gate.wipe, true);
    assert.match(
      gate.open === false ? gate.heading : "",
      /signed out of the club's system/,
    );
  });

  it("opens but refuses to run a session from a pack that is too old", () => {
    /* §8.1: the pack covers today and tomorrow. One from last week has the wrong
       arrivals and a firearm register that predates whatever has been issued since.
       The desk still opens, because the officer needs to see why and retry. */
    const gate = resolveConsoleGate(facts({ packPulledAt: hoursAgo(40) }));

    assert.equal(gate.open, true);
    assert.equal(gate.open && gate.canRunSession, false);
    assert.ok(
      gate.open && gate.notices.some((n) => /more than a day old/.test(n.line)),
    );
  });

  it("opens with nothing on a device that has never synced", () => {
    const gate = resolveConsoleGate(facts({ packPulledAt: null }));
    assert.equal(gate.open, true);
    assert.equal(gate.open && gate.canRunSession, false);
    assert.ok(
      gate.open && gate.notices.some((n) => /not downloaded/.test(n.line)),
    );
  });

  it("warns about the device before it warns about the data", () => {
    /* An officer who is two days from losing the desk needs that first. */
    const gate = resolveConsoleGate(
      facts({
        registration: registration(OFFLINE_WARNING_DAYS),
        packPulledAt: hoursAgo(20),
      }),
    );

    assert.equal(gate.open, true);
    if (!gate.open) return;
    assert.match(gate.notices[0].line, /offline for/);
    assert.match(gate.notices[1].line, /earlier today/);
  });

  it("§2: says so when the browser has not promised to keep anything", () => {
    const gate = resolveConsoleGate(facts({ storagePersistent: false }));
    assert.equal(gate.open, true);
    assert.ok(
      gate.open && gate.notices.some((n) => /keep information offline/.test(n.line)),
    );
  });

  it("every line reads as a sentence written for a person", () => {
    const cases = [
      resolveConsoleGate(facts({ verdict: { reachable: true, revoked: true } })),
      resolveConsoleGate(facts({ registration: null })),
      resolveConsoleGate(facts({ packPulledAt: null, storagePersistent: false })),
      resolveConsoleGate(
        facts({ registration: registration(OFFLINE_WARNING_DAYS + 1) }),
      ),
    ];

    for (const gate of cases) {
      const lines = gate.open
        ? gate.notices.map((n) => n.line)
        : [gate.heading, gate.body, gate.remedy ?? ""].filter(Boolean);

      for (const line of lines) {
        assert.match(line, /[.]$/, `not a sentence: "${line}"`);
        assert.ok(
          !/error|invalid|denied|forbidden|null|undefined/i.test(line),
          `reads as a system message: "${line}"`,
        );
      }
    }
  });
});
