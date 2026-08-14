import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_LOCAL_ATTEMPTS,
  actorFor,
  beginShift,
  shiftIsLive,
  unlockLocally,
  type OfficerShift,
} from "./officer";

/**
 * §10: "No shared logins. Every staff action attributable to a named person.
 *       Device-bound sessions with a short local unlock."
 *
 * docs/M1_offline_acceptance.md records the debt this closes: check-ins made
 * during M1 "name a tablet and honestly not a human", and the fix "needs to work
 * OFFLINE — so it cannot verify a PIN against the server, and the day pack
 * deliberately does not carry `staff_users.pin_hash`."
 */

const NOW = new Date("2026-08-13T08:00:00.000Z");

const shift = () =>
  beginShift({
    staffUserId: "staff-1",
    displayName: "Ada Nwosu",
    role: "range_officer",
    pin: "419285",
    now: NOW,
  });

describe("beginning a shift", () => {
  it("keeps a verifier that is not the PIN", async () => {
    const started = await shift();

    assert.doesNotMatch(started.verifier, /419285/);
    assert.doesNotMatch(started.salt, /419285/);
    assert.match(started.verifier, /^[0-9a-f]{64}$/);
  });

  it("salts per unlock, so two shifts never share a verifier", async () => {
    /* Even the same officer with the same PIN on the same tablet. A verifier
       that repeated would be a fingerprint an attacker could recognise across
       wipes. */
    const one = await shift();
    const other = await shift();

    assert.notEqual(one.salt, other.salt);
    assert.notEqual(one.verifier, other.verifier);
  });

  it("names the officer, because that is the entire point", async () => {
    /* §10: "Every staff action attributable to a named person." */
    const started = await shift();
    assert.equal(started.staffUserId, "staff-1");
    assert.equal(started.displayName, "Ada Nwosu");
  });
});

describe("the local unlock", () => {
  it("accepts the PIN the shift was started with", async () => {
    const outcome = await unlockLocally(await shift(), "419285", NOW);
    assert.equal(outcome.ok, true);
  });

  it("refuses a wrong PIN", async () => {
    const outcome = await unlockLocally(await shift(), "419286", NOW);
    assert.equal(outcome.ok, false);
  });

  it("counts attempts on the record, not in memory", async () => {
    /* An in-memory counter resets when the desk is force-quit, which is both
       the obvious thing to try and the first thing an attacker would do. */
    const outcome = await unlockLocally(await shift(), "000000", NOW);

    if (outcome.ok) return assert.fail("expected a refusal");
    assert.equal(outcome.shift?.failedAttempts, 1);
  });

  it("locks out after the limit and sends the officer to a connection", async () => {
    let current: OfficerShift | null = await shift();

    for (let attempt = 0; attempt < MAX_LOCAL_ATTEMPTS; attempt += 1) {
      const outcome = await unlockLocally(current, "000000", NOW);
      if (outcome.ok) return assert.fail("a wrong PIN was accepted");
      current = outcome.shift;
    }

    const spent = await unlockLocally(current, "419285", NOW);

    assert.equal(spent.ok, false, "the correct PIN still worked after the limit");
    if (spent.ok) return;
    assert.match(spent.remedy ?? "", /connection/);
  });

  it("clears the count on a success", async () => {
    const wrong = await unlockLocally(await shift(), "000000", NOW);
    if (wrong.ok) return assert.fail("expected a refusal");

    const right = await unlockLocally(wrong.shift, "419285", NOW);
    if (!right.ok) return assert.fail("expected an unlock");
    assert.equal(right.shift.failedAttempts, 0);
  });

  it("says how many tries are left, because cold hands mistype", async () => {
    const outcome = await unlockLocally(await shift(), "000000", NOW);
    if (outcome.ok) return assert.fail("expected a refusal");
    assert.match(outcome.remedy ?? "", /2 tries left/);
  });
});

describe("§10's 'short'", () => {
  it("ends the shift after its window and discards the verifier", async () => {
    const started = await shift();
    const tomorrow = new Date(started.expiresAt.getTime() + 1000);

    const outcome = await unlockLocally(started, "419285", tomorrow);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    /* Null, not the expired shift. Keeping it would leave a verifier on disk
       for an officer who is no longer working — the opposite of "short". */
    assert.equal(outcome.shift, null);
    assert.match(outcome.remedy ?? "", /connection/);
  });

  it("treats a live shift as usable without asking again", async () => {
    /* Demanding a PIN between every arrival would put §1.2's fifteen-second
       budget out of reach and teach the club to leave the tablet unlocked. */
    const started = await shift();
    assert.equal(shiftIsLive(started, NOW), true);
  });

  it("treats an expired one as not", async () => {
    const started = await shift();
    assert.equal(shiftIsLive(started, new Date(started.expiresAt.getTime() + 1)), false);
  });
});

describe("attribution", () => {
  it("names the officer while the shift is live", async () => {
    assert.equal(actorFor(await shift(), NOW), "staff-1");
  });

  it("returns null rather than a stale name when the shift has ended", async () => {
    /* The honest answer. §10 wants a named person, and naming somebody whose
       shift ended hours ago would be worse than admitting the system does not
       know — it would put their name on a custody event they were not there for. */
    const started = await shift();
    assert.equal(actorFor(started, new Date(started.expiresAt.getTime() + 1)), null);
  });

  it("returns null when nobody has signed in", () => {
    assert.equal(actorFor(null, NOW), null);
  });
});
