/**
 * PRE-LAUNCH CONTENT GATE
 *
 * Spec §8 lists nine items the build cannot complete without, and §9 lists
 * eight acceptance criteria. Both currently live in a Word document, which
 * means both are advisory. This module makes the content half enforceable:
 * outstanding items are data, `npm run gate` fails while any blocker remains,
 * and /brand renders the live list for the founder.
 *
 * The deliberate design choice is that a missing value must LOOK missing.
 * Plausible placeholder content is how a site ships with an invented phone
 * number and a claim that was not true on the day it went live.
 */

import { contact, site } from "@/lib/site";

export type Owner = "Founder" | "Operations" | "Legal" | "Build team";

export type GateItem = {
  id: string;
  label: string;
  owner: Owner;
  /** `true` once the value is present in the codebase or CMS. */
  resolved: boolean;
  /**
   * `blocker` — launch cannot proceed. `degraded` — the site can go live with
   * the affected section hidden. Distinguishing these is what stops three open
   * decisions from stalling the whole build.
   */
  severity: "blocker" | "degraded";
  /**
   * Which launch this gates. Phase 1 items block the marketing site going
   * live; Phase 2 items block Leagues opening, which happens later and to an
   * existing membership. Separated so a Phase 2 dependency cannot hold up the
   * Phase 1 launch it has nothing to do with.
   */
  phase?: 1 | 2;
  note?: string;
};

const has = (value: unknown) => value !== null && value !== undefined;

/**
 * Content items from spec §8, ordered by lead time. The first is the longest
 * and most perishable, and it is the one that gates everything else.
 */
