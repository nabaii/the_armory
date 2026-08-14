/**
 * VOLUME AND BUDGET — §2, §2.1, §6.4, §11 M10.
 *
 *   npm run volume
 *
 *   §2.1: "Staging must hold realistic seed data — A HUNDRED MEMBERS, a full
 *    tier matrix, several hundred sessions, a populated firearm register —
 *    because MOST DEFECTS IN THIS SYSTEM ONLY APPEAR AT VOLUME or at a period
 *    boundary."
 *   §6.4: the Today screen "renders in under one second from cold, with no
 *    network".
 *   §11 M10: "Security review, LOAD and period-boundary testing…"
 *
 * The period-boundary half of that is src/domain/period-boundary.test.ts. This
 * is the load half.
 *
 * ===========================================================================
 * WHAT THIS MEASURES, AND WHAT IT CANNOT
 *
 * It measures the DECISIONS: hydrating a hundred-member day pack, building a
 * Subject for every arrival, and evaluating the capabilities the Today screen
 * needs — the work §6.4's one second has to contain besides painting.
 *
 * It cannot measure §6.4's actual criterion, and nobody should read it as
 * though it did. §12 is explicit: the render is measured "on the actual tablet
 * model being purchased", and this runs on a developer machine in Node with no
 * browser, no IndexedDB, no service worker and no paint. A pass here is a
 * necessary condition and not the acceptance test.
 *
 * What it IS good for is the thing §2.1 names: a change that turns a linear
 * pass into a quadratic one is invisible against a fixture of six people and
 * obvious here. The day pack is indexed on load precisely because of that, and
 * this is what keeps the index honest.
 *
 * ===========================================================================
 * NO DATABASE
 *
 * The fixture is generated in memory, at §2.1's stated size, so this runs in CI
 * with no credentials and no staging. `npm run db:seed` is the other half — it
 * puts the same volume in Postgres so a milestone can be DEMONSTRATED against
 * it, which is what §12 asks for.
 */

import { performance } from "node:perf_hooks";
import { evaluate } from "../src/domain/capability";
import { hydrate, subjectFor, type DayPack } from "../src/offline/daypack";
import { todayRows } from "../src/offline/today";
import { lagosDateKey } from "../src/lib/time";

/* §2.1's stated volume. Not a round number chosen for convenience. */
const MEMBERS = 100;
const GUESTS = 60;
const FIREARMS = 40;
const LANES = 14;
const ARRIVALS = 60;

/**
 * The budgets.
 *
 * §6.4 gives the whole cold render one second on the tablet. These are the
 * decision layer's share of it, set deliberately low — the paint, the IndexedDB
 * read and the framework all have to fit in the same second, so anything here
 * approaching a hundred milliseconds has already taken more than its share.
 */
const BUDGET_MS = {
  hydrate: 50,
  todayRows: 100,
  subjectPerPerson: 1,
};

const DAY = 86_400_000;
const now = new Date();

