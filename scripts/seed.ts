/**
 * STAGING SEED — §2.1, §12.
 *
 *   §2.1: "Staging must hold realistic seed data — a hundred members, a full tier
 *          matrix, several hundred sessions, a populated firearm register — because
 *          most defects in this system only appear at volume or at a period
 *          boundary."
 *   §12:  "Seed data at realistic volume exists on staging and the milestone has been
 *          demonstrated against it."
 *
 * §12 makes this a definition-of-done item for every milestone, not a convenience.
 * Two of its clauses are the reason this script is as long as it is.
 *
 * ============================================================================
 * "AT VOLUME"
 *
 * A hundred members is not decoration. The desk's Today screen evaluates several
 * capabilities per arrival and §6.4 gives the whole render one second from cold; the
 * day pack is indexed once on load precisely because doing that against arrays with
 * `.find()` inside a loop is quadratic. None of that is observable against a fixture
 * of six people, and a one-second budget that has only ever been measured against
 * six people is not a measurement.
 *
 * ============================================================================
 * "AT A PERIOD BOUNDARY"
 *
 * The more valuable half, and the part a random generator will not produce by
 * accident. Every date below that could sit near an edge is put ON one: licences
 * expiring yesterday, today, in seven days and in sixty; a membership renewing today;
 * an allowance period ending today; a waiver superseded yesterday so that signatures
 * against it are stale. §12.1's named scenarios — "Member licence expired yesterday",
 * "Allowance exhausted mid-booking" — exist in this data on purpose rather than by
 * chance.
 *
 * ============================================================================
 * WHY EVERY ID IS DETERMINISTIC
 *
 * This script is idempotent, and it has to be, because it CANNOT clean up after
 * itself. Migration 0002 puts `reject_mutation` and `reject_truncate` triggers on
 * every append-only table — custody_events, waiver_signatures, rounds,
 * participations, ammunition_issues, audit_log. Those rows cannot be deleted or
 * truncated, by anybody, ever. That is §1.2 rule 3 working as designed, and it means
 * a seed that generated fresh ids on each run would accumulate a second and third
 * copy of the club's history with no way to remove them.
 *
 * So ids come from a seeded PRNG and every insert is `ON CONFLICT DO NOTHING`. Run it
 * twice and the second run changes nothing. Change SEED and you get a different club.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY LEFT BLANK
 *
 * Tier names and fees. §14 lists them as outstanding — "seed data only, the matrix can
 * be built without them" — and src/lib/content-gate.ts states the house rule for
 * exactly this situation: "a missing value must LOOK missing. Plausible placeholder
 * content is how a site ships with an invented phone number."
 *
 * So the tiers below are named "Tier A" through "Tier F" and their fees are NULL. The
 * permission matrix is real and fully varied, because that is what code reads; the
 * commercial names are visibly absent, because a founder demoing staging must not see
 * "Marksman — ₦450,000/year" and assume somebody decided that.
 *
 * Usage:  DATABASE_URL=... npm run db:seed
 */

import type { InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getArmoryDb, schema } from "@/db/armory/client";
import { hashPin } from "@/server/armory/staff-session";

/* ---------------------------------------------------------------------------
   DETERMINISM
   -------------------------------------------------------------------------- */

/** Change this to generate a different club. Keep it stable to keep the fixture stable. */
const SEED = 20260812;

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Not cryptographic and does not need to be: it generates test people, not
 * credentials. The device tokens at the bottom are the one exception and use
 * `crypto.getRandomValues`.
 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(SEED);

const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number): number =>
  min + Math.floor(rand() * (max - min + 1));

/**
 * A deterministic UUIDv7.
 *
 * v7 rather than v4 because the whole system depends on it: §2 requires UUIDv7 for
 * all primary keys, and the outbox sorts its queue lexicographically by id and relies
 * on that being creation order. Seed data with v4 ids would sort at random against
 * records the desk creates later, so a seeded participation could sort after a round
 * that references it.
 *
 * Layout per RFC 9562: 48-bit big-endian millisecond timestamp, version 7, then
 * random bits. The timestamp is supplied rather than read from the clock so that a
 * seeded firearm's custody history sorts into the order it is written in.
 */
let idCounter = 0;
function uuidv7At(ms: number): string {
  const bytes = new Uint8Array(16);

  /* A monotonic tie-break, so two ids minted in the same millisecond still order. */
  const stamp = ms + (idCounter++ % 1000);

  bytes[0] = (stamp / 2 ** 40) & 0xff;
  bytes[1] = (stamp / 2 ** 32) & 0xff;
  bytes[2] = (stamp / 2 ** 24) & 0xff;
  bytes[3] = (stamp / 2 ** 16) & 0xff;
  bytes[4] = (stamp / 2 ** 8) & 0xff;
  bytes[5] = stamp & 0xff;

  for (let i = 6; i < 16; i += 1) bytes[i] = Math.floor(rand() * 256);

  bytes[6] = 0x70 | (bytes[6] & 0x0f); /* version 7 */
  bytes[8] = 0x80 | (bytes[8] & 0x3f); /* variant 10 */

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ---------------------------------------------------------------------------
   DATES — anchored, not relative to "now"

   `TODAY` is the anchor everything is measured from, and it is the real current date
   because the whole point of the boundary cases is that they sit against the clock the
   desk will be read with. Re-running on a later date moves the boundaries with it,
   which is correct: a licence seeded as "expires in 7 days" should still expire in 7
   days when somebody demos this next month.
   -------------------------------------------------------------------------- */

const DAY = 86_400_000;
const now = new Date();
const midnight = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);