export const contentGate: GateItem[] = [
  {
    id: "photography",
    label: "Facility photography — commissioned shoot, day and night registers",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    note:
      "Critical path. The window closes when the facility becomes operational. " +
      "Shot list in Brand Guidelines §7 — plus the text-safe-zone addendum, " +
      "without which every hero needs a scrim the brand forbids. " +
      "Architectural renders are comps only and must not ship.",
  },
  {
    id: "domain",
    label: "Canonical domain",
    owner: "Founder",
    resolved: has(site.origin),
    severity: "blocker",
    note: "Needed for canonical URLs, OG tags, and email SPF/DKIM/DMARC records.",
  },
  {
    id: "membership-owner",
    label: "Named owner of the membership pipeline",
    owner: "Founder",
    resolved: has(contact.membershipOwner),
    severity: "blocker",
    note:
      "Flow A steps 5-6 have no technical component. Without a named person " +
      "the application flow terminates in an inbox and the site is a waitlist, " +
      "not a funnel. This is the one open decision software cannot route around.",
  },
  {
    id: "tiers",
    label: "Membership tiers — names, inclusions, founding cap",
    owner: "Founder",
    resolved: false,
    severity: "degraded",
    note:
      "Modelled as content, so the values can land the night before launch. " +
      "Prices are never published — 'On application' only, per spec §9.",
  },
  {
    id: "first-visit-pricing",
    label: "First-visit price, deposit amount, refund policy wording",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    note:
      "Blocks Flow B. Refund terms must render BEFORE payment is taken, and " +
      "the policy version is stored against each booking for dispute defence.",
  },
  {
    id: "facility-spec",
    label: "Per-discipline specification — lanes, distances, targeting, safety",
    owner: "Operations",
    resolved: false,
    severity: "degraded",
    note:
      "Factual data for the specification tables. Lane counts for the 25m and " +
      "10m pistol lines are not stated in any source document and currently " +
      "render as omitted rather than as zero.",
  },
  {
    id: "booking-durable-store",
    label:
      "Durable store for FIRST-VISIT deposits — the in-memory store is development only",
    owner: "Build team",
    resolved: false,
    severity: "blocker",
    note:
      "InMemoryBookingStore holds holds and confirmations in module memory. On " +
      "any host that runs more than one instance or cold-starts, capacity is " +
      "not shared and does not survive a restart — two instances would each " +
      "believe a full session had places left, and a paid booking could arrive " +
      "with no matching hold. Swap in the calendar-backed adapter before taking " +
      "a single real deposit. Registered because this reads as finished code. " +
      "SCOPE, CORRECTED: this is the PUBLIC first-visit deposit flow only. The " +
      "Members Portal specification §2.2 lists it as blocking the member Diary " +
      "and the red action, which is wrong on the facts — member bookings live " +
      "in armory.bookings and armory.booking_participants, are durable, " +
      "transactional and state-machined, and were never touched by this store. " +
      "What blocked the member calendar was opening hours, and drizzle/0008 " +
      "settled that.",
  },
  {
    id: "email-dns",
    label: "SPF, DKIM and DMARC on the club domain",
    owner: "Build team",
    resolved: false,
    severity: "blocker",
    note:
      "Flow A step 4 and Flow B steps 5-7 are all email. Without an " +
      "authenticated sending domain the confirmations land in spam, both flows " +
      "appear to work perfectly in testing, and applications die silently. Test " +
      "against real Gmail and Outlook inboxes, not just a seed score.",
  },
  {
    id: "integration-credentials",
    label: "Paystack, CRM and Postmark credentials",
    owner: "Build team",
    resolved: false,
    severity: "blocker",
    note:
      "Until a CRM or a fallback address exists, the intake layer refuses " +
      "submissions rather than accepting and dropping them — see the durability " +
      "rule in src/server/intake.ts. Until Paystack is configured the booking " +
      "module degrades to a phone number. Both are correct behaviour, and both " +
      "mean the site cannot convert.",
  },
  {
    id: "ritual-accuracy",
    label: "First-visit ritual copy — confirm operational accuracy",
    owner: "Operations",
    resolved: false,
    severity: "blocker",
    note:
      "Draft copy is written in src/content/ritual.ts and renders through the " +
      "step sequence. The sequence comes from spec §3, but three facts are ours " +
      "and must be theirs: whether the briefing precedes equipment issue, the " +
      "round length and shot count for a first visit, and how results are " +
      "returned. This is the highest-leverage page for the growth segment, so " +
      "it cannot ship on assumptions.",
  },
  {
    id: "hospitality",
    label: "Snack bar offer, deck capacities, VIP deck access rules",
    owner: "Operations",
    resolved: false,
    severity: "degraded",
  },
  {
    id: "affiliations",
    label: "Sporting body relationships and certifications, with evidence",
    owner: "Founder",
    resolved: false,
    severity: "degraded",
    note:
      "Claims discipline: publish only what is true on day one. " +
      "'Built to international competition standard' is safe from opening. " +
      "'Host of the national championships' waits until it has happened.",
  },
  {
    id: "institutional-contact",
    label: "Institutional contact — named person and direct number",
    owner: "Founder",
    resolved: has(contact.institutional),
    severity: "degraded",
    note: "Flow C. No form — that audience does not fill in web forms.",
  },
  {
    id: "bookings-phone",
    label: "Bookings phone number",
    owner: "Founder",
    resolved: has(contact.bookingsPhone),
    severity: "degraded",
    note: "Shown on /first-visit so a booking or gateway outage degrades to a call.",
  },
  {
    id: "hours",
    label: "Opening hours",
    owner: "Operations",
    /* SETTLED, 16 August 2026: 9am-6pm, every day. src/content/club-week.ts. */
    resolved: has(contact.hours),
    severity: "degraded",
    note:
      "Two places, one fact, and both now answered. The public site states the " +
      "sentence; the portal reads armory.opening_hours, which is the same week " +
      "as rows. Both come from src/content/club-week.ts. " +
      "THE ROWS ARE NOT WRITTEN BY A DEPLOY — run `npm run db:hours --apply` " +
      "from a machine with the connection string, once, and again whenever the " +
      "week changes. Until that runs, the portal behaves exactly as it did " +
      "before: one honest sentence and nothing bookable.",
  },
  {
    id: "session-length",
    label: "How long does one booking occupy a lane?",
    owner: "Operations",
    /* SETTLED, 16 August 2026: 60 minutes, with a 15-minute turnaround. */
    resolved: true,
    severity: "degraded",
    note:
      "ANSWERED: a standard session is 60 minutes, with a 15-minute " +
      "operational buffer between one session and the next. Declared in " +
      "src/content/club-week.ts and written by `npm run db:hours --apply`. " +
      "The two are separate columns because they belong to different people: " +
      "session_minutes is the MEMBER's — what their booking says and how long " +
      "the lane is theirs — and turnaround_minutes is the CLUB's, for clearing " +
      "the line and briefing the next relay. Folded into one number, a booking " +
      "record would claim the member had the lane until 10:15 while the " +
      "officer walked them off at 10:00. " +
      "The club's day is therefore seven sessions a discipline: 09:00, 10:15, " +
      "11:30, 12:45, 14:00, 15:15, 16:30.",
  },
  {
    id: "club-programme",
    label: "Does the club have a programme?",
    owner: "Founder",
    /* SETTLED, 16 August 2026: yes. The Diary keeps its tab. */
    resolved: true,
    severity: "degraded",
    note:
      "Members Portal §7.5, and §16 calls it the strongest single determinant " +
      "of whether this portal reads as hospitality or as a booking tool. " +
      "ANSWERED: the founder confirms the club has a programme, so the Diary " +
      "is the hospitality surface and keeps its tab — TODAY · DIARY · COMPETE " +
      "· ME · BOOK. The alternative structure (three tabs, with availability " +
      "inside the booking flow) is not built and is not needed. " +
      "What the answer creates is an OBLIGATION rather than a feature: a tab " +
      "promising a programme has to have one in it. The operating rhythm now " +
      "fills it every day (9am-6pm, published), and the one-off feed — guest " +
      "evenings, fixtures, closures — is the club's to keep current. An events " +
      "table nobody writes to makes the tab emptier than no tab would have " +
      "been, which is the failure §7.3 warns about.",
  },
  {
    id: "table-capacity",
    label: "How many covers can the club actually seat?",
    owner: "Operations",
    resolved: false,
    severity: "degraded",
    note:
      "club_settings.table_capacity is null, which the portal reads as 'table " +
      "bookings are not open yet' and says so. Deliberately not defaulted to " +
      "unlimited: that is the value that sells a Friday evening the kitchen " +
      "cannot serve, which is the hospitality equivalent of double-booking a " +
      "lane and is exactly as embarrassing in front of a guest. Table booking " +
      "is Members Portal §16's 'strongly recommended' item — without it the " +
      "portal inverts the hospitality-first frame in the surface members touch " +
      "most.",
  },
  {
    id: "application-owner",
    label: "Applications have no owner column, so every one reads unowned",
    owner: "Build team",
    resolved: false,
    severity: "degraded",
    note:
      "Management System §8.2: 'every application carries a named owner and an " +
      "age, and an application with no owner appears on the founder's DAY " +
      "until it has one'. The age is built. The owner is not, because " +
      "`applications` has only `decided_by_staff_id` — who CLOSED an " +
      "application, which says nothing about who is carrying it. Reading that " +
      "column as ownership would report a healthy queue in which every OPEN " +
      "application is unowned, which is the exact failure `membership-owner` " +
      "names. So /manage/people renders the column and fills it with 'Nobody' " +
      "for every row, which is true. Needs one nullable column and a control " +
      "to set it; the staffing half is `membership-owner` and is not software.",
  },
  {
    id: "manage-shared-device",
    label: "Management on a shared counter device has no short session",
    owner: "Build team",
    resolved: false,
    severity: "degraded",
    note:
      "Management System §12.3: 'Where a device is shared — a front-of-house " +
      "tablet that is not the console — sessions are short and " +
      "re-authentication is quick, because the alternative is a permanently " +
      "signed-in device on a public counter.' /manage authenticates with the " +
      "member session, which is long because it is built for a member's own " +
      "phone. That is fine for the personal devices §4 describes and is NOT " +
      "fine for a shared counter tablet. The answer is §4.1's console " +
      "hand-off: a single-purpose, minutes-long, device-bound session issued " +
      "by the console, carrying the one action it was opened for and no " +
      "refresh token. Until it ships, the club should not put management on a " +
      "shared device — a posture decision, recorded here rather than assumed.",
  },
  {
    id: "kitchen-hours",
    label: "When does the kitchen and bar actually serve?",
    owner: "Founder",
    resolved: false,
    severity: "degraded",
    note:
      "Management System §7.1, and finding F3 of the product panel of 17 " +
      "August 2026. Until 0010 the club could WRITE 'Deck and kitchen only' — " +
      "opening_hours.label, which the schema documents as never parsed — and " +
      "could not MODEL it: table slots ran the whole opening day against one " +
      "global cover count, so a member could book a table at 09:15 on a day " +
      "the kitchen opens at noon. armory.service_hours now holds the club's " +
      "service windows and availableTables requires a sitting to fall wholly " +
      "inside one. THE TABLE IS EMPTY, which yields no table slots and the " +
      "sentence 'The club has not published its kitchen and bar hours yet.' " +
      "Told to the panel as unsettled on 17 August; registered rather than " +
      "guessed, because the permissive reading — serve whenever the doors are " +
      "open — is the one that sells a lunch nobody is cooking. Paired with " +
      "`table-capacity`: BOTH must be answered before a cover can be sold, and " +
      "answering only one leaves the surface saying so.",
  },
  {
    id: "spectator-capacity",
    label: "Does a spectator occupy one of the club's covers?",
    owner: "Operations",
    resolved: false,
    severity: "degraded",
    note:
      "Members Portal §7.4 says a spectator 'consumes neither, but does consume " +
      "a seat and a name on the arrivals list'. The name on the arrivals list " +
      "is unconditional and is built. Whether they also occupy a cover is a " +
      "question about how the club seats people, so `occupancyOf` returns zero " +
      "and this is registered rather than guessed. Zero fails safe: a " +
      "spectator who turns out to need a seat is a seat found on the night, " +
      "where a guessed count silently refuses bookings the club would have " +
      "taken and nobody ever sees it happen.",
  },
  {
    id: "offline-credential",
    label: "Founder-facing revocation control, before any credential is cached",
    owner: "Build team",
    resolved: false,
    severity: "blocker",
    note:
      "Members Portal §9.2: 'Cache nothing until revocation exists.' The " +
      "security review names a founder-facing revocation control as a launch " +
      "blocker, and a cached membership card with a 24-hour life is only safe " +
      "if there is something to race against it. Until the control ships the " +
      "membership card is ONLINE-ONLY — which is how it is built, and the " +
      "screen says so rather than failing quietly at reception. The time-to- " +
      "live itself is a security posture decision (§16 recommends 24 hours), " +
      "not a technical one.",
  },
  {
    id: "legal",
    label: "Privacy, terms, refund policy, liability and eligibility copy",
    owner: "Legal",
    resolved: false,
    severity: "blocker",
    note:
      "Privacy policy must comply with the Nigeria Data Protection Act. " +
      "Confirm with counsel whether the club's processing triggers the " +
      "registration and DPO obligations for controllers of major importance.",
  },
  {
    id: "logo-vector",
    label: "Logo vector files — all lockups and variants",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    note:
      "Guidelines §3 forbids recreating the lockup. The Lockup component " +
      "renders a flagged placeholder until real vectors arrive, and is built " +
      "so the swap is a single file replacement. Wordmark Option B (precision " +
      "grotesque redraw) is recommended but does not block launch.",
  },
  /* =========================================================================
     PHASE 2 — LEAGUES

     These block Leagues OPENING, not the Phase 1 marketing launch. They are
     tagged `phase: 2` so a hardware question about a targeting system can never
     hold up a website going live.

     The first two are the Brief's own ACT NOW items, both with Phase 1
     deadlines even though the product they gate is Phase 2.
     ====================================================================== */
  {
    id: "targeting-system-export",
    label: "Air rifle targeting system — can it attribute and export scores?",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "The Brief calls this the decision that 'determines whether Leagues is " +
      "buildable at all', and wants it answered during the current renovation. " +
      "Four questions for the installer: can it attribute a score to a named " +
      "person rather than a lane; can it store results over time or does it " +
      "display and forget; can it export by file, API or database, and in what " +
      "format; can a lane be bound to a person for a round. " +
      "MITIGATED, NOT BLOCKING THE BUILD: ingestion has CSV and manual adapters, " +
      "so a 'no' degrades Leagues in quality rather than cancelling it.",
  },
  {
    id: "leagues-manual-pilot",
    label: "Manual league pilot — four members, one weekly round, a spreadsheet",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "The Brief's second ACT NOW item, and the cheapest validation available: " +
      "'If four friends will return weekly to move a number in a spreadsheet, " +
      "the concept is validated for the cost of an afternoon. If they will not, " +
      "no software saves it.' Deliberately NOT a software task — building a tool " +
      "for the pilot destroys what the pilot tests. The resulting sheet becomes " +
      "the first CSV import and the first honest test of this schema.",
  },
  {
    id: "founding-base",
    label: "A founding-member base exists before Leagues opens",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "Spec §1: Phase 2 'begins after opening, once a founding-member base " +
      "exists and the manual pilot has validated the loop'. Code being ready is " +
      "not a reason to ship — 'launching a social competition product to an " +
      "empty range is throwing a party nobody attends'.",
  },
  {
    id: "database-provisioned",
    label: "Postgres provisioned, region measured, restore tested",
    owner: "Build team",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "DATABASE_URL against any Postgres. Pick the region by measuring " +
      "Nigerian latency rather than trusting documentation — the same rule that " +
      "governed hosting. Scores and standings are irreplaceable in a way " +
      "marketing copy never was, so point-in-time recovery must be enabled AND " +
      "a restore actually performed, not just a checkbox ticked.",
  },
  {
    id: "tournament-scoring-rule",
    label: "Tournament winner — most rounds won, or highest aggregate?",
    owner: "Founder",
    resolved: true,
    severity: "degraded",
    phase: 2,
    note:
      "SETTLED: best of three rounds. The winner is the team that wins the most " +
      "rounds, with the gross total as tiebreak — which is also the figure the " +
      "live screen shows largest, so a tiebreak never looks arbitrary to the " +
      "room. §1's 'gross, live' describes what the screen displays throughout; " +
      "§4's 'best of three rounds' decides the result.",
  },
  {
    id: "tournament-shots-per-turn",
    label: "Shots per turn, and custom format limits",
    owner: "Operations",
    resolved: false,
    severity: "degraded",
    phase: 2,
    note:
      "§4 fixes formats, players, rounds and durations but not shots per turn. " +
      "Five is assumed to fit the stated 45/90/20-minute slots. §9 also lists " +
      "'custom format limits — maximum players, rounds and shots per round, to " +
      "keep sessions within a bookable slot' as an open item.",
  },
  {
    id: "live-screen-scope",
    label: "Live screen — in launch scope, and on what hardware?",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "§5: 'the only element of Leagues that genuinely requires software at " +
      "launch'. Must run OFFLINE and be readable at 5-10 metres from the rail " +
      "and bar seating — test there, not at a desk. The engine already accepts " +
      "either input path, so the targeting-system answer does not block it: " +
      "Path A automatic, Path B a range officer on a tablet.",
  },
  {
    id: "ladder-window",
    label: "Ladder rolling window length",
    owner: "Founder",
    resolved: false,
    severity: "degraded",
    phase: 2,
    note:
      "§7: 'Best rounds over a rolling window — window length to be set in the " +
      "pilot.' §9 confirms it is set once real score distributions are visible. " +
      "Blocks the Ladder, not the Tournament or the League.",
  },
  {
    id: "season-prize",
    label: "Season prize",
    owner: "Founder",
    resolved: false,
    severity: "degraded",
    phase: 2,
    note:
      "§9 recommendation: non-monetary and status-based — a trophy at " +
      "reception, names engraved, a championship frame. Consistent with the " +
      "brand and cheaper than discounts.",
  },
  {
    id: "churn-signal-tracking",
    label: "Season-one churn measurement — who STOPS submitting",
    owner: "Founder",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "§3 and §9 name this 'the single most important thing to measure in the " +
      "first season' and 'the only early warning you will get'. If beginners " +
      "stop submitting after three or four weeks, the variance problem has " +
      "surfaced and divisions or handicaps return to the table. The predicates " +
      "exist in src/server/leagues/fixtures.ts (hasGoneQuiet, " +
      "weeksSinceLastRound); what is outstanding is someone owning the number " +
      "and acting on it.",
  },
  {
    id: "member-data-retention",
    label: "Retention schedule for attendance records",
    owner: "Legal",
    resolved: false,
    severity: "blocker",
    phase: 2,
    note:
      "`attendance` is the one table holding a wall-clock time against a named " +
      "person, and Phase 2 turns it into a RECURRING schedule — strictly worse " +
      "than a one-off booking. `purge_after` is written on every row and needs " +
      "a policy behind it, plus the data-subject export and erasure routes the " +
      "privacy policy will promise.",
  },
];

export const outstanding = () => contentGate.filter((i) => !i.resolved);

/** Phase 1 blockers — what stops the marketing site going live. */
export const blockers = () =>
  contentGate.filter(
    (i) => !i.resolved && i.severity === "blocker" && (i.phase ?? 1) === 1,
  );

/** Phase 2 blockers — what stops Leagues opening. Tracked separately. */
export const phase2Blockers = () =>
  contentGate.filter(
    (i) => !i.resolved && i.severity === "blocker" && i.phase === 2,
  );

export const gateSummary = () => {
  const total = contentGate.length;
  const resolved = contentGate.filter((i) => i.resolved).length;
  return {
    total,
    resolved,
    outstanding: total - resolved,
    blockers: blockers().length,
    phase2Blockers: phase2Blockers().length,
    /* Phase 1 only. Leagues opening is a separate event with its own gate — a
       targeting-system question must never hold up a website. */
    launchReady: blockers().length === 0,
    leaguesReady: phase2Blockers().length === 0,
  };
};
