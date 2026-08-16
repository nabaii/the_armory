import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activePortalHref,
  guestNav,
  isAppNavActive,
  isPortalRoute,
  memberNav,
  portalNav,
} from "./app-nav";
import { routes } from "./site";

/**
 * Members Portal §5 — the navigation architecture.
 *
 * These read like trivia and they are not. The active-tab rule is the one piece
 * of the shell that cannot be checked by looking at it: it is correct on the
 * four screens anybody opens while building, and wrong on the fifth.
 */

describe("the three sets share their shape", () => {
  it("occupies the same five slots", () => {
    /* The signed-in state resolves on the client, so the bar renders one set
       and swaps. Because the shape is fixed, the swap changes labels and
       destinations and moves nothing — no reflow, no tab sliding out from under
       a thumb already on its way down. */
    assert.equal(guestNav.length, 5);
    assert.equal(memberNav.length, 5);
    assert.equal(portalNav.length, 5);
  });

  it("keeps the accent in slot five", () => {
    /* §4.2: APPLY becomes BOOK. Same position, same red, same promise that the
       club's one most valuable action is under the thumb on every screen. */
    assert.equal(guestNav[4].accent, true);
    assert.equal(portalNav[4].accent, true);
    assert.equal(portalNav[4].href, routes.portalBookNew);
  });

  it("never hides the red action", () => {
    /* §5.1: "a tab that vanishes and reappears teaches a member that the
       application is unreliable". The list is constant — no conditional in it,
       and there must not be one. This asserts the shape of the module, which is
       the only way to state that rule as a test. */
    assert.ok(portalNav.every((item) => typeof item.href === "string"));
  });
});

describe("which surface a path belongs to", () => {
  it("recognises the members app", () => {
    assert.equal(isPortalRoute("/portal"), true);
    assert.equal(isPortalRoute("/portal/book/new"), true);
  });

  it("does not claim a path that merely begins with the same letters", () => {
    /* `/portalis` is not a route today. It is asserted anyway because the
       cheap version of this test — `startsWith("/portal")` — passes it wrongly,
       and the day somebody adds a page it would silently put the marketing nav
       behind a members screen or the reverse. */
    assert.equal(isPortalRoute("/portalis"), false);
    assert.equal(isPortalRoute("/"), false);
  });
});

describe("the active tab is the most specific owner", () => {
  it("lights TODAY only on Today", () => {
    /* Every portal route begins with /portal, so a subtree match would light
       Today on every screen in the application. */
    assert.equal(activePortalHref(routes.portal), routes.portal);
    assert.equal(activePortalHref(routes.portalShooting), routes.portalShooting);
  });

  it("gives /portal/book/new to BOOK, not to DIARY", () => {
    /* The two genuinely overlap — the flow lives inside the Diary's path — and
       the member reads the more specific one as where they are. */
    assert.equal(activePortalHref(routes.portalBookNew), routes.portalBookNew);
    assert.equal(activePortalHref(routes.portalBook), routes.portalBook);
  });

  it("keeps DIARY lit on a booking's own page", () => {
    assert.equal(activePortalHref("/portal/book/abc-123"), routes.portalBook);
  });

  it("keeps COMPETE lit inside leagues", () => {
    /* §5 gives Compete two territories — /shooting and /leagues/* — which no
       prefix rule could have joined, since neither contains the other. */
    assert.equal(activePortalHref("/portal/leagues/new"), routes.portalShooting);
    assert.equal(activePortalHref("/portal/leagues/abc"), routes.portalShooting);
  });

  it("lights nothing on a portal route no tab owns", () => {
    assert.equal(activePortalHref(routes.portalPassword), null);
  });
});

describe("the public bar is unchanged", () => {
  it("still matches home exactly and everything else by subtree", () => {
    assert.equal(isAppNavActive("/", routes.home), true);
    assert.equal(isAppNavActive("/ranges", routes.home), false);
    assert.equal(isAppNavActive("/portal/leagues/new", routes.portal), true);
  });
});
