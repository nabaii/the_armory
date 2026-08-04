/**
 * Webhook signature verification and money handling.
 *
 * These are the tests that matter most in this workstream. The webhook endpoint
 * confirms paid bookings; if signature verification is wrong in either
 * direction the consequences are severe and silent — a false negative makes
 * every real payment look forged, and a false positive turns the endpoint into
 * an open door for creating confirmed bookings.
 *
 * All of it is testable without a Paystack account, because the signature is
 * just HMAC-SHA512 over the raw body.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const SECRET = "sk_test_secret_key_for_tests";

/* env.ts reads process.env at import time, so this must be set first. */
process.env.PAYSTACK_SECRET_KEY = SECRET;

let verifyWebhookSignature: typeof import("./paystack").verifyWebhookSignature;
let constantTimeEquals: typeof import("./paystack").constantTimeEquals;
let nairaToKobo: typeof import("./paystack").nairaToKobo;
let koboToNaira: typeof import("./paystack").koboToNaira;
let parseEvent: typeof import("./paystack").parseEvent;

before(async () => {
  const mod = await import("./paystack");
  verifyWebhookSignature = mod.verifyWebhookSignature;
  constantTimeEquals = mod.constantTimeEquals;
  nairaToKobo = mod.nairaToKobo;
  koboToNaira = mod.koboToNaira;
  parseEvent = mod.parseEvent;
});

/** Reference implementation of what Paystack does, independent of ours. */
async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({
    event: "charge.success",
    data: { reference: "ARM-ABCDEF012345", status: "success", amount: 500_000 },
  });

  it("accepts a correctly signed body", async () => {
    assert.equal(await verifyWebhookSignature(body, await sign(body)), true);
  });

  it("accepts an uppercase hex signature", async () => {
    const upper = (await sign(body)).toUpperCase();
    assert.equal(await verifyWebhookSignature(body, upper), true);
  });

  it("tolerates surrounding whitespace in the header", async () => {
    assert.equal(await verifyWebhookSignature(body, `  ${await sign(body)}\n`), true);
  });

  it("rejects a missing signature", async () => {
    assert.equal(await verifyWebhookSignature(body, null), false);
  });

  it("rejects an empty signature", async () => {
    assert.equal(await verifyWebhookSignature(body, ""), false);
  });

  it("rejects a signature made with a different secret", async () => {
    const forged = await sign(body, "sk_test_wrong_key");
    assert.equal(await verifyWebhookSignature(body, forged), false);
  });

  it("rejects when the body has been altered after signing", async () => {
    const signature = await sign(body);
    /* The exact attack this protects against: raise the amount in flight. */
    const tampered = body.replace("500000", "1");
    assert.equal(await verifyWebhookSignature(tampered, signature), false);
  });

  it("is sensitive to whitespace, which is why the raw body must be used", async () => {
    /* Parsing and re-serialising JSON changes bytes and breaks the digest.
       This test exists to document why the route reads request.text() first. */
    const signature = await sign(body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    assert.notEqual(reserialised, body);
    assert.equal(await verifyWebhookSignature(reserialised, signature), false);
  });

  it("rejects a truncated signature rather than matching a prefix", async () => {
    const signature = await sign(body);
    assert.equal(await verifyWebhookSignature(body, signature.slice(0, 64)), false);
  });
});

describe("constantTimeEquals", () => {
  it("matches identical strings", () => {
    assert.equal(constantTimeEquals("abc123", "abc123"), true);
  });

  it("rejects differing strings of equal length", () => {
    assert.equal(constantTimeEquals("abc123", "abc124"), false);
  });

  it("rejects differing lengths", () => {
    assert.equal(constantTimeEquals("abc", "abcd"), false);
  });

  it("rejects a difference in the first character", () => {
    /* A naive early-return comparison would leak position via timing. This only
       asserts correctness; the constant-time property is structural. */
    assert.equal(constantTimeEquals("Xbc123", "abc123"), false);
  });

  it("treats empty strings as equal", () => {
    assert.equal(constantTimeEquals("", ""), true);
  });
});

describe("money", () => {
  it("converts naira to integer kobo", () => {
    assert.equal(nairaToKobo(25_000), 2_500_000);
    assert.equal(nairaToKobo(0), 0);
  });

  it("rounds rather than truncating fractional naira", () => {
    assert.equal(nairaToKobo(10.005), 1001);
    assert.equal(nairaToKobo(10.004), 1000);
  });

  it("always returns an integer, because Paystack rejects fractional kobo", () => {
    for (const naira of [1.1, 2.2, 3.3, 99.99, 1234.567]) {
      assert.ok(Number.isInteger(nairaToKobo(naira)), `${naira} produced a non-integer`);
    }
  });

  it("survives a float round-trip that would break naive arithmetic", () => {
    /* 0.1 + 0.2 = 0.30000000000000004. Deposits are computed in kobo for
       exactly this reason. */
    const kobo = nairaToKobo(0.1) + nairaToKobo(0.2);
    assert.equal(kobo, 30);
    assert.equal(koboToNaira(kobo), 0.3);
  });

  it("refuses negative and non-finite amounts", () => {
    assert.throws(() => nairaToKobo(-1));
    assert.throws(() => nairaToKobo(Number.NaN));
    assert.throws(() => nairaToKobo(Number.POSITIVE_INFINITY));
  });
});

describe("parseEvent", () => {
  it("parses a well-formed event", () => {
    const parsed = parseEvent(
      JSON.stringify({ event: "charge.success", data: { reference: "ARM-1" } }),
    );
    assert.equal(parsed?.event, "charge.success");
    assert.equal(parsed?.data.reference, "ARM-1");
  });

  it("returns null for invalid json rather than throwing", () => {
    assert.equal(parseEvent("{not json"), null);
  });

  it("returns null when the shape is wrong", () => {
    assert.equal(parseEvent(JSON.stringify({ event: 42 })), null);
    assert.equal(parseEvent(JSON.stringify({ data: {} })), null);
  });
});
