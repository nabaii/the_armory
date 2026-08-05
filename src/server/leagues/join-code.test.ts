/**
 * Join codes.
 *
 * These are read aloud across a firing line and written on napkins, so the
 * tests that matter are the forgiveness ones — a member who types what they
 * heard must get in.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatJoinCode,
  generateJoinCode,
  isValidJoinCode,
  normaliseJoinCode,
} from "./join-code";

describe("generateJoinCode", () => {
  it("is six characters", () => {
    for (let i = 0; i < 100; i += 1) assert.equal(generateJoinCode().length, 6);
  });

  it("never emits a confusable character", () => {
    // I, L, O and U are excluded: the first three are indistinguishable from
    // 1 and 0 in a sans face, and U keeps random codes from spelling things.
    for (let i = 0; i < 2000; i += 1) {
      assert.doesNotMatch(generateJoinCode(), /[ILOU]/);
    }
  });

  it("uses only the Crockford alphabet", () => {
    for (let i = 0; i < 500; i += 1) {
      assert.match(generateJoinCode(), /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    }
  });

  it("does not repeat in a realistic number of leagues", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(generateJoinCode());
    assert.equal(seen.size, 5000);
  });

  it("uses the whole alphabet rather than a biased subset", () => {
    // A modulo-biased generator would under-represent the tail of the
    // alphabet. Over 6000 characters every symbol should appear.
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      for (const c of generateJoinCode()) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    assert.equal(counts.size, 32, "not every symbol appeared");
  });
});

describe("normaliseJoinCode — forgiveness", () => {
  it("accepts a code exactly as generated", () => {
    const code = generateJoinCode();
    assert.equal(normaliseJoinCode(code), code);
  });

  it("accepts lowercase", () => {
    assert.equal(normaliseJoinCode("abc234"), "ABC234");
  });

  it("accepts the printed hyphen", () => {
    assert.equal(normaliseJoinCode("ABC-234"), "ABC234");
  });

  it("accepts spaces", () => {
    assert.equal(normaliseJoinCode(" A B C 2 3 4 "), "ABC234");
  });

  it("forgives O typed for zero", () => {
    // Someone reading "ARM0" aloud says "arm oh". The listener types O.
    assert.equal(normaliseJoinCode("ABCO34"), "ABC034");
  });

  it("forgives I and L typed for one", () => {
    assert.equal(normaliseJoinCode("ABCI34"), "ABC134");
    assert.equal(normaliseJoinCode("ABCL34"), "ABC134");
  });

  it("forgives a combination of all of them", () => {
    assert.equal(normaliseJoinCode("  abc-oil  "), "ABC011");
  });
});

describe("normaliseJoinCode — rejection", () => {
  it("rejects the wrong length", () => {
    assert.equal(normaliseJoinCode("ABC23"), null);
    assert.equal(normaliseJoinCode("ABC2345"), null);
    assert.equal(normaliseJoinCode(""), null);
  });

  it("rejects characters outside the alphabet", () => {
    assert.equal(normaliseJoinCode("ABC23!"), null);
    assert.equal(normaliseJoinCode("ABC23é"), null);
  });

  it("rejects a value that is only punctuation", () => {
    assert.equal(normaliseJoinCode("------"), null);
  });

  it("round-trips every generated code through normalisation", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateJoinCode();
      assert.equal(normaliseJoinCode(formatJoinCode(code)), code);
    }
  });
});

describe("formatJoinCode", () => {
  it("groups as three and three", () => {
    assert.equal(formatJoinCode("ABC234"), "ABC-234");
  });

  it("is idempotent against an already-formatted code", () => {
    assert.equal(formatJoinCode("ABC-234"), "ABC-234");
  });
});

describe("isValidJoinCode", () => {
  it("agrees with normalise", () => {
    assert.equal(isValidJoinCode("abc-234"), true);
    assert.equal(isValidJoinCode("nope"), false);
  });
});