const dayOffset = (days: number): Date => new Date(midnight.getTime() + days * DAY);
/**
 * A `YYYY-MM-DD` calendar date.
 *
 * Drizzle's `date()` columns bind strings; its `timestamp()` columns bind Date objects
 * directly. So there is no ISO-string helper here any more — a timestamptz value is
 * just the Date, which is one fewer place for an offset to be lost.
 */
const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/* Lagos is UTC+1 and has no DST, so a local hour is a fixed offset (§2). */
const atHour = (d: Date, hour: number): Date =>
  new Date(d.getTime() + (hour - 1) * 3_600_000);

/* ---------------------------------------------------------------------------
   NAMES

   Nigerian names, because name LENGTH is a layout input: §6.4 renders a name, a
   subtitle and a status in one row on a tablet, and a fixture full of "Test User 4"
   will not reveal the row that wraps.
   -------------------------------------------------------------------------- */

const FIRST = [
  "Adaeze", "Bode", "Chidi", "Damilola", "Ebere", "Folake", "Gbenga", "Halima",
  "Ifeoma", "Jide", "Kemi", "Lanre", "Maryam", "Nnamdi", "Obiageli", "Peter",
  "Ruqayyah", "Segun", "Tunde", "Uche", "Victor", "Wale", "Yemi", "Zainab",
  "Amaka", "Bashir", "Chinedu", "Dayo", "Emeka", "Fatima",
] as const;

const LAST = [
  "Adeyemi", "Balogun", "Chukwu", "Danjuma", "Eze", "Fashola", "Garba",
  "Ibrahim", "Jibrin", "Kalu", "Lawal", "Mohammed", "Nwosu", "Okafor",
  "Okonkwo", "Oyelaran", "Sanusi", "Tijani", "Umeh", "Yakubu",
  "Abubakar", "Bello", "Chukwuma", "Dike", "Egwu",
] as const;

const DISCIPLINES = [
  "10m-air-rifle",
  "10m-air-pistol",
  "25m-pistol",
  "50m-rifle-prone",
  "shotgun-trap",
] as const;

const CALIBRES = [".177", ".22 LR", "9mm", "12 gauge"] as const;

/* ---------------------------------------------------------------------------
   INSERT HELPER
   -------------------------------------------------------------------------- */

/**
 * Insert many rows in batches, skipping any id that already exists.
 *
 * `onConflictDoNothing` is what makes the whole script re-runnable — see the
 * determinism note in the header. Batched at 400 rows because Postgres caps a
 * statement at 65535 bound parameters and the widest table here has around fifteen
 * columns.
 *
 * This replaced a hand-rolled SQL builder that interpolated table and column names and
 * did its own array and JSON casting. Drizzle does all of that, and — the reason worth
 * stating — `InferInsertModel` means every call site is checked against the declared
 * column set. A misspelled column is a compile error rather than a Postgres error
 * discovered at row 400 of a seed run against staging.
 */
async function insert<T extends PgTable>(
  table: T,
  rows: readonly InferInsertModel<T>[],
): Promise<number> {
  const db = getArmoryDb();
  const BATCH = 400;

  for (let start = 0; start < rows.length; start += BATCH) {
    await db
      .insert(table)
      .values(rows.slice(start, start + BATCH))
      .onConflictDoNothing();
  }

  return rows.length;
}

const step = (label: string, count: number) =>
  console.log(`  ${String(count).padStart(5)}  ${label}`);

/* ===========================================================================
   THE CLUB
   ======================================================================== */

