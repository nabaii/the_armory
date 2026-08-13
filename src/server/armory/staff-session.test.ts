import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPin, verifyPin } from "./staff-session";

/**
 * §10: "No shared logins. Every staff action attributable to a named person.
 *       Device-bound sessions with a short local unlock. Shared accounts destroy
 *       the attribution the custody log exists to provide."
 *
 * The unlock flow itself needs Postgres and a registered device, so it is
 * exercised on hardware rather than here. What IS testable without either is the
 * part that protects a named officer's identity from someone holding the tablet
 * — and a six-digit PIN has so little entropy that this is where the protection
 * has to be real.
 */

describe("the PIN hash", () => {
  it("verifies the PIN it was made from", async () => {
    const stored = await hashPin("419285");
    assert.equal(await verifyPin("419285", stored), true);
  });

  it("rejects a wrong PIN", async () => {
    const stored = await hashPin("419285");
    assert.equal(await verifyPin("419286", stored), false);
  });

  it("salts, so two officers with the same PIN do not share a hash", async () => {
    /* Without a per-user salt, a database dump would show at a glance which
       officers share a PIN — and one cracked hash would open every account that
       matched it. §3.1's comment on `pin_hash` asks for exactly this. */
    const one = await hashPin("000000");
    const other = await hashPin("000000");

    assert.notEqual(one, other);
    assert.equal(await verifyPin("000000", one), true);
    assert.equal(await verifyPin("000000", other), true);
  });

  it("names the algorithm in the stored value", async () => {
    /* A stored hash that does not say what produced it is a migration nobody
       can perform safely later. */
    const stored = await hashPin("419285");
    assert.match(stored, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("never stores the PIN itself", async () => {
    const stored = await hashPin("419285");
    assert.doesNotMatch(stored, /419285/);
  });

  it("refuses a hash it cannot parse rather than failing open", async () => {
    /* The dangerous failure would be returning true — or throwing in a way a
       caller catches and treats as "no PIN set, let them in". A row corrupted
       by a bad migration must lock the account, not open it. */
    for (const malformed of ["", "not-a-hash", "scrypt:", "bcrypt:aa:bb", "::"]) {
      assert.equal(await verifyPin("419285", malformed), false);
    }
  });

  it("does not treat an empty PIN as matching an empty stored hash", async () => {
    assert.equal(await verifyPin("", ""), false);
  });
});
