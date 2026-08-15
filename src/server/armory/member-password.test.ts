import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashSecret, verifySecret } from "./kdf";
import { MIN_PASSWORD_LENGTH, normalisePhone } from "./member-password";

/**
 * §3.1: "phone unique, E.164."
 * §9:   OTP by SMS is "the front door to every account" — this password path is
 *        the interim stand-in, and it uses the same identifier.
 * §10:  "No shared logins."
 *
 * `verifyMemberPassword` itself needs Postgres and is exercised on staging with
 * the seeded fixture. What is testable here is everything the security argument
 * actually rests on: the KDF, and the normalisation that decides WHICH person a
 * typed number resolves to.
 *
 * The normalisation matters more than it looks. It sits between what a member
 * types and a unique-key lookup, so a bug in it does not produce a failed
 * sign-in — it produces a sign-in as somebody else, or a member who can never
 * sign in at all.
 */

describe("the phone is normalised to E.164 before it is looked up", () => {
  it("accepts the way a Nigerian member writes their own number", () => {
    /* All four of these are one person. §3.1 stores one canonical form and
       nothing says the member has to know what E.164 means. */
    for (const typed of [
      "08012345678",
      "0801 234 5678",
      "+2348012345678",
      "+234 801 234 5678",
    ]) {
      assert.equal(
        normalisePhone(typed),
        "+2348012345678",
        `${typed} did not normalise`,
      );
    }
  });

  it("strips the punctuation people paste from a contacts app", () => {
    assert.equal(normalisePhone("(0801) 234-5678"), "+2348012345678");
  });

  it("leaves a non-Nigerian number alone rather than assuming +234", () => {
    /* A member with a UK number is not a member with a Nigerian one, and
       rewriting the country code would resolve them to the wrong person or to
       nobody. Only a leading zero is treated as local. */
    assert.equal(normalisePhone("+447700900123"), "+447700900123");
  });

  it("does not invent a country code for a bare number", () => {
    /* `8012345678` with no zero and no plus is ambiguous. Passing it through
       unchanged means it matches nothing and the member is refused — which is
       the safe direction, because the alternative is guessing. */
    assert.equal(normalisePhone("8012345678"), "8012345678");
  });

  it("maps an empty string to an empty string, not to a prefix", () => {
    /* `verifyMemberPassword` refuses an empty identifier before it queries.
       If this returned "+234" an empty form would become a real lookup. */
    assert.equal(normalisePhone(""), "");
    assert.equal(normalisePhone("   "), "");
  });
});

describe("the password KDF", () => {
  it("verifies a correct secret", async () => {
    const stored = await hashSecret("correct horse battery");
    assert.equal(await verifySecret("correct horse battery", stored), true);
  });

  it("rejects a wrong one", async () => {
    const stored = await hashSecret("correct horse battery");
    assert.equal(await verifySecret("correct horse batteries", stored), false);
  });

  it("salts, so two identical passwords do not share a hash", async () => {
    /* Without this, a database dump tells an attacker which members chose the
       same password — and cracking one cracks all of them. */
    const one = await hashSecret("range-day-2026");
    const other = await hashSecret("range-day-2026");

    assert.notEqual(one, other);
    assert.equal(await verifySecret("range-day-2026", one), true);
    assert.equal(await verifySecret("range-day-2026", other), true);
  });

  it("stores what produced it, so the algorithm can change later", async () => {
    /* A stored hash that does not say what made it is a migration nobody can
       perform safely. */
    const stored = await hashSecret("range-day-2026");
    assert.match(stored, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("refuses a malformed stored value instead of throwing", async () => {
    /* A corrupt column must read as "wrong password", not as a 500 on a sign-in
       form — a stack trace there tells an attacker they found something. */
    for (const corrupt of ["", "scrypt:", "bcrypt:aa:bb", "not-a-hash"]) {
      assert.equal(await verifySecret("anything", corrupt), false);
    }
  });
});

describe("the length rule", () => {
  it("is ten, and is the only rule", () => {
    /**
     * Stated as a test because the temptation to add character classes is
     * perennial and always arrives as a small change.
     *
     * Composition rules produce `Password1!` and a note stuck to a monitor.
     * Length is the only requirement that reliably buys entropy, which is what
     * NIST has recommended since 2017 — and ten rather than eight because this
     * credential has no second factor behind it until §9's OTP lands.
     */
    assert.equal(MIN_PASSWORD_LENGTH, 10);
  });
});