async function seed() {
  console.log("\nSeeding staging (§2.1). Deterministic and re-runnable.\n");

  /* ------------------------------------------------------------------ TIERS
     A full matrix (§3.1: "Explicit columns, not a JSON blob. These are read by
     enforcement code and must be queryable and constrainable"), with names and fees
     left visibly absent per §14. Every axis is varied so that a tier exists which
     fails each capability for a different reason. */
  const tierIds: string[] = [];
  const tierSpecs = [
    { name: "Tier A", host: true, annual: 12, concurrent: 3, own: true, store: true, disciplines: [...DISCIPLINES], horizon: 60, bookings: 4, attachable: false },
    { name: "Tier B", host: true, annual: 6, concurrent: 2, own: true, store: false, disciplines: DISCIPLINES.slice(0, 4), horizon: 30, bookings: 3, attachable: false },
    { name: "Tier C", host: true, annual: 4, concurrent: 2, own: true, store: false, disciplines: DISCIPLINES.slice(0, 3), horizon: 14, bookings: 2, attachable: false },
    { name: "Tier D", host: true, annual: 2, concurrent: 1, own: false, store: false, disciplines: DISCIPLINES.slice(0, 2), horizon: 14, bookings: 2, attachable: false },
    /* No hosting: exercises the MAY_HOST refusal that is about the tier rather than
       about an exhausted allowance. */
    { name: "Tier E", host: false, annual: 0, concurrent: 0, own: false, store: false, disciplines: DISCIPLINES.slice(0, 2), horizon: 7, bookings: 1, attachable: false },
    /* Attachable — §3.1's Partner membership, which "cannot outlive its principal". */
    { name: "Tier F", host: false, annual: 0, concurrent: 0, own: false, store: false, disciplines: DISCIPLINES.slice(0, 3), horizon: 14, bookings: 1, attachable: true },
  ];

  const tierRows = tierSpecs.map((tier, index) => {
    const id = uuidv7At(midnight.getTime() - 400 * DAY);
    tierIds.push(id);
    return {
      id,
      name: tier.name,
      /* NULL, not a plausible number. See the header. */
      monthlyFeeKobo: null,
      annualFeeKobo: null,
      canHost: tier.host,
      guestAllowanceAnnual: tier.annual,
      guestConcurrentMax: tier.concurrent,
      canOwnFirearm: tier.own,
      canStoreFirearm: tier.store,
      disciplineAccess: [...tier.disciplines],
      bookingHorizonDays: tier.horizon,
      concurrentBookingsMax: tier.bookings,
      isAttachable: tier.attachable,
      sortOrder: index,
      active: true,
    };
  });

  step(
    "tiers (full matrix, names and fees left blank per §14)",
    await insert(schema.tiers, tierRows),
  );

  /* ----------------------------------------------------------------- PEOPLE
     A hundred members plus the guests they bring. §3.1: "One row per human —
     applicant, guest and member are states, not separate tables." */
  const MEMBER_COUNT = 100;
  const GUEST_COUNT = 45;

  type Person = { id: string; first: string; last: string };
  const people: Person[] = [];

  for (let i = 0; i < MEMBER_COUNT + GUEST_COUNT; i += 1) {
    people.push({
      id: uuidv7At(midnight.getTime() - (380 - i) * DAY),
      first: pick(FIRST),
      last: pick(LAST),
    });
  }

  step(
    "people (100 members + 45 guests)",
    await insert(
      schema.people,
      people.map((person, i) => ({
        id: person.id,
        firstName: person.first,
        lastName: person.last,
        /* E.164 and unique (§3.1). Deterministic, and obviously not a real range. */
        phone: `+23480${String(10000000 + i).slice(-8)}`,
        email: `${person.first.toLowerCase()}.${person.last.toLowerCase()}${i}@example.invalid`,
        dateOfBirth: dateKey(dayOffset(-between(6570, 21900))),
        address: `${between(1, 90)} Placeholder Close, Abuja`,
      })),
    ),
  );

  const members = people.slice(0, MEMBER_COUNT);
  const guests = people.slice(MEMBER_COUNT);

  /* ------------------------------------------------------------ MEMBERSHIPS
     Statuses spread across §5's machine, with the boundary cases placed by hand
     rather than left to the generator. */
  type Membership = { id: string; personId: string; tierId: string; status: string };
  const memberships: Membership[] = [];

  const membershipRows = members.map((person, i) => {
    const id = uuidv7At(midnight.getTime() - (370 - i) * DAY);

    /* 0..79 active, 80..87 lapsed, 88..91 suspended, 92..95 pending, 96..99 resigned.
       Fixed rather than random so a demo can name a case. */
    const status =
      i < 80 ? ("active" as const)
        : i < 88 ? ("lapsed" as const)
          : i < 92 ? ("suspended" as const)
            : i < 96 ? ("pending" as const)
              : ("resigned" as const);

    const tierId = tierIds[i % tierIds.length];
    memberships.push({ id, personId: person.id, tierId, status });

    return {
      id,
      personId: person.id,
      tierId,
      memberNumber: i + 1,
      status,
      isFounding: i < 12,
      startedOn: dateKey(dayOffset(-between(30, 900))),
      /* §12.1 boundary: index 3 renews TODAY, index 4 renewed yesterday. */
      renewsOn:
        status === "active"
          ? i === 3 ? dateKey(midnight)
            : i === 4 ? dateKey(dayOffset(-1))
              : dateKey(dayOffset(between(20, 330)))
          : null,
      endedOn:
        status === "lapsed" || status === "resigned"
          ? dateKey(dayOffset(-between(1, 60)))
          : null,
    };
  });

  step(
    "memberships (80 active, 8 lapsed, 4 suspended, 4 pending, 4 resigned)",
    await insert(schema.memberships, membershipRows),
  );

  /* --------------------------------------------------------------- STAFF
     §10: "No shared logins. Every staff action attributable to a named person."

     Each officer gets a distinct PIN, printed once alongside the device codes.
     Distinct rather than shared because a seed that hands four officers the same
     PIN teaches the club the habit §10 forbids — and staging is where habits are
     formed. The PINs are fixed so the seed stays re-runnable; the HASHES are not,
     because scrypt salts per row (src/server/armory/staff-session.ts). */
  const staffIds: string[] = [];
  const staffPins: { name: string; role: string; pin: string }[] = [];

  const staffRows = await Promise.all(
    [
      { role: "founder" as const, person: members[0], pin: "735104" },
      { role: "range_officer" as const, person: members[1], pin: "482697" },
      { role: "range_officer" as const, person: members[2], pin: "150398" },
      { role: "read_only" as const, person: members[3], pin: "926473" },
    ].map(async ({ role, person, pin }) => {
      const id = uuidv7At(midnight.getTime() - 360 * DAY);
      staffIds.push(id);
      staffPins.push({ name: `${person.first} ${person.last}`, role, pin });
      return {
        id,
        personId: person.id,
        role,
        pinHash: await hashPin(pin),
        certifications: role === "range_officer" ? ["nra-rso"] : [],
        active: true,
      };
    }),
  );

  step(
    "staff (1 founder, 2 range officers, 1 read-only)",
    await insert(schema.staffUsers, staffRows),
  );

  const founderStaffId = staffIds[0];
  const officerStaffId = staffIds[1];

  /* -------------------------------------------------------------- LANES */
  const laneIds: string[] = [];
  const laneRows = DISCIPLINES.flatMap((discipline, d) =>
    [1, 2].map((number) => {
      const id = uuidv7At(midnight.getTime() - 350 * DAY);
      laneIds.push(id);
      return {
        id,
        discipline,
        number: d * 2 + number,
        /* One lane in maintenance, so availability computation has something to
           exclude (§6.2: "never a manually maintained calendar"). */
        status: (d === 2 && number === 2 ? "maintenance" : "available") as
          | "maintenance"
          | "available",
        positionCapacity: between(1, 4),
      };
    }),
  );

  step(
    "lanes (2 per discipline, 1 in maintenance)",
    await insert(schema.lanes, laneRows),
  );

  /* ----------------------------------------------------- WAIVER VERSIONS
     §3.1: "Exactly one active version at a time." Two rows, so signatures against the
     superseded one are stale and MAY_ATTEND blocks on them. */
  const waiverOldId = uuidv7At(midnight.getTime() - 300 * DAY);
  const waiverActiveId = uuidv7At(midnight.getTime() - 1 * DAY);

  /**
   * PLACEHOLDER TEXT. The club's counsel supplies the real thing (§14).
   *
   * Long enough to be a document rather than a label, deliberately: the desk
   * renders this in full above the signing area (WaiverSheet.tsx), and step 9 of
   * docs/M1_offline_acceptance.md asks the tester to confirm it is on screen. A
   * one-line fixture would make that check pass without exercising the scrolling
   * panel or showing what the layout does on the tablet being bought.
   */
  const waiverBody = [
    "RANGE WAIVER, ASSUMPTION OF RISK AND RELEASE",
    "",
    "1. I understand that a live firing range is inherently dangerous, and that",
    "   discharge of a firearm can cause serious injury, permanent disability,",
    "   hearing loss and death, to me and to others present.",
    "",
    "2. I confirm that I am not under the influence of alcohol or of any",
    "   substance that impairs judgement or coordination, and that I will leave",
    "   the firing line and inform a range officer if that changes.",
    "",
    "3. I will obey every instruction of a range officer immediately and without",
    "   argument, including any instruction to cease fire, unload, or leave the",
    "   firing line. I understand that failure to do so ends my visit.",
    "",
    "4. I will wear eye and ear protection at all times beyond the firing line,",
    "   and I will treat every firearm as loaded.",
    "",
    "5. I accept responsibility for any firearm and ammunition issued to me,",
    "   and I will return both to a range officer before leaving.",
    "",
    "6. I release the club, its officers and its members from liability for",
    "   injury or loss arising from my attendance, save where caused by their",
    "   own gross negligence or wilful act.",
    "",
    "I have read the above and I sign it freely.",
  ].join("\n");

  step(
    "waiver versions (1 active, 1 superseded yesterday)",
    await insert(schema.waiverVersions, [
      {
        id: waiverOldId,
        version: "2025.1",
        body: `${waiverBody}\n\n[Superseded by 2026.1.]`,
        effectiveFrom: dayOffset(-300),
        isActive: false,
      },
      {
        id: waiverActiveId,
        version: "2026.1",
        body: waiverBody,
        effectiveFrom: dayOffset(-1),
        isActive: true,
      },
    ]),
  );

  /* Most members signed the active version. A deliberate handful signed only the
     superseded one — §12.1 wants a member blocked at the desk for a reason the portal
     should have surfaced in advance. */
  const memberSignatures = members
    .filter((_, i) => i % 10 !== 7)
    .map((person, i) => ({
      id: uuidv7At(midnight.getTime() - (200 - i) * DAY),
      personId: person.id,
      waiverVersionId: i % 9 === 0 ? waiverOldId : waiverActiveId,
      signatureImageUrl: null,
      signedAt: dayOffset(-between(1, 200)),
      deviceId: null,
    }));

  step(
    "waiver signatures (10 members unsigned, some on the stale version)",
    await insert(schema.waiverSignatures, memberSignatures),
  );

  /* -------------------------------------------------------------- LICENCES
     §12.1's "Member licence expired yesterday" is index 5, placed by hand.
     `documentUrl` is NULL: §10 keeps scans off anything the desk can reach, and a
     seeded URL would be a fake object-storage key that looks live. */
  const licenceRows = members.slice(0, 40).map((person, i) => {
    const expires =
      i === 5 ? dayOffset(-1)
        : i === 6 ? midnight
          : i === 7 ? dayOffset(7)
            : i === 8 ? dayOffset(30)
              : i === 9 ? dayOffset(60)
                : dayOffset(between(90, 900));

    const status =
      i % 11 === 0
        ? ("pending_review" as const)
        : expires.getTime() < midnight.getTime()
          ? ("expired" as const)
          : ("verified" as const);

    return {
      id: uuidv7At(midnight.getTime() - (150 - i) * DAY),
      personId: person.id,
      licenceNumber: `NG-FA-${String(100000 + i)}`,
      issuingAuthority: "Placeholder issuing authority",
      calibres: [pick(CALIBRES), pick(CALIBRES)],
      issuedOn: dateKey(dayOffset(-between(200, 1200))),
      expiresOn: dateKey(expires),
      documentUrl: null,
      /* A few left pending_review: §3.1 says "Capability activates only on verified",
         so these fail MAY_USE_OWN_FIREARM for a different reason than expiry. */
      status,
      verifiedByStaffId: status === "pending_review" ? null : founderStaffId,
      verifiedAt: status === "pending_review" ? null : dayOffset(-between(10, 180)),
    };
  });

  step(
    "licences (40, with expiries on yesterday/today/+7/+30/+60)",
    await insert(schema.licences, licenceRows),
  );

  /* -------------------------------------------------------- QUALIFICATIONS
     §3.1: "Club competency. Distinct from licences." One expiring tomorrow. */
  const qualificationRows = members.slice(0, 55).map((person, i) => ({
    id: uuidv7At(midnight.getTime() - (140 - i) * DAY),
    personId: person.id,
    discipline: DISCIPLINES[i % DISCIPLINES.length],
    level: i % 4 === 0 ? "supervised" : "unsupervised",
    assessedByStaffId: officerStaffId,
    assessedAt: dayOffset(-between(30, 600)),
    expiresAt:
      i === 2 ? dayOffset(1) : i % 7 === 0 ? null : dayOffset(between(60, 700)),
  }));

  step(
    "qualifications (55, one expiring tomorrow)",
    await insert(schema.qualifications, qualificationRows),
  );

  /* ------------------------------------------------------ HOST ALLOWANCES
     §3.2: one row per membership per period. The current period ENDS TODAY for the
     first few — the period boundary §2.1 warns about — and index 1 is fully exhausted,
     which is §12.1's "Allowance exhausted mid-booking". */
  const activeMemberships = memberships.filter((m) => m.status === "active");

  const allowanceRows = activeMemberships.map((membership, i) => {
    const tier = tierRows.find((t) => t.id === membership.tierId);
    const quota = tier?.guestAllowanceAnnual ?? 0;

    return {
      id: uuidv7At(midnight.getTime() - (120 - i) * DAY),
      membershipId: membership.id,
      periodStart: dateKey(dayOffset(i < 4 ? -364 : -between(30, 200))),
      periodEnd: dateKey(i < 4 ? midnight : dayOffset(between(30, 300))),
      includedQuota: quota,
      usedCount:
        i === 1 ? quota
          : i === 2 ? Math.max(quota - 1, 0)
            : between(0, Math.max(quota - 1, 0)),
      overageCount: i === 1 ? 2 : 0,
    };
  });

  step(
    "host allowances (4 periods ending today, 1 exhausted)",
    await insert(schema.hostAllowances, allowanceRows),
  );

  /* ------------------------------------------------------------- FIREARMS
     §3.4: "One register. One log. No exceptions." Club-owned and member-owned in the
     same table, distinguished by an ownership column.

     `status` is left at its default and then DERIVED by the custody events below — the
     trigger in migration 0002 recomputes it, so this seed also exercises the mechanism
     §3.4 insists on rather than asserting a status directly. */
  const licensedOwners = members
    .slice(0, 40)
    .filter((_, i) => licenceRows[i]?.status === "verified");

  type Firearm = { id: string; calibre: string; ownership: string };
  const firearms: Firearm[] = [];

  const firearmRows = Array.from({ length: 26 }, (_, i) => {
    const id = uuidv7At(midnight.getTime() - (110 - i) * DAY);
    const ownership = (i < 16 ? "club" : "member") as "club" | "member";
    const calibre = CALIBRES[i % CALIBRES.length];
    firearms.push({ id, calibre, ownership });

    const owner =
      ownership === "member" ? licensedOwners[i % licensedOwners.length] : null;
    const ownerLicence = owner
      ? licenceRows.find((l) => l.personId === owner.id)
      : null;

    return {
      id,
      serialNumber: `SN-${String(40000 + i * 37)}`,
      make: `Placeholder make ${(i % 5) + 1}`,
      model: `Model ${(i % 7) + 1}`,
      calibre,
      discipline: DISCIPLINES[i % DISCIPLINES.length],
      ownership,
      ownerPersonId: owner?.id ?? null,
      licenceId: ownerLicence?.id ?? null,
      condition: "serviceable",
      roundCount: between(0, 8000),
      acquiredOn: dateKey(dayOffset(-between(100, 1500))),
      decommissionedOn: null,
    };
  });

  step(
    "firearms (16 club, 10 member-owned)",
    await insert(schema.firearms, firearmRows),
  );

  /* -------------------------------------------------- AMMUNITION LOTS
     `quantityRemaining` is recomputed from issues by trigger (§3.4), so it is seeded
     equal to received and the issues below move it. */
  const lotIds: string[] = [];
  const lotRows = CALIBRES.flatMap((calibre, c) =>
    [0, 1].map((n) => {
      const id = uuidv7At(midnight.getTime() - (100 - c * 2 - n) * DAY);
      lotIds.push(id);
      const received = between(2000, 8000);
      return {
        id,
        calibre,
        quantityReceived: received,
        quantityRemaining: received,
        supplier: "Placeholder supplier",
        receivedOn: dateKey(dayOffset(-between(20, 300))),
        reference: `LOT-${String(700 + c * 2 + n)}`,
      };
    }),
  );

  step(
    "ammunition lots (2 per calibre)",
    await insert(schema.ammunitionLots, lotRows),
  );

  /* ------------------------------------------------------------- SESSIONS
     §2.1 asks for "several hundred sessions". These are past, closed, and carry the
     participations and rounds that make the score history and the dashboard non-empty.

     Plus one OPEN session for today, which is what makes the §8.5 acceptance run
     possible at all: a check-in needs an open session and M1 cannot open one offline.
     See the note in src/offline/checkin.ts. */
  const SESSION_DAYS = 120;

  const bookingRows: InferInsertModel<typeof schema.bookings>[] = [];
  const participantRows: InferInsertModel<typeof schema.bookingParticipants>[] = [];
  const sessionRows: InferInsertModel<typeof schema.sessions>[] = [];
  const participationRows: InferInsertModel<typeof schema.participations>[] = [];
  const roundRows: InferInsertModel<typeof schema.rounds>[] = [];
  const custodyRows: InferInsertModel<typeof schema.custodyEvents>[] = [];
  const ammoIssueRows: InferInsertModel<typeof schema.ammunitionIssues>[] = [];
  const invitationRows: InferInsertModel<typeof schema.guestInvitations>[] = [];
  const guestSignatureRows: InferInsertModel<typeof schema.waiverSignatures>[] = [];

  for (let d = SESSION_DAYS; d >= 1; d -= 1) {
    const day = dayOffset(-d);
    /* Two or three sessions a day, so the total lands in the several hundreds. */
    const perDay = between(2, 3);

    for (let s = 0; s < perDay; s += 1) {
      const host = activeMemberships[between(0, activeMemberships.length - 1)];
      const hostPerson = members.find((m) => m.id === host.personId);
      if (!hostPerson) continue;

      const discipline = pick(DISCIPLINES);
      const slotStart = atHour(day, 9 + s * 3);
      const base = slotStart.getTime();

      const bookingId = uuidv7At(base);
      bookingRows.push({
        id: bookingId,
        hostMembershipId: host.id,
        bookingDate: dateKey(day),
        slotStart,
        slotEnd: new Date(base + 2 * 3_600_000),
        discipline,
        status: "completed",
        cancelledAt: null,
      });

      const sessionId = uuidv7At(base + 1);
      sessionRows.push({
        id: sessionId,
        bookingId,
        sessionDate: dateKey(day),
        openedAt: slotStart,
        openedByStaffId: officerStaffId,
        closedAt: new Date(base + 2 * 3_600_000),
        closedByStaffId: officerStaffId,
        status: "closed",
      });

      /* The host, plus one or two other shooters. */
      const attendees = [
        hostPerson,
        ...Array.from({ length: between(0, 2) }, () => pick(members)),
      ];

      for (const [index, attendee] of attendees.entries()) {
        const participationId = uuidv7At(base + 2 + index);
        const tier = tierRows.find((t) => t.id === host.tierId);

        participantRows.push({
          id: uuidv7At(base + 20 + index),
          bookingId,
          personId: attendee.id,
          role: "member_shooter",
          guestInvitationId: null,
        });

        participationRows.push({
          id: participationId,
          sessionId,
          personId: attendee.id,
          role: "member_shooter",
          hostPersonId: null,
          laneId: pick(laneIds),
          /* §3.3: the tier as at the visit, never a join to the live tier. */
          tierSnapshot: tier
            ? {
                id: tier.id,
                name: tier.name,
                guestAllowanceAnnual: tier.guestAllowanceAnnual,
              }
            : null,
          checkedInAt: new Date(base + index * 60_000),
          checkedInByStaffId: officerStaffId,
          checkedOutAt: new Date(base + 2 * 3_600_000),
          deviceId: null,
        });

        /* One or two scores each. §6.5: "Guests are scored identically to members." */
        for (let r = 0; r < between(1, 2); r += 1) {
          roundRows.push({
            id: uuidv7At(base + 100 + index * 10 + r),
            participationId,
            discipline,
            format: discipline.startsWith("10m") ? "60-shot" : "40-shot",
            totalScore: between(320, 598),
            shotDetail: null,
            captureMethod: "manual",
            sourceReference: null,
            capturedByStaffId: officerStaffId,
            capturedAt: new Date(base + 5_400_000),
            correctsRoundId: null,
            correctionReason: null,
            deviceId: null,
          });
        }

        /* Ammunition, issued and reconciled so the lot balances derive correctly. */
        const issued = between(20, 60);
        const fired = between(10, issued);
        ammoIssueRows.push({
          id: uuidv7At(base + 200 + index),
          lotId: lotIds[between(0, lotIds.length - 1)],
          participationId,
          qtyIssued: issued,
          qtyFired: fired,
          qtyReturned: issued - fired,
          issuedByStaffId: officerStaffId,
          reconciledAt: new Date(base + 2 * 3_600_000),
          issuedAt: new Date(base + index * 60_000),
          deviceId: null,
        });

        /* A club firearm issued and returned within the session. §3.4: the movement
           log is the sole source of truth, and the status derives from it. */
        const firearm = firearms[between(0, 15)];
        custodyRows.push(
          {
            id: uuidv7At(base + 300 + index * 2),
            firearmId: firearm.id,
            eventType: "issued",
            actorStaffId: officerStaffId,
            counterpartyPersonId: attendee.id,
            sessionId,
            occurredAt: new Date(base + index * 60_000),
            deviceId: null,
            correctsEventId: null,
            note: null,
          },
          {
            id: uuidv7At(base + 300 + index * 2 + 1),
            firearmId: firearm.id,
            eventType: "returned",
            actorStaffId: officerStaffId,
            counterpartyPersonId: attendee.id,
            sessionId,
            occurredAt: new Date(base + 2 * 3_600_000),
            deviceId: null,
            correctsEventId: null,
            note: null,
          },
        );
      }
    }
  }

  /* ------------------------------------------- TODAY AND TOMORROW
     What the day pack's window covers (§8.1), and what the desk's Today screen shows.
     Today's session is OPEN so the §8.5 run can check people in offline. */
  for (const offset of [0, 1]) {
    const day = dayOffset(offset);

    for (let s = 0; s < 3; s += 1) {
      const host = activeMemberships[s];
      const hostPerson = members.find((m) => m.id === host.personId);
      if (!hostPerson) continue;

      const discipline = DISCIPLINES[s % DISCIPLINES.length];
      const slotStart = atHour(day, 10 + s * 3);
      const base = slotStart.getTime();

      const bookingId = uuidv7At(base);
      bookingRows.push({
        id: bookingId,
        hostMembershipId: host.id,
        bookingDate: dateKey(day),
        slotStart,
        slotEnd: new Date(base + 2 * 3_600_000),
        discipline,
        status: "confirmed",
        cancelledAt: null,
      });

      /* Only today gets an open session. Tomorrow's arrivals are expected but the
         session does not exist yet, which is the honest state and exercises the
         refusal in buildCheckIn. */
      if (offset === 0) {
        sessionRows.push({
          id: uuidv7At(base + 1),
          bookingId,
          sessionDate: dateKey(day),
          openedAt: atHour(day, 8),
          openedByStaffId: officerStaffId,
          closedAt: null,
          closedByStaffId: null,
          status: "open",
        });
      }

      participantRows.push({
        id: uuidv7At(base + 10),
        bookingId,
        personId: hostPerson.id,
        role: "member_shooter",
        guestInvitationId: null,
      });

      /* And a guest, with a completed invitation — so §12.1's host-presence rule has
         something to block and then clear on the Today screen. */
      const guest = guests[(offset * 3 + s) % guests.length];
      const invitationId = uuidv7At(base + 11);

      invitationRows.push({
        id: invitationId,
        hostMembershipId: host.id,
        guestPersonId: guest.id,
        bookingId,
        /* NOT NULL on the table. A hash of a token nobody holds: the guest link is a
           §6.3 flow and seeding a usable one would be seeding a live credential. */
        tokenHash: `seed-not-a-live-token-${invitationId}`,
        expiresAt: atHour(day, 23),
        status: "completed",
        issuedAt: dayOffset(offset - 2),
        openedAt: dayOffset(offset - 1),
        completedAt: dayOffset(offset - 1),
        cancelledAt: null,
        isChargeable: true,
      });

      participantRows.push({
        id: uuidv7At(base + 12),
        bookingId,
        personId: guest.id,
        role: "guest_shooter",
        guestInvitationId: invitationId,
      });

      /* The guest signed the active waiver — §4.2 blocks GUEST_MAY_ATTEND without one,
         and the case worth demonstrating is the host-presence block, not a missing
         signature. */
      guestSignatureRows.push({
        id: uuidv7At(base + 13),
        personId: guest.id,
        waiverVersionId: waiverActiveId,
        signatureImageUrl: null,
        signedAt: dayOffset(offset - 1),
        deviceId: null,
      });
    }
  }

  step("bookings", await insert(schema.bookings, bookingRows));
  step(
    "guest invitations (today and tomorrow, completed)",
    await insert(schema.guestInvitations, invitationRows),
  );
  step(
    "booking participants",
    await insert(schema.bookingParticipants, participantRows),
  );
  step(
    "guest waiver signatures",
    await insert(schema.waiverSignatures, guestSignatureRows),
  );
  step(
    "sessions (120 days of history + 1 open today)",
    await insert(schema.sessions, sessionRows),
  );
  step("participations", await insert(schema.participations, participationRows));
  step("rounds (score history)", await insert(schema.rounds, roundRows));
  step(
    "ammunition issues (reconciled; lot balances derive)",
    await insert(schema.ammunitionIssues, ammoIssueRows),
  );
  step(
    "custody events (firearm status derives from these)",
    await insert(schema.custodyEvents, custodyRows),
  );

  /* -------------------------------------------------------------- DEVICES
     §3.1 and §10. Two devices with real tokens, printed once — this is what lets a
     tablet be enrolled and the §8.5 protocol run.

     The token is from `crypto.getRandomValues`, not the seeded PRNG. Everything else
     in this file is deliberately reproducible; a credential must not be. */
  const deviceTokens: { label: string; token: string }[] = [];

  const deviceRows = await Promise.all(
    [
      { label: "Desk tablet", surface: "desk" as const },
      { label: "Lane tablet", surface: "lane" as const },
    ].map(async ({ label, surface }) => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      deviceTokens.push({ label, token });

      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const tokenHash = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return {
        id: uuidv7At(midnight.getTime() - 10 * DAY),
        label,
        surface,
        registeredByStaffId: founderStaffId,
        registeredAt: dayOffset(-10),
        lastSeenAt: null,
        revokedAt: null,
        tokenHash,
        tokenIssuedAt: dayOffset(-10),
      };
    }),
  );

  step("devices (1 desk, 1 lane)", await insert(schema.devices, deviceRows));

  console.log("\nDevice registration codes — shown once, not recoverable:\n");
  for (const { label, token } of deviceTokens) {
    console.log(`  ${label.padEnd(14)} ${token}`);
  }
  console.log(
    "\n  Enter one at /console on the tablet. The server holds only a hash\n" +
      "  (drizzle/0003_device_tokens.sql), so a lost code means re-running this.\n",
  );

  console.log("Officer unlock PINs — §10, one per named person:\n");
  for (const { name, role, pin } of staffPins) {
    console.log(`  ${pin}  ${name.padEnd(22)} ${role}`);
  }
  console.log(
    "\n  The PIN is the second factor, not a password: it is only accepted on a\n" +
      "  registered device (drizzle/0004_staff_sessions.sql). Five wrong attempts\n" +
      "  lock the account for fifteen minutes.\n",
  );

  console.log("Seeded. Re-running changes nothing — ids are deterministic.\n");
}

seed().catch((error: unknown) => {
  console.error("\nSeed failed.\n");
  console.error(error instanceof Error ? error.message : error);
  /* Each collection is inserted separately rather than in one transaction, so a
     failure part-way leaves what was already written. That is a choice, not a
     limitation — the connection supports transactions — and it is safe because every
     insert is idempotent: fix the cause and run it again. Wrapping 120 days of history
     in a single long transaction would buy atomicity nothing here needs. */
  process.exit(1);
});
