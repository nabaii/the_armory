/**
 * Session helpers.
 *
 * `safeReturnTo` is the one with teeth: an open redirect on a sign-in flow is a
 * phishing primitive. An attacker who can control `?next=` sends a GENUINE
 * sign-in link, from the club's real domain, with real DKIM — and the member
 * lands somewhere else entirely after authenticating. The trust comes from the
 * club; the destination comes from the attacker.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeReturnTo, shouldRefresh } from "./session";
import { SESSION_TTL_MS } from "./tokens";
import { routes } from "@/lib/site";

describe("safeReturnTo", () => {
  it("allows a relative path", () => {
    assert.equal(safeReturnTo("/portal"), "/portal");
    assert.equal(safeReturnTo("/leagues/joined"), "/leagues/joined");
  });

  it("preserves a query string on a relative path", () => {
    assert.equal(safeReturnTo("/portal?tab=leagues"), "/portal?tab=leagues");
  });

  it("falls back to the portal when absent", () => {
    assert.equal(safeReturnTo(undefined), routes.portal);
    assert.equal(safeReturnTo(null), routes.portal);
    assert.equal(safeReturnTo(""), routes.portal);
  });

  /* ------------------------------------------------------- OPEN REDIRECTS */

  it("rejects an absolute URL", () => {
    assert.equal(safeReturnTo("https://evil.example/harvest"), routes.portal);
    assert.equal(safeReturnTo("http://evil.example"), routes.portal);
  });

  it("rejects a protocol-relative URL", () => {
    // `//evil.example` is a URL, not a path — the browser treats it as
    // https://evil.example. The single most missed open-redirect case.
    assert.equal(safeReturnTo("//evil.example"), routes.portal);
    assert.equal(safeReturnTo("//evil.example/portal"), routes.portal);
  });

  it("rejects a backslash-smuggled URL", () => {
    // Some browsers normalise `/\` to `//`, which is protocol-relative again.
    assert.equal(safeReturnTo("/\\evil.example"), routes.portal);
  });

  it("rejects a scheme-relative or javascript URL", () => {
    assert.equal(safeReturnTo("javascript:alert(1)"), routes.portal);
    assert.equal(safeReturnTo("data:text/html,x"), routes.portal);
  });

  it("rejects anything not starting with a single slash", () => {
    for (const input of ["portal", "../portal", "evil.example/portal"]) {
      assert.equal(safeReturnTo(input), routes.portal, `accepted ${input}`);
    }
  });
});

describe("shouldRefresh", () => {
  const now = new Date("2026-08-05T10:00:00.000Z");

  it("does not refresh a session in its first half", () => {
    // Refreshing on every request would add a database write to every
    // authenticated page load — the latency Phase 1 spent effort avoiding.
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS * 0.9);
    assert.equal(shouldRefresh(expiresAt, now), false);
  });

  it("refreshes once past halfway", () => {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS * 0.4);
    assert.equal(shouldRefresh(expiresAt, now), true);
  });

  it("refreshes a session that is nearly expired", () => {
    const expiresAt = new Date(now.getTime() + 1000);
    assert.equal(shouldRefresh(expiresAt, now), true);
  });

  it("refreshes an already-expired session", () => {
    // findSession() rejects expired sessions anyway, so this only guards the
    // boundary rather than being reachable in practice.
    const expiresAt = new Date(now.getTime() - 1000);
    assert.equal(shouldRefresh(expiresAt, now), true);
  });
});
