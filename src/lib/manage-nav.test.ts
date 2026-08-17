import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { grantsForRole } from "@/domain/grants";
import { activeManageSurface, manageNavFor } from "./manage-nav";
import { routes } from "./site";

/**
 * Management System §5, §5.2, §14.
 *
 * "Navigation is the org chart… The navigation is generated from the capability
 *  service — the same authority that decides whether a member may host decides
 *  which surfaces a staff member sees."
 */

const navFor = (role: Parameters<typeof grantsForRole>[0]) =>
  manageNavFor({ role, grants: new Set(grantsForRole(role)) });

describe("the bar is the org chart — §5.2", () => {
  it("gives front of house two destinations", () => {
    assert.deepEqual(
      navFor("front_of_house").map((item) => item.label),
      ["Today", "People"],
    );
  });

  it("gives the duty manager four, which still fits a thumb", () => {
    assert.equal(navFor("duty_manager").length, 4);
  });

  it("gives the founder all six, on the rail", () => {
    assert.equal(navFor("founder").length, 6);
  });

  it("never shows the armourer the ledger — S3", () => {
    /* Not hidden. Refused: the grant is not held, so the surface is not in the
       generated list, and typing the path is separately refused by the page. */
    assert.ok(!navFor("armourer").some((item) => item.surface === "ledger"));
  });

  it("keeps one person's own bar in a fixed order between screens", () => {
    /* The bar differs BETWEEN people by design — that is the mechanism. What
       must not move is one person's own, or they learn to distrust it. */
    assert.deepEqual(
      navFor("duty_manager").map((item) => item.surface),
      ["day", "diary", "people", "safety"],
    );
  });
});

describe("which surface a path belongs to", () => {
  it("lights Today only on Today", () => {
    /* Every management route begins with /manage, so a prefix test on THE DAY's
       own href would light it on every screen in the application. */
    assert.equal(activeManageSurface(routes.manage), "day");
    assert.equal(activeManageSurface(routes.managePeople), "people");
  });

  it("lights the owner of a nested path", () => {
    assert.equal(
      activeManageSurface(routes.managePerson("11111111-1111-4111-8111-111111111111")),
      "people",
    );
  });

  it("lights nothing on a path no surface owns", () => {
    assert.equal(activeManageSurface("/manage/settings"), null);
  });
});

/**
 * §14: "Never cached, never indexed, as /portal already is."
 *
 * A source assertion rather than a behavioural one, because the failure it
 * guards against is a future route group forgetting — and a service worker
 * cache lives on the device and outlives sign-out, since clearing a cookie does
 * not clear the Cache API. Phones are shared, lent and lost, and this surface
 * carries more personal data than any other in the product.
 */
describe("management is never written to a cache — §14", () => {
  it("is in the service worker's NEVER_CACHE list", () => {
    const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    const list = worker.match(/const NEVER_CACHE = \[([^\]]*)\]/)?.[1] ?? "";
    assert.ok(list.includes('"/manage"'), "NEVER_CACHE must include /manage");
  });
});
