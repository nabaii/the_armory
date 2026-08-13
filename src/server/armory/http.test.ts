import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outcomeResponse, readEnvelope } from "./http";
import type { Outcome } from "./record";

/**
 * §7:  "A queued write delivered twice must produce one row, not two. This is
 *       the single most important API requirement in the system."
 * §8.2: "Rejections surface to the officer — never silently discarded."
 *
 * `record()` guarantees the row. This file is about the half that can still go
 * wrong afterwards: TELLING the caller what happened. The dangerous mistake is a
 * natural one — a duplicate looks like a conflict, 409 is the conflict status,
 * and src/sync/contract.ts makes a 409 FINAL. Answering a replay with 409 would
 * surface a phantom refusal for a record that is safely stored, and nothing in
 * the database would look wrong.
 */

const body = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

describe("a replay is answered as success", () => {
  const duplicate: Outcome<{ membershipId: string }> = {
    status: "duplicate",
    result: { membershipId: "m-1" },
  };

  it("is 200, not 409", async () => {
    const response = outcomeResponse(duplicate);
    assert.equal(response.status, 200);
  });

  it("carries the first execution's result", async () => {
    /* §7: "replaying that must reproduce the original RESULT, not perform it
       again." A 200 with an empty body would satisfy the status code and lose
       the member number the caller was waiting for. */
    const parsed = await body(outcomeResponse(duplicate));
    assert.deepEqual(parsed.result, { membershipId: "m-1" });
  });

  it("says which it was, so a client can tell", async () => {
    const first = await body(
      outcomeResponse({ status: "applied", result: { membershipId: "m-1" } }),
    );
    const second = await body(outcomeResponse(duplicate));

    assert.equal(first.outcome, "applied");
    assert.equal(second.outcome, "duplicate");
    /* Same result either way — the distinction is reportable, not consequential. */
    assert.deepEqual(first.result, second.result);
  });
});

describe("a refusal", () => {
  it("is 409 and final", async () => {
    const response = outcomeResponse({
      status: "refused",
      refusal: {
        code: "ROSTER_AT_CAP",
        message: "The roster is at its cap. Admitting now needs a founder override.",
      },
    });

    assert.equal(response.status, 409);
  });

  it("reaches the officer as a sentence, not a code", async () => {
    /* §4.3: "Every block returns a specific single-line reason. Never 'not
       permitted', never a code, never a stack of conditions." */
    const parsed = await body(
      outcomeResponse({
        status: "refused",
        refusal: {
          code: "ROSTER_AT_CAP",
          message: "The roster is at its cap. Admitting now needs a founder override.",
        },
      }),
    );

    assert.match(String(parsed.reason), /founder override/);
    assert.doesNotMatch(String(parsed.reason), /ROSTER_AT_CAP/);
  });

  it("makes an in-flight write retryable rather than final", async () => {
    /* The one refusal that is not the domain saying no. Another delivery of the
       same request owns it; answering 409 would surface a refusal to an officer
       for a record that is about to exist. */
    const response = outcomeResponse({
      status: "refused",
      refusal: {
        code: "IN_FLIGHT",
        message:
          "This record is already being written. Nothing was lost; it will be sent again on the next sync.",
      },
    });

    assert.equal(response.status, 503);
  });
});

describe("every response", () => {
  it("forbids caching", async () => {
    /* These bodies carry applications, names and roster counts — §10's
       "concentration of sensitive personal data". No intermediary should hold a
       copy, which is the same instruction /sync/* gives. */
    for (const outcome of [
      { status: "applied", result: {} },
      { status: "duplicate", result: {} },
      { status: "refused", refusal: { code: "X", message: "No." } },
    ] as Outcome<unknown>[]) {
      assert.equal(
        outcomeResponse(outcome).headers.get("cache-control"),
        "no-store",
      );
    }
  });
});

describe("the write envelope", () => {
  const valid = {
    requestId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    payload: { decision: "admit" },
  };

  it("accepts a client-generated UUID and a payload", () => {
    assert.deepEqual(readEnvelope(valid), valid);
  });

  it("refuses a request with no id, because that id IS the idempotency", () => {
    /* §7 makes the client-generated id the record identity. A server that
       accepted a write without one would make every retry a new operation —
       which is precisely the duplicate the whole mechanism exists to prevent. */
    assert.equal(readEnvelope({ payload: {} }), null);
  });

  it("refuses an id that is not a UUID", () => {
    assert.equal(readEnvelope({ requestId: "42", payload: {} }), null);
    assert.equal(readEnvelope({ requestId: "", payload: {} }), null);
  });

  it("refuses a missing or non-object payload", () => {
    assert.equal(readEnvelope({ requestId: valid.requestId }), null);
    assert.equal(
      readEnvelope({ requestId: valid.requestId, payload: "admit" }),
      null,
    );
  });

  it("refuses a body that is not an object at all", () => {
    for (const junk of [null, undefined, "", 0, [], "admit"]) {
      assert.equal(readEnvelope(junk), null);
    }
  });
});
