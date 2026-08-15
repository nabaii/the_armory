import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_TOKEN_TTL_MS } from "@/server/auth/tokens";
import { VERIFICATION_TTL_MS, requestEmailVerification } from "./email-verification";

/**
 * Proving an email address.
 *
 * Following the convention member-password.test.ts sets: the paths that need
 * Postgres — issuing, redeeming, the collision refusals — are exercised on
 * staging against the seeded fixture. What is tested here is what runs BEFORE
 * the database is touched, which is the validation that decides whether the
 * club sends a message to an address at all.
 *
 * That ordering is not incidental and these tests depend on it: a malformed
 * address must be refused without a query and without a send, so a member
 * fat-fingering their address never becomes a message to a stranger.
 */

const reject = async (email: string) =>
  requestEmailVerification({ personId: "irrelevant", email, now: new Date() });

describe("an address is checked before anything is sent", () => {
  it("refuses what is not an address", async () => {
    for (const bad of [
      "",
      "   ",
      "ada",
      "ada@",
      "@example.com",
      "ada@example",
      "ada example@test.com",
      "ada@exam ple.com",
    ]) {
      const result = await reject(bad);
      assert.equal(result.ok, false, `accepted ${JSON.stringify(bad)}`);
      if (!result.ok) assert.match(result.reason, /check the email address/i);
    }
  });

  it("refuses a single-letter top level domain", async () => {
    /* The regex asks for two characters after the dot. A trailing typo like
       "example.c" is the shape a fat finger produces, and it is worth catching
       here rather than as a bounce. */
    const result = await reject("ada@example.c");
    assert.equal(result.ok, false);
  });

  it("refuses without reaching the database", async () => {
    /* No DATABASE_URL is set in this process. If validation ran after the
       client was resolved, `getArmoryDb()` would throw rather than return a
       refusal — so this passing IS the assertion that nothing is queried and
       no mail is prepared for a malformed address. */
    const result = await reject("not-an-address");
    assert.equal(result.ok, false);
  });
});

describe("how long a link lives", () => {
  it("lasts an hour", () => {
    assert.equal(VERIFICATION_TTL_MS, 60 * 60_000);
  });

  it("outlives a sign-in link, deliberately", () => {
    /* A sign-in link is fifteen minutes because redeeming it hands over a
       session. This one grants nothing — it proves a mailbox — and the member
       may well have to move to the device their mail is on, so it is given
       longer. If that ever inverts, one of the two has stopped being what its
       comment says it is. */
    assert.ok(
      VERIFICATION_TTL_MS > AUTH_TOKEN_TTL_MS,
      "a confirmation link should not expire faster than a sign-in link",
    );
  });

  it("is short enough that a forwarded link dies", () => {
    assert.ok(VERIFICATION_TTL_MS <= 24 * 60 * 60_000);
  });
});
