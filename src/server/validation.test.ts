/**
 * Validation.
 *
 * Two things here are policy rather than plumbing, and both have tests that
 * would fail loudly if someone "tidied" them away:
 *
 *   · The booking validator rejects a submission whose refund-policy version
 *     does not match the one in force. §9 requires the terms to appear before
 *     payment; if they changed mid-booking, the visitor agreed to something else.
 *   · Party names are never collected. Flow B allows them as optional, and they
 *     are deliberately absent — see the note in validation.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateApplication,
  validateBookingRequest,
  validateGroupEnquiry,
  validateWaitlist,
  isHoneypotTripped,
  normalisePhone,
} from "./validation";

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const validApplication = {
  name: "Adaeze Okonkwo",
  email: "adaeze@example.com",
  phone: "+234 801 234 5678",
  referral: "friend",
};

describe("validateApplication", () => {
  it("accepts a complete application", () => {
    const result = validateApplication(form(validApplication));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.name, "Adaeze Okonkwo");
      assert.equal(result.value.tier, null);
      assert.equal(result.value.note, null);
    }
  });

  it("normalises the phone number", () => {
    const result = validateApplication(form(validApplication));
    if (result.ok) assert.equal(result.value.phone, "+2348012345678");
  });

  it("trims surrounding whitespace", () => {
    const result = validateApplication(
      form({ ...validApplication, name: "  Adaeze Okonkwo  " }),
    );
    if (result.ok) assert.equal(result.value.name, "Adaeze Okonkwo");
  });

  it("requires a name", () => {
    const result = validateApplication(form({ ...validApplication, name: "A" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.name);
  });

  it("requires a plausible email", () => {
    for (const email of ["", "nope", "a@b", "a b@example.com"]) {
      const result = validateApplication(form({ ...validApplication, email }));
      assert.equal(result.ok, false, `accepted invalid email ${JSON.stringify(email)}`);
    }
  });

  it("accepts unusual but valid email shapes", () => {
    /* An over-strict regex rejecting real addresses costs more on the primary
       conversion event than a bounced email does. */
    for (const email of [
      "a.b+tag@sub.example.co.uk",
      "first_last@example-domain.ng",
      "x@y.io",
    ]) {
      const result = validateApplication(form({ ...validApplication, email }));
      assert.equal(result.ok, true, `rejected ${email}`);
    }
  });

  it("requires a referral source", () => {
    const result = validateApplication(form({ ...validApplication, referral: "" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.referral);
  });

  it("treats tier as optional, so the form works before tiers are named", () => {
    const result = validateApplication(form(validApplication));
    assert.equal(result.ok, true);
  });

  it("rejects an over-long note rather than truncating it silently", () => {
    const result = validateApplication(
      form({ ...validApplication, note: "x".repeat(2001) }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.note);
  });

  it("reports every invalid field at once", () => {
    const result = validateApplication(form({ name: "", email: "no", phone: "", referral: "" }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(Object.keys(result.errors).length, 4);
    }
  });
});

describe("validateGroupEnquiry", () => {
  const valid = {
    "group-name": "Chidi Balogun",
    "group-email": "chidi@example.com",
    "group-phone": "08012345678",
    "group-size": "12",
    "group-type": "corporate",
  };

  it("accepts a complete enquiry", () => {
    const result = validateGroupEnquiry(form(valid));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.partySize, 12);
  });

  it("requires a party size, because it is a stated success measure", () => {
    const result = validateGroupEnquiry(form({ ...valid, "group-size": "" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors["group-size"]);
  });

  it("rejects party sizes outside a plausible range", () => {
    for (const size of ["1", "0", "-4", "201", "abc"]) {
      const result = validateGroupEnquiry(form({ ...valid, "group-size": size }));
      assert.equal(result.ok, false, `accepted party size ${size}`);
    }
  });
});

describe("validateWaitlist", () => {
  it("accepts an email and records the source", () => {
    const result = validateWaitlist(form({ email: "a@example.com", source: "leagues-page" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.source, "leagues-page");
  });

  it("defaults an absent source rather than dropping attribution", () => {
    const result = validateWaitlist(form({ email: "a@example.com" }));
    if (result.ok) assert.equal(result.value.source, "unknown");
  });

  it("rejects an invalid email", () => {
    assert.equal(validateWaitlist(form({ email: "nope" })).ok, false);
  });
});

describe("validateBookingRequest", () => {
  const POLICY = "2026-07-01";
  const valid = {
    slotId: "2026-08-06T18:00",
    partySize: "2",
    name: "Ngozi Eze",
    email: "ngozi@example.com",
    phone: "08099998888",
    ageConfirmed: "yes",
    policyVersion: POLICY,
  };

  it("accepts a complete booking", () => {
    const result = validateBookingRequest(form(valid), POLICY);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.partySize, 2);
  });

  it("requires an explicit age confirmation", () => {
    const result = validateBookingRequest(
      form({ ...valid, ageConfirmed: "" }),
      POLICY,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.ageConfirmed);
  });

  it("does not accept any value other than an explicit yes", () => {
    const result = validateBookingRequest(
      form({ ...valid, ageConfirmed: "maybe" }),
      POLICY,
    );
    assert.equal(result.ok, false);
  });

  it("rejects a stale refund-policy version", () => {
    /* The visitor agreed to terms that are no longer in force. §9 requires the
       terms in force to appear before payment, so they must re-read them. */
    const result = validateBookingRequest(form(valid), "2026-09-01");
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.policyVersion);
  });

  it("rejects a missing policy version", () => {
    const data = form(valid);
    data.delete("policyVersion");
    assert.equal(validateBookingRequest(data, POLICY).ok, false);
  });

  it("caps party size at twelve", () => {
    assert.equal(validateBookingRequest(form({ ...valid, partySize: "13" }), POLICY).ok, false);
    assert.equal(validateBookingRequest(form({ ...valid, partySize: "12" }), POLICY).ok, true);
  });

  it("requires a slot", () => {
    const result = validateBookingRequest(form({ ...valid, slotId: "" }), POLICY);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.slotId);
  });

  it("never returns party names, even if they are posted", () => {
    /* Collecting who attends, against a date and a time, builds the dataset the
       Brief identifies as the site's core risk. */
    const data = form({ ...valid, partyNames: "Ada, Chidi, Ngozi" });
    const result = validateBookingRequest(data, POLICY);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(!("partyNames" in result.value));
      assert.equal(
        JSON.stringify(result.value).includes("Chidi"),
        false,
        "party names leaked into the validated value",
      );
    }
  });
});

describe("isHoneypotTripped", () => {
  it("is not tripped by an empty field", () => {
    assert.equal(isHoneypotTripped(form({ website: "" }), "website"), false);
  });

  it("is not tripped by an absent field", () => {
    assert.equal(isHoneypotTripped(form({}), "website"), false);
  });

  it("is tripped when a bot fills it", () => {
    assert.equal(isHoneypotTripped(form({ website: "http://spam" }), "website"), true);
  });

  it("is not tripped by whitespace alone", () => {
    assert.equal(isHoneypotTripped(form({ website: "   " }), "website"), false);
  });
});

describe("normalisePhone", () => {
  it("strips formatting", () => {
    assert.equal(normalisePhone("+234 (801) 234-5678"), "+2348012345678");
  });

  it("keeps a local format intact", () => {
    assert.equal(normalisePhone("0801 234 5678"), "08012345678");
  });

  it("keeps only a leading plus", () => {
    assert.equal(normalisePhone("+234+801"), "+234801");
  });
});
