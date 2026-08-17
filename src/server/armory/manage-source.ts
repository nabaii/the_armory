import { cookies } from "next/headers";
import { getArmoryDb } from "@/db/armory/client";
import type { StaffPrincipal } from "./grants";
import * as demo from "./manage-demo";
import * as live from "./manage-reads";

/**
 * REAL OR DEMONSTRATION — one resolver, and every screen goes through it.
 *
 * ===========================================================================
 * WHY THE CHOICE IS MADE HERE AND NOWHERE ELSE
 *
 * The alternative was `if (demo) …` in each page, which fails in a specific and
 * dangerous way: the twelfth screen forgets, renders real data under a banner
 * saying DEMONSTRATION, and teaches whoever is watching that the banner means
 * nothing. After that the banner is decoration and the safeguard is gone.
 *
 * So there is one place that decides, it decides once per request, and a screen
 * cannot reach a reader without passing through it. `ManageSource` below is the
 * only object the pages hold, and it has no `db` on it — a page that wanted to
 * run its own query would have to import the client itself, which is visible in
 * review in a way a missing conditional is not.
 *
 * ===========================================================================
 * FOUNDER ONLY, AND THE COOKIE IS NOT THE AUTHORITY
 *
 * Founder's decision, 17 August 2026. The cookie records an INTENTION; the
 * `grants` capability decides whether it is honoured, re-checked on every
 * request. So a founder who hands their laptop to a duty manager does not hand
 * over demonstration mode, and a cookie somebody sets by hand buys nothing —
 * the same reasoning `session-hint.ts` gives about the signed-in cookie being
 * forgeable and worthless.
 *
 * It is deliberately NOT stored on the staff record. A preference that outlived
 * the browser session would be a founder who forgot they left it on, reading
 * invented figures in a board meeting. A cookie dies with the browser.
 */

/** The cookie is a flag, carries no identity, and is never read on a public route. */
export const DEMO_COOKIE = "armory_manage_demo";

/**
 * Whether this request should be served demonstration data.
 *
 * Two conditions, and both are checked every time: the viewer asked for it, and
 * the viewer is allowed to ask.
 */
export async function demoRequested(principal: StaffPrincipal): Promise<boolean> {
  /* The capability first. Cheaper than the cookie read and it is the half that
     matters — a request that fails this is not entitled to demonstration mode
     however the cookie is set. */
  if (!principal.grants.has("grants")) return false;

  const jar = await cookies();
  return jar.get(DEMO_COOKIE)?.value === "1";
}

/**
 * Everything a management screen may read.
 *
 * Deliberately a set of thunks rather than pre-fetched data: THE DAY renders two
 * panels for front of house and twelve for the founder, and §14 warns that an
 * unguarded management query is an availability risk against the desk. A source
 * that eagerly fetched all of this would put the roster, the ledger and a
 * quarter of visits through Postgres to render two squares on a phone.
 */
export type ManageSource = {
  readonly demo: boolean;
  readonly roster: () => Promise<live.RosterRow[]>;
  readonly applications: (now: Date) => Promise<live.ApplicationRow[]>;
  readonly arrivals: (now: Date) => Promise<live.ArrivalRow[]>;
  readonly expiries: (
    now: Date,
    withinDays?: number,
  ) => Promise<live.ExpiryRow[]>;
  readonly person: (personId: string) => Promise<live.PersonRecord | null>;
  readonly charges: (since: Date) => Promise<live.RevenueChargeRow[]>;
  readonly balances: (now: Date) => Promise<live.BalanceRow[]>;
  readonly failedPayments: (since: Date) => Promise<live.FailedPaymentRow[]>;
  readonly levelHistory: (since: Date) => Promise<live.LevelEvent[]>;
  readonly nearMisses: (since: Date) => Promise<live.NearMissRow[]>;
  readonly visitEvidence: (since: Date) => Promise<{
    visits: live.VisitEvidenceRow[];
    service: live.ServiceEvidenceRow[];
  }>;
  readonly checkInDurations: (since: Date) => Promise<number[]>;
  /**
   * The operating level.
   *
   * Demonstration mode reports the club at `normal` rather than inventing a
   * degradation, and that is deliberate: this is the one value on the surface
   * that a staff member might ACT on — telling members the range is shut — and a
   * demonstration that fabricated it could send somebody home. The history is
   * invented freely, because a history is read rather than acted upon.
   */
  readonly currentLevel: () => Promise<live.OperatingLevelValue>;
};

export function sourceFor(useDemo: boolean): ManageSource {
  if (useDemo) {
    return {
      demo: true,
      roster: async () => demo.demoRoster(),
      applications: async (now) => demo.demoApplications(now),
      arrivals: async (now) => demo.demoArrivals(now),
      expiries: async (now, withinDays) =>
        demo
          .demoExpiries(now)
          .filter((row) => row.daysRemaining <= (withinDays ?? 60)),
      person: async (personId) => demo.demoPerson(personId),
      charges: async (since) =>
        demo.demoCharges(new Date()).filter((row) => row.raisedAt >= since),
      balances: async (now) => demo.demoBalances(now),
      failedPayments: async () => demo.demoFailedPayments(new Date()),
      levelHistory: async (since) =>
        demo.demoLevelHistory(new Date()).filter((row) => row.at >= since),
      nearMisses: async (since) =>
        demo.demoNearMisses(new Date()).filter((row) => row.reportedAt >= since),
      visitEvidence: async (since) => {
        const evidence = demo.demoVisitEvidence(new Date());
        return {
          visits: evidence.visits.filter((row) => row.at >= since),
          service: evidence.service.filter((row) => row.at >= since),
        };
      },
      checkInDurations: async () => demo.demoCheckInDurations(),
      currentLevel: async () => "normal",
    };
  }

  const db = getArmoryDb();

  return {
    demo: false,
    roster: () => live.roster(db),
    applications: (now) => live.applicationsQueue(db, { now }),
    arrivals: (now) => live.expectedArrivals(db, { now }),
    expiries: (now, withinDays) => live.expiryRegister(db, { now, withinDays }),
    person: (personId) => live.personRecord(db, personId),
    charges: (since) => live.chargesSince(db, { since }),
    balances: (now) => live.balances(db, { now }),
    failedPayments: (since) => live.failedPayments(db, { since }),
    levelHistory: (since) => live.levelHistory(db, { since }),
    nearMisses: (since) => live.nearMisses(db, { since }),
    visitEvidence: (since) => live.visitEvidence(db, { since }),
    checkInDurations: (since) => live.checkInDurations(db, { since }),
    currentLevel: () => live.currentLevel(db),
  };
}

/** The one call a page makes. Resolves the viewer's entitlement and their wish. */
export async function manageSource(
  principal: StaffPrincipal,
): Promise<ManageSource> {
  return sourceFor(await demoRequested(principal));
}
