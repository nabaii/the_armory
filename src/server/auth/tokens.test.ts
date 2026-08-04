/**
 * Passwordless sign-in tokens.
 *
 * A sign-in link is a bearer credential: whoever holds it is the member. These
 * tests pin the three properties that make that safe — unguessable, stored
 * hashed, short-lived and single-use.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTH_TOKEN_TTL_MS,
  authTokenExpiry,
  generateToken,
  hashToken,
  normaliseEmail,
  sessionExpiry,
  SESSION_TTL_MS,
  tokenRedeemable,
} from "./tokens";

describe("generateToken", () => {
  it("is URL-safe with no padding", () => {
    // Padding is a real cause of "the link doesn't work": a trailing `=` gets
    // truncated by link detectors in email clients.
    for (let i = 0; i < 200; i += 1) {
      assert.match(generateToken(), /^[A-Za-z0-9_-]+$/);
    }
  });

  it("carries enough entropy to be unguessable", () => {
    // 32 bytes → 43 base64url characters.
    assert.ok(generateToken().length >= 43);
  });

  it("never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(generateToken());
    assert.equal(seen.size, 2000);
  });
});

describe("hashToken", () => {
  it("produces a 64-character hex sha-256", async () => {
    assert.match(await hashToken("hello"), /^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    assert.equal(await hashToken("abc"), await hashToken("abc"));
  });

  it("differs for different inputs", async () => {
    assert.notEqual(await hashToken("abc"), await hashToken("abd"));
  });

  it("matches the known sha-256 of a known input", async () => {
    // Guards against a future change to a different algorithm silently
    // invalidating every token already in the database.
    assert.equal(
      await hashToken("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("does not return the raw token", async () => {
    // The whole point: a dump of auth_tokens must grant nobody a session.
    const raw = generateToken();
    assert.notEqual(await hashToken(raw), raw);
  });
});

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    assert.equal(normaliseEmail("  Adaeze@Example.COM "), "adaeze@example.com");
  });

  it("does NOT strip dots or plus-tags", () => {
    // Gmail-specific behaviour. Applying it universally silently merges
    // distinct accounts on providers where those characters are significant —
    // two members sharing one identity, which is far worse than a duplicate.
    assert.equal(normaliseEmail("first.last@example.com"), "first.last@example.com");
    assert.equal(normaliseEmail("user+league@example.com"), "user+league@example.com");
  });
});

describe("expiry", () => {
  const now = new Date("2026-08-05T10:00:00.000Z");

  it("expires sign-in links in fifteen minutes", () => {
    assert.equal(authTokenExpiry(now).getTime() - now.getTime(), AUTH_TOKEN_TTL_MS);
    assert.equal(AUTH_TOKEN_TTL_MS, 15 * 60_000);
  });

  it("expires sessions in thirty days", () => {
    assert.equal(sessionExpiry(now).getTime() - now.getTime(), SESSION_TTL_MS);
  });

  it("keeps the sign-in window far shorter than the session", () => {
    // Email is not a secure channel; a session cookie is comparatively safe.
    assert.ok(AUTH_TOKEN_TTL_MS < SESSION_TTL_MS / 100);
  });
});

describe("tokenRedeemable", () => {
  const now = new Date("2026-08-05T10:00:00.000Z");
  const future = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 1);

  it("allows a fresh, unused token", () => {
    assert.deepEqual(
      tokenRedeemable({ expiresAt: future, consumedAt: null }, now),
      { ok: true },
    );
  });

  it("refuses an expired token", () => {
    const r = tokenRedeemable({ expiresAt: past, consumedAt: null }, now);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "expired");
  });

  it("refuses a token expiring exactly now", () => {
    const r = tokenRedeemable({ expiresAt: now, consumedAt: null }, now);
    assert.equal(r.ok, false);
  });

  it("refuses a token that has already been used", () => {
    const r = tokenRedeemable({ expiresAt: future, consumedAt: now }, now);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "already-used");
  });

  it("reports already-used ahead of expired", () => {
    // A replayed old link is a more interesting signal than a stale one.
    const r = tokenRedeemable({ expiresAt: past, consumedAt: now }, now);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "already-used");
  });
});