const id = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(8, "0")}-0000-7000-8000-000000000000`.slice(0, 36);

function fixture(): DayPack {
  const people = Array.from({ length: MEMBERS + GUESTS }, (_, i) => ({
    id: id("a", i),
    firstName: `First${i}`,
    lastName: `Last${i}`,
    photoUrl: null,
  }));

  const tiers = Array.from({ length: 6 }, (_, i) => ({
    id: id("b", i),
    name: `Tier ${i}`,
    canHost: i < 4,
    guestAllowanceAnnual: 12 - i * 2,
    guestConcurrentMax: 3 - (i % 3),
    canOwnFirearm: i < 3,
    canStoreFirearm: i === 0,
    disciplineAccess: ["10m-air-rifle", "25m-pistol", "50m-range"].slice(0, (i % 3) + 1),
    bookingHorizonDays: 60 - i * 8,
    concurrentBookingsMax: 4 - (i % 4),
    active: true,
  }));

  const memberships = Array.from({ length: MEMBERS }, (_, i) => ({
    id: id("c", i),
    personId: people[i].id,
    tierId: tiers[i % tiers.length].id,
    memberNumber: i + 1,
    status: (i < 80 ? "active" : i < 90 ? "lapsed" : "suspended") as
      | "active"
      | "lapsed"
      | "suspended",
    endedOn: i >= 80 ? lagosDateKey(new Date(now.getTime() - 5 * DAY)) : null,
    renewsOn: i < 80 ? lagosDateKey(new Date(now.getTime() + 90 * DAY)) : null,
  }));

  return {
    pulledAt: now.toISOString(),
    windowStart: lagosDateKey(now),
    windowEnd: lagosDateKey(new Date(now.getTime() + DAY)),
    activeWaiverVersionId: "waiver-active",
    activeWaiverVersion: "2026.1",
    activeWaiverBody: "You accept that a live range is dangerous.",
    waiverValidityDays: null,
    storageEnabled: false,
    disciplinesRequiringQualification: ["25m-pistol"],
    tiers,
    people,
    memberships,
    /* Every third member has a licence, a third of those expiring inside the
       window — so the evaluator does real date work rather than short-circuiting
       on an empty array. */
    licences: memberships
      .filter((_, i) => i % 3 === 0)
      .map((membership, i) => ({
        id: id("d", i),
        personId: membership.personId,
        status: "verified" as const,
        calibres: [".22 LR", "9mm"],
        expiresOn: lagosDateKey(new Date(now.getTime() + (i % 3 === 0 ? 5 : 400) * DAY)),
      })),
    qualifications: memberships
      .filter((_, i) => i % 4 === 0)
      .map((membership) => ({
        personId: membership.personId,
        discipline: "25m-pistol",
        level: "club",
        expiresAt: new Date(now.getTime() + 200 * DAY).toISOString(),
      })),
    waiverSignatures: people.map((person) => ({
      personId: person.id,
      waiverVersionId: "waiver-active",
      signedAt: new Date(now.getTime() - 30 * DAY).toISOString(),
    })),
    allowances: memberships.map((membership, i) => ({
      membershipId: membership.id,
      includedQuota: 6,
      usedCount: i % 8,
      overagePriceLabel: "₦15,000",
    })),
    invitations: Array.from({ length: GUESTS }, (_, i) => ({
      id: id("e", i),
      hostMembershipId: memberships[i % MEMBERS].id,
      hostPersonId: people[i % MEMBERS].id,
      guestPersonId: people[MEMBERS + i].id,
      bookingId: null,
      status: "completed" as const,
      expiresAt: new Date(now.getTime() + DAY).toISOString(),
      isChargeable: i % 5 === 0,
    })),
    arrivals: Array.from({ length: ARRIVALS }, (_, i) => {
      const isGuest = i % 3 === 2;
      return {
        personId: isGuest ? people[MEMBERS + i].id : people[i].id,
        bookingId: id("f", i),
        sessionId: id("g", 0),
        role: (isGuest ? "guest_shooter" : "member_shooter") as
          | "guest_shooter"
          | "member_shooter",
        discipline: "25m-pistol",
        slotStart: new Date(now.getTime() + (i % 8) * 3_600_000).toISOString(),
        hostPersonId: isGuest ? people[i % MEMBERS].id : null,
        invitationId: isGuest ? id("e", i) : null,
      };
    }),
    participations: [],
    firearms: Array.from({ length: FIREARMS }, (_, i) => ({
      id: id("h", i),
      serialNumber: `SN-${1000 + i}`,
      make: "Walther",
      model: "GSP",
      calibre: i % 2 === 0 ? ".22 LR" : "9mm",
      ownership: (i % 4 === 0 ? "member" : "club") as "member" | "club",
      ownerPersonId: i % 4 === 0 ? people[i].id : null,
      status: "in_service" as const,
    })),
    ammunitionLots: Array.from({ length: 8 }, (_, i) => ({
      id: id("i", i),
      calibre: i % 2 === 0 ? ".22 LR" : "9mm",
      quantityRemaining: 500 - i * 20,
    })),
    lanes: Array.from({ length: LANES }, (_, i) => ({
      id: id("j", i),
      discipline: ["10m-air-rifle", "25m-pistol", "50m-range"][i % 3],
      number: i + 1,
      status: (i === 3 ? "maintenance" : "available") as "maintenance" | "available",
      positionCapacity: 1,
    })),
    staff: Array.from({ length: 6 }, (_, i) => ({
      id: id("k", i),
      personId: people[i].id,
      displayName: `Officer ${i}`,
      role: (i === 0 ? "founder" : "range_officer") as "founder" | "range_officer",
      active: true,
    })),
    devices: [
      { id: id("l", 0), label: "Desk", surface: "desk" as const, revoked: false },
      { id: id("l", 1), label: "Lane", surface: "lane" as const, revoked: false },
    ],
  };
}

/** Run `body` a few times and report the best. Best, not mean — see below. */
function measure(label: string, runs: number, body: () => void): number {
  /* One warm-up, discarded. The first run pays for JIT compilation and lazy
     module initialisation, neither of which the tablet pays on every render. */
  body();

  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    body();
    best = Math.min(best, performance.now() - started);
  }

  /* Best rather than mean, deliberately. This is a budget check, and the
     question is whether the work CAN fit — a mean on a machine also running a
     browser and a test watcher measures the machine, not the code. A regression
     that matters moves the best case too. */
  console.log(`  ${best.toFixed(2).padStart(8)} ms  ${label}`);
  return best;
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function main(): void {
  console.log(`\n${bold("Volume — §2.1's fixture, §6.4's budget")}`);
  console.log(
    dim(
      `  ${MEMBERS} members · ${GUESTS} guests · ${ARRIVALS} arrivals · ` +
        `${FIREARMS} firearms · ${LANES} lanes\n`,
    ),
  );

  const pack = fixture();
  let failed = false;

  /**
   * Prove the fixture does work before timing it.
   *
   * The failure mode of a benchmark is not being slow — it is measuring
   * nothing. `todayRows` filters arrivals to one Lagos date, and a fixture
   * whose slots fell outside the window would return an empty array in
   * microseconds and pass every budget below for the rest of the project's
   * life. So the counts are asserted first, loudly, and the timings are only
   * meaningful because of these four lines.
   */
  const sample = hydrate(pack);
  const sampleRows = todayRows(
    sample,
    lagosDateKey(now),
    now,
    new Set(),
    new Map(),
  );

  if (sampleRows.length === 0 || sample.personById.size !== MEMBERS + GUESTS) {
    console.log(
      red(
        `  FAIL  the fixture produced ${sampleRows.length} Today rows from ` +
          `${sample.personById.size} people — there is nothing here to measure.`,
      ),
    );
    process.exit(1);
  }

  console.log(
    dim(`  ${sampleRows.length} Today rows from the fixture — measuring real work.\n`),
  );

  const check = (label: string, measured: number, budget: number) => {
    if (measured <= budget) {
      console.log(`  ${green("PASS")}  ${label} ${dim(`(budget ${budget} ms)`)}`);
    } else {
      failed = true;
      console.log(`  ${red("FAIL")}  ${label} ${red(`— budget ${budget} ms`)}`);
    }
  };

  const hydrateMs = measure("hydrate + index the day pack", 20, () => {
    hydrate(pack);
  });

  const indexed = hydrate(pack);

  const subjectsMs = measure(
    `build a Subject for all ${MEMBERS + GUESTS} people`,
    20,
    () => {
      for (const person of pack.people) subjectFor(indexed, person.id);
    },
  );

  const rowsMs = measure(
    `todayRows for ${ARRIVALS} arrivals (the §6.4 screen)`,
    20,
    () => {
      todayRows(indexed, lagosDateKey(now), now, new Set(), new Map());
    },
  );

  measure("evaluate MAY_ATTEND for every member", 20, () => {
    for (const membership of pack.memberships) {
      const subject = subjectFor(indexed, membership.personId);
      if (!subject) continue;
      evaluate(subject, {
        capability: "MAY_ATTEND",
        now,
        activeWaiverVersionId: pack.activeWaiverVersionId,
        waiverValidityDays: pack.waiverValidityDays,
      });
    }
  });

  console.log("");
  check("day pack hydrate", hydrateMs, BUDGET_MS.hydrate);
  check("Today rows", rowsMs, BUDGET_MS.todayRows);
  check(
    "Subject per person",
    subjectsMs / (MEMBERS + GUESTS),
    BUDGET_MS.subjectPerPerson,
  );

  console.log(
    dim(
      "\n  Necessary, not sufficient. §12 measures the render on the actual\n" +
        "  tablet model being purchased, with no network, from cold.\n",
    ),
  );

  if (failed) process.exit(1);
}

main();
