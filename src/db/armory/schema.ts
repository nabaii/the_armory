import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidv7 } from "@/lib/uuidv7";
import {
  APPLICATION_STATUSES,
  BOOKING_STATUSES,
  BOOKING_TYPES,
  CAPTURE_METHODS,
  CUSTODY_EVENT_TYPES,
  DEVICE_SURFACES,
  FIREARM_OWNERSHIPS,
  FIREARM_STATUSES,
  INVITATION_STATUSES,
  LANE_STATUSES,
  LEDGER_DIRECTIONS,
  LICENCE_STATUSES,
  MEMBERSHIP_STATUSES,
  PARTICIPANT_ROLES,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  PROGRAMME_KINDS,
  SESSION_STATUSES,
  SPONSOR_TYPES,
  STAFF_GRANTS,
  STAFF_ROLES,
  DEGRADATION_CAUSES,
  NEAR_MISS_KINDS,
  OPERATING_LEVELS,
  WAITLIST_STATUSES,
} from "@/domain/enums";

/* ============================================================================
   THE ARMORY MANAGEMENT SYSTEM — data model.

   Build Specification §3. Field lists there are the MINIMUM; this file adds
   what the implementation needs and removes nothing.

   ===========================================================================
   WHY THIS LIVES IN ITS OWN POSTGRES SCHEMA

   The database already carries the Phase 2 leagues product (src/db/schema.ts),
   and that product owns two table names this specification also needs:

     · `rounds`    leagues: a round SEQUENCE within a season, deliberately
                   without a timestamp (see the note in src/db/schema.ts).
                   §3.3 here: a scored round fired by one participant.
     · `sessions`  leagues: an authentication session.
                   §3.3 here: a range session opened and closed by staff.

   Renaming either side would be the wrong trade. The leagues names are load
   bearing in a schema built around not leaking an attendance log; the
   specification names are what the build document, the API surface and the
   sync contract all say. So the management system takes a schema of its own
   and both keep their vocabulary. Cross-schema foreign keys are ordinary.

   ===========================================================================
   FOUR PROPERTIES THAT APPLY TO EVERY TABLE BELOW

   1. IDS ARE UUIDv7, GENERATED IN APPLICATION CODE. §2: "generated client-side
      where the record can originate offline… Offline-created records must not
      require a server round trip to obtain an identity." Postgres gained a
      native uuidv7() only in v18 and we will not pin the hosting decision to
      it, so generation lives in TypeScript and runs identically in a browser
      that is offline and on the server. v7 is time-ordered, which also keeps
      index locality that random v4 would throw away.

   2. MONEY IS bigint KOBO. §2: "All amounts stored as integer kobo. Never
      floats." bigint rather than integer because a 32-bit column tops out at
      ₦21,474,836 — plausible for one annual fee, not for a lifetime ledger
      balance or an aggregate. The overflow would appear years in, in the one
      subsystem where a wrong number is never a cosmetic bug.

   3. TIME IS timestamptz, STORED UTC, RENDERED Africa/Lagos. §2. Where a
      record can be written offline it carries BOTH clocks — `occurred_at` is
      what the device believed, `recorded_at` is when the server received it.
      §2 again: "Client-generated timestamps are recorded alongside server
      receipt time, never instead of it." Reconciliation needs the pair; an
      average of the two is worse than either.

   4. APPEND-ONLY IS A DATABASE CONSTRAINT, NOT A CONVENTION. §12 requires that
      append-only tables "reject update and delete at the database level, not
      merely in application code". Those tables are marked APPEND-ONLY in the
      comment above them and are enforced by triggers installed in
      drizzle/0002_armory_enforcement.sql. Adding a table to that set means
      editing that migration too — the marker here is documentation, the
      trigger is the mechanism.
   ========================================================================= */

export const armory = pgSchema("armory");

/** Every primary key in this schema. See property 1 above. */
const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Money. See property 2 above. `mode: number` is exact to 2^53 kobo. */
const kobo = (name: string) => bigint(name, { mode: "number" });

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ============================================================================
   CLUB SETTINGS — the §14 open items, in a row rather than in code

   §14 lists items that are "not structurally blocking" and are the club's to
   decide: the guest overage price, the roster cap, how long a waiver signature
   stays valid, whether on-premises storage is enabled, which disciplines demand
   a club sign-off.

   Every one of them was a constant somewhere before this table existed, and
   each carried the same comment: read this from the pack "so it changes without
   a deploy". That was half true. The DEVICE read it from the pack; the SERVER
   read it from a literal in src/server/sync/daypack-query.ts, so changing the
   club's mind still meant a release — on the afternoon the founder decided,
   which is exactly when nobody wants to ship code.

   ===========================================================================
   ONE ROW, ENFORCED

   A settings table with two rows is a settings table where half the system is
   reading the wrong one, and it is invisible until the two disagree. The unique
   index on the `singleton` column is what makes a second row impossible; the
   column exists only to carry that index.

   ===========================================================================
   NULL MEANS "NOT DECIDED", AND EVERY READER MUST HANDLE IT

   None of these have defaults that would be safe to invent. A guest overage
   price defaulted to zero bills nobody; defaulted to a guess bills a member for
   something the club never agreed. A roster cap defaulted to a number closes
   admissions at it.

   So they are nullable, null means §14 has not landed, and each reader states
   what it does with that — see `overagePriceKobo` in
   src/server/armory/invitations.ts, which raises no charge and refuses no
   guest.
   ========================================================================= */

export const operatingLevel = armory.enum("operating_level", OPERATING_LEVELS);

export const clubSettings = armory.table(
  "club_settings",
  {
    id: id(),
    /**
     * Always true. The unique index below is the whole point of the column.
     *
     * `boolean` rather than a constant integer so the constraint reads as what
     * it is: there is one settings row, and it is this one.
     */
    singleton: boolean("singleton").notNull().default(true),

    /** §14, §8.3. Charged to the HOST — §1.2 rule 5. Null until decided. */
    guestOveragePriceKobo: kobo("guest_overage_price_kobo"),

    /** §3.1, §11 M3. The membership cap admissions are enforced against. */
    rosterCap: integer("roster_cap"),

    /** §3.1. Null means a signature against the active version never expires. */
    waiverValidityDays: integer("waiver_validity_days"),

    /**
     * §10's guest data retention, in days since a person's last visit.
     *
     * Null means **no automatic erasure**, and that is the safe direction for
     * the one setting here whose mistake cannot be undone: erasing on a guessed
     * schedule destroys records the club may be required to hold. §14 has this
     * blocked on counsel.
     *
     * An individual erasure on request is unaffected — that is the obligation
     * with a deadline, and a founder can perform it today. This governs only
     * the sweep. See src/domain/erasure.ts.
     */
    guestRetentionDays: integer("guest_retention_days"),

    /** §13, §14. The on-premises storage workflow sits behind this. */
    storageEnabled: boolean("storage_enabled").notNull().default(false),

    /** §4.2's MAY_SHOOT_DISCIPLINE. Empty means none demand a sign-off. */
    disciplinesRequiringQualification: jsonb(
      "disciplines_requiring_qualification",
    )
      .notNull()
      .default(sql`'[]'::jsonb`),

    /**
     * §14, and Members Portal §12 item 2. How long one booking holds a lane.
     *
     * Null, like everything else here, means the club has not said. It is read
     * by `clubAvailabilityPolicy` and a null produces no slots rather than a
     * guessed hour — see the note on `openingHours` below, which is the same
     * argument and the more consequential half of it.
     */
    sessionMinutes: integer("session_minutes"),

    /**
     * The least notice the club accepts on a booking, in minutes.
     *
     * Distinct from a tier's booking horizon, which is the far end of the same
     * window and belongs to the member rather than to the range. Null defaults
     * to zero notice in the reader — the safe direction here is the permissive
     * one, because the alternative is silently refusing bookings the club would
     * have taken, which nobody would ever see.
     */
    bookingLeadTimeMinutes: integer("booking_lead_time_minutes"),

    /**
     * THE OPERATIONAL BUFFER BETWEEN ONE SESSION AND THE NEXT, IN MINUTES.
     *
     * Decided by the founder, 16 August 2026: a 60-minute session with a
     * 15-minute buffer.
     *
     * =======================================================================
     * IT BELONGS TO THE RANGE, NOT TO THE MEMBER
     *
     * This is the distinction the column exists to hold. The member's session
     * is `session_minutes` and that is what their booking says, what the desk
     * expects and what the lane is theirs for. The buffer is the club's:
     * clearing the line, resetting targets, walking one relay off and briefing
     * the next.
     *
     * So it is NOT added to the booking's length. A member who books 09:00 has
     * a booking that ends at 10:00, and the next bookable slot is 10:15. If the
     * buffer were folded into the session the member would appear to have the
     * lane for 75 minutes, which is not what they were sold and not what the
     * desk would enforce.
     *
     * =======================================================================
     * NULL IS ZERO HERE, AND THAT IS SAFE IN A WAY THE OTHERS ARE NOT
     *
     * Every other unset value in this table produces nothing rather than a
     * guess. This one defaults to no buffer, because zero is a coherent
     * operating decision — back-to-back sessions — and because a club that has
     * not thought about turnaround is describing the behaviour the system had
     * before this column existed. Nothing is invented and nothing silently
     * narrows.
     */
    turnaroundMinutes: integer("turnaround_minutes"),

    /**
     * §7.4's table capacity — SEATS, not lanes.
     *
     *   "A table-only booking consumes no lane; a spectator consumes neither,
     *    but does consume a seat and a name on the arrivals list."
     *
     * Null means the club has not counted its covers, and the reader treats
     * that as "table bookings are not open yet" rather than as unlimited. An
     * unlimited default would let the portal sell a Friday evening the kitchen
     * cannot serve, which is the hospitality equivalent of double-booking a
     * lane and is exactly as embarrassing in front of a guest.
     */
    tableCapacity: integer("table_capacity"),

    /**
     * WHERE THE CLUB IS ON THE DEGRADATION LADDER — Management §6.2.
     *
     * Defaults to `normal`, which is the one default in this table that is a
     * real answer rather than an absence: a club that has said nothing about its
     * operating level is running normally, and treating the unset case as
     * "degraded" would close a range nobody closed.
     *
     * The CURRENT level lives here because every read of it is "what is true
     * right now" and wants no join. The HISTORY lives in
     * `operating_level_events`, and §6.2 is explicit that the history is the
     * point: "the value of this control over a season is the record of why the
     * club degraded".
     */
    operatingLevel: operatingLevel("operating_level").notNull().default("normal"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("club_settings_singleton_key").on(t.singleton)],
);

export const degradationCause = armory.enum("degradation_cause", DEGRADATION_CAUSES);

/**
 * EVERY MOVE OF THE OPERATING LEVEL — Management §6.2, §9.1, §11.3.
 *
 * ===========================================================================
 * THIS TABLE IS THE FEATURE. THE COLUMN ABOVE IS ONLY ITS CURRENT VALUE
 *
 * §6.2: a reason is "not a free-text afterthought — a short required field,
 * because the value of this control over a season is the record of why the club
 * degraded, which is an operational analytic in §11.3 and a staffing argument
 * the founder will otherwise have to make from memory."
 *
 * A club that only stored the current level would be able to answer "are we
 * degraded" and never "how often, and why" — which is the question that decides
 * whether to hire somebody. So the cause is a closed vocabulary that can be
 * counted and the note carries the particulars, and both are mandatory.
 *
 * Append-only, enforced in 0012. A degradation somebody edited afterwards is
 * worth less than one nobody recorded, because it looks trustworthy.
 */
export const operatingLevelEvents = armory.table(
  "operating_level_events",
  {
    id: id(),

    /** Null on the first event, which has nothing before it. */
    fromLevel: operatingLevel("from_level"),
    toLevel: operatingLevel("to_level").notNull(),

    cause: degradationCause("cause").notNull(),
    /** The particulars. §12.1's mandatory reason, with a 12-character floor. */
    note: text("note").notNull(),

    setByStaffId: uuid("set_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    createdAt: createdAt(),
  },
  (t) => [index("operating_level_events_created_idx").on(t.createdAt)],
);

export const nearMissKind = armory.enum("near_miss_kind", NEAR_MISS_KINDS);

/**
 * NEAR-MISSES — Management System §9.2, and S5.
 *
 * ===========================================================================
 * WHAT IS NOT IN THIS TABLE IS THE DESIGN
 *
 * There is no severity, no outcome, no "who was at fault", and no link to a
 * person other than an optional reporter. Each absence is a decision:
 *
 *   no severity   Somebody would argue about it, and arguing about a near-miss
 *                 is how the next one goes unreported. §9.2 wants thirty
 *                 seconds; a severity picker is a judgement call.
 *   no subject    S5. "A reporting surface that is… attributive will produce
 *                 silence." The form has nowhere to put a name because the
 *                 table has nowhere to put one.
 *   no outcome    A near-miss by definition had none. A column for it would
 *                 invite this table to become a second incident register, and
 *                 `incidents` already exists for events that happened.
 *
 * ===========================================================================
 * THE REPORTER IS NULLABLE BECAUSE THEY CHOOSE
 *
 * Founder's decision, 17 August 2026: the reporter chooses per report. Named
 * lets the safety holder ask a follow-up question; anonymous costs the club that
 * conversation and buys a report it would otherwise not have had.
 *
 * Null therefore means "filed anonymously" and never "we lost track of who".
 * Nothing in the application may infer a reporter from a session, a device or a
 * timestamp — an anonymous report that can be de-anonymised is worse than none,
 * because somebody trusted it.
 */
export const nearMissReports = armory.table(
  "near_miss_reports",
  {
    id: id(),

    kind: nearMissKind("kind").notNull(),

    /** What happened. The only narrative field, and it asks what rather than who. */
    whatHappened: text("what_happened").notNull(),

    /** A lane or an area. Never a person. */
    location: text("location"),

    /**
     * Null where the reporter filed anonymously — see the header. `on delete set
     * null` matters more here than elsewhere: a staff member leaving the club
     * must not take their near-miss reports with them, and the reports are worth
     * keeping without them.
     */
    reportedByStaffId: uuid("reported_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    createdAt: createdAt(),
  },
  (t) => [index("near_miss_reports_created_idx").on(t.createdAt)],
);

/* ============================================================================
   OPENING HOURS — Members Portal §12, item 2

   "Opening hours — column, migration, founder screen. Unblocks the availability
    grid, the operating-rhythm feed, the red action. Currently blocks the
    booking calendar entirely."

   ===========================================================================
   WHY THIS IS A TABLE AND NOT A JSONB COLUMN ON club_settings

   It was very nearly the latter — one `opening_hours` document, edited whole,
   no join. Three things argued it out of that shape and the third is decisive.

   1. A period is a row the founder edits, and a founder screen that PUTs a
      whole document loses a concurrent edit silently. Rows do not.
   2. `staffed` is a per-period fact (src/domain/availability.ts is explicit
      about why: §13 keeps the officer rota out of the system, so coverage is
      declared against the hours the club has an officer on the floor). A
      document would carry the same field with none of the constraint.
   3. THE CLUB'S WEEK IS A THING THE DIARY READS, not just something booking
      consumes. §7.3's operating-rhythm feed — "service hours, which evenings
      the deck is lit, closures" — is a query against these rows on a date
      range. Against a jsonb document it is a full parse on every render of
      every member's Diary, and it cannot be indexed.

   ===========================================================================
   AN EMPTY TABLE IS AN HONEST TABLE

   No seed, no default week, no "9 to 5 Monday to Saturday" to be going on
   with. `UNCONFIGURED_AVAILABILITY` in src/domain/availability.ts already sets
   out at length why a plausible default is worse than none: it works, so it
   survives into production and becomes the club's opening hours by accident.
   Zero rows produces zero slots and one honest sentence, which is P2 of the
   Members Portal specification and the shipping state of this screen until the
   founder says otherwise.
   ========================================================================= */

export const openingHours = armory.table(
  "opening_hours",
  {
    id: id(),

    /** 0 = Sunday, matching `Date#getDay` and `lagosParts().weekday`. */
    weekday: smallint("weekday").notNull(),

    /** Minutes since Lagos midnight. 09:00 is 540. */
    opensMinute: integer("opens_minute").notNull(),
    closesMinute: integer("closes_minute").notNull(),

    /**
     * Whether an officer is on the floor for this period.
     *
     * An unstaffed period yields NO shooting slots and still appears in the
     * Diary's programme — the deck can be open on an evening the range is not,
     * and a club that could not say so would be a booking tool with a calendar
     * bolted on. See `OpeningPeriod` in src/domain/availability.ts.
     */
    staffed: boolean("staffed").notNull().default(true),

    /**
     * What this period IS, in the club's own words — "Range and deck",
     * "Deck and kitchen only". Rendered in the Diary; never parsed.
     */
    label: text("label"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("opening_hours_weekday_idx").on(t.weekday),
    /* One period may not be entered twice for the same weekday and start. Two
       identical periods would double every slot they produce. */
    uniqueIndex("opening_hours_period_key").on(t.weekday, t.opensMinute),
  ],
);

/* ============================================================================
   SERVICE HOURS — Management System Design Specification §7.1, finding F3

   "Service hours are separate from range hours and this is the point. A club
    that can only express when the range is open cannot express a Thursday
    evening where the kitchen serves and nobody shoots — which is the exact
    behaviour the business depends on."

   ===========================================================================
   THE CLUB COULD SAY THIS AND COULD NOT MODEL IT

   `opening_hours.label` above holds "Deck and kitchen only" and its own comment
   says it is never parsed. Table availability ran the entire opening day
   against one global cover count. So the schema permitted a member to book a
   table at 09:15 on a day the kitchen opens at noon — the same failure
   `club_settings.table_capacity` exists to prevent, arriving through the time
   dimension rather than the capacity one.

   ===========================================================================
   ITS OWN TABLE, NOT A COLUMN ON opening_hours

   A `serving` boolean on an opening period was the cheaper shape and was
   rejected on a mechanism the slot grid makes plain. A kitchen serving
   12:00–15:00 inside a 09:00–18:00 range day would have to be expressed by
   splitting that day into three opening periods — and the grid restarts at
   every period boundary, so splitting for the kitchen's sake would silently
   forbid any shooting session spanning noon. Service hours have to cut across
   the range's day without perturbing it.

   ===========================================================================
   AN EMPTY TABLE IS AN HONEST TABLE, AGAIN

   No seed and no default. Zero rows means the club has not said when it serves,
   which `availableTables` reads as "no covers bookable" and `emptyTableReason`
   renders as a sentence naming the missing decision. The founder has not
   settled kitchen hours; that is registered in src/lib/content-gate.ts as
   `kitchen-hours` rather than guessed here.
   ========================================================================= */

export const serviceHours = armory.table(
  "service_hours",
  {
    id: id(),

    /** 0 = Sunday, matching `opening_hours` and `Date#getDay`. */
    weekday: smallint("weekday").notNull(),

    /** Minutes since Lagos midnight. 12:00 is 720. */
    opensMinute: integer("opens_minute").notNull(),
    closesMinute: integer("closes_minute").notNull(),

    /**
     * What is being served — "Lunch", "Kitchen and bar", "Bar only".
     *
     * Rendered in the Diary beside the operating rhythm; never parsed. The
     * same rule as `opening_hours.label`, and for the same reason: the moment a
     * label carries meaning the club has a second, undocumented vocabulary.
     */
    label: text("label"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("service_hours_weekday_idx").on(t.weekday),
    uniqueIndex("service_hours_period_key").on(t.weekday, t.opensMinute),
  ],
);

/* ============================================================================
   THE PROGRAMME — Members Portal §7.3 feed three, §12 item 5

   "There is no events entity anywhere in the eleven milestones. A club whose
    system can record a firearm custody event to forensic standard but cannot
    record that the kitchen is open on Friday has, at the level of its schema,
    told the truth about what it thinks it is."

   This is the one-off feed. The other two Diary feeds are derived and no rows
   are written for them: the operating rhythm comes from `opening_hours` above,
   and fixtures come from the leagues product in the public schema. Copying
   either into this table would create a second source of truth for a fact the
   club already holds — and the first one to drift would be a member arriving
   for a league round that had moved.
   ========================================================================= */

export const programmeKind = armory.enum("programme_kind", PROGRAMME_KINDS);

export const events = armory.table(
  "events",
  {
    id: id(),

    kind: programmeKind("kind").notNull().default("event"),

    /** Rendered as written. The club's voice, not a formatted string. */
    title: text("title").notNull(),
    /** One or two sentences at most. Optional — a title is often the whole fact. */
    detail: text("detail"),

    /**
     * The Lagos calendar day this sits on.
     *
     * A `date` rather than a pair of timestamps because the Diary is a day
     * view: a member asks what is on this Thursday, not what is on between
     * 18:00 and 22:00 on this Thursday. The times below refine it where they
     * are known and are null where the club has said only "Saturday".
     */
    onDate: date("on_date").notNull(),

    /** Minutes since Lagos midnight, as `opening_hours`. Null means all day. */
    startsMinute: integer("starts_minute"),
    endsMinute: integer("ends_minute"),

    /**
     * Whether members see it.
     *
     * Default false. The founder drafts a guest evening three weeks out and
     * decides later whether it is happening; a draft that appeared in every
     * member's Diary the moment it was typed would make the club look
     * disorganised in the surface it is most often judged by.
     */
    published: boolean("published").notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("events_date_idx").on(t.onDate),
    index("events_published_idx").on(t.published, t.onDate),
  ],
);

/* ============================================================================
   3.1 PEOPLE AND STANDING
   ========================================================================= */

/**
 * ONE ROW PER HUMAN.
 *
 * §3.1: "applicant, guest and member are states, not separate tables." This is
 * the single most consequential shape decision in the model. A guest table
 * would have to be merged into a member table at the exact moment the club
 * cares most — conversion — and every visit-history join would need to know
 * which table a person used to be in. Here, admission changes what rows point
 * AT a person; it never moves the person.
 */
export const people = armory.table(
  "people",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),

    /**
     * E.164, unique. The club's primary channel is WhatsApp (§9) and OTP is
     * sent by SMS, so the phone number is the account identifier — email is
     * optional and secondary, which is the reverse of the leagues product.
     */
    phone: text("phone").notNull(),
    email: text("email"),

    /** Required before a person may shoot; collected on the guest link (§6.3). */
    dateOfBirth: date("date_of_birth"),

    /** Object storage key, never a public URL. §10: signed, expiring URLs only. */
    photoUrl: text("photo_url"),
    address: text("address"),

    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),

    notes: text("notes"),

    /**
     * §10, guest data: "A guest who does not join has provided data for a
     * single visit… build the deletion path now." Erasure anonymises in place
     * rather than deleting the row, because participations, custody events and
     * incidents reference it and those are append-only by law and by §3.
     */
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("people_phone_key").on(t.phone),
    index("people_last_name_idx").on(t.lastName),
  ],
);

/**
 * THE PERMISSION MATRIX. §1.2 rule 4: "Tier is a permission matrix evaluated
 * by code, never a label rendered on a page."
 *
 * §3.1 is explicit that these are columns and not a JSON blob, and the reason
 * is enforcement: the capability service (§4) reads these, the availability
 * query filters on them, and the dashboard aggregates them. A blob is none of
 * queryable, constrainable, or indexable.
 */
export const tiers = armory.table(
  "tiers",
  {
    id: id(),
    name: text("name").notNull(),

    monthlyFeeKobo: kobo("monthly_fee_kobo"),
    annualFeeKobo: kobo("annual_fee_kobo"),

    /* --- Hosting. The acquisition funnel; see §3.2. --------------------- */
    canHost: boolean("can_host").notNull().default(false),
    guestAllowanceAnnual: integer("guest_allowance_annual").notNull().default(0),
    guestConcurrentMax: integer("guest_concurrent_max").notNull().default(0),

    /* --- Property. Gated further by a verified licence; see `licences`. -- */
    canOwnFirearm: boolean("can_own_firearm").notNull().default(false),
    canStoreFirearm: boolean("can_store_firearm").notNull().default(false),

    /**
     * Disciplines this tier may shoot. A Postgres text[] rather than a join
     * table: it is a small closed set read on every capability evaluation, and
     * `discipline_access @> ARRAY['...']` is both indexable and constrainable.
     */
    disciplineAccess: text("discipline_access")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    /** How far ahead this tier may book, in days. §4 MAY_BOOK. */
    bookingHorizonDays: integer("booking_horizon_days").notNull().default(14),
    concurrentBookingsMax: integer("concurrent_bookings_max").notNull().default(1),

    /**
     * Whether a membership of this tier may be attached to a principal one —
     * the Partner case. See `memberships.principalMembershipId`.
     */
    isAttachable: boolean("is_attachable").notNull().default(false),

    sortOrder: smallint("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tiers_name_key").on(t.name)],
);

export const membershipStatus = armory.enum("membership_status", MEMBERSHIP_STATUSES);

export const memberships = armory.table(
  "memberships",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => tiers.id, { onDelete: "restrict" }),

    /**
     * §3.1: "unique, sequential, never reused." Allocated by a Postgres
     * sequence, not by MAX()+1 — the latter races, and a reissued member
     * number is a permanent ambiguity in the custody log and in the club's
     * own paper records.
     *
     * The default is declared here as well as attached in
     * drizzle/0002_armory_enforcement.sql, so that inserting a membership does
     * not have to supply one. Without this the column is required at the type
     * level, and the only way to satisfy it in application code is the MAX()+1
     * the sequence exists to prevent — the type system would have quietly
     * argued for the bug.
     */
    memberNumber: integer("member_number")
      .notNull()
      .default(sql`nextval('armory.member_number_seq')`),

    status: membershipStatus("status").notNull().default("pending"),
    isFounding: boolean("is_founding").notNull().default(false),

    /**
     * Set only on an attached (Partner) membership. §5: "A Partner membership
     * cannot outlive its principal" — enforced by trigger, because a lapsed
     * principal with a still-active partner is a free membership that nobody
     * notices for a year.
     */
    principalMembershipId: uuid("principal_membership_id"),

    startedOn: date("started_on"),
    renewsOn: date("renews_on"),
    endedOn: date("ended_on"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_member_number_key").on(t.memberNumber),
    index("memberships_person_idx").on(t.personId),
    index("memberships_status_idx").on(t.status),
    index("memberships_principal_idx").on(t.principalMembershipId),
  ],
);

export const sponsorType = armory.enum("sponsor_type", SPONSOR_TYPES);

export const applicationStatus = armory.enum("application_status", APPLICATION_STATUSES);

export const applications = armory.table(
  "applications",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),

    /**
     * `club` is the public-site route (§6.1, "One live form, writing an
     * application at sponsor_type = club"); `member` is a member putting a
     * former guest forward (§6.2, Sponsor an application). The distinction is
     * the whole conversion metric on the founder's dashboard (§6.6).
     */
    sponsorType: sponsorType("sponsor_type").notNull(),
    sponsorMembershipId: uuid("sponsor_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),

    requestedTierId: uuid("requested_tier_id").references(() => tiers.id, {
      onDelete: "set null",
    }),

    status: applicationStatus("status").notNull().default("submitted"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * WHO IS CARRYING THIS APPLICATION — Management §8.2.
     *
     * =======================================================================
     * IT IS NOT `decided_by_staff_id`, AND CONFLATING THEM WAS THE DEFECT
     *
     * §8.2: "*Applications land somewhere nobody owns* is on the blocker
     * register… What the software can do is make ownerlessness impossible to
     * ignore: every application carries a named owner and an age, and an
     * application with no owner appears on the founder's DAY until it has one."
     *
     * `decided_by_staff_id` below records who CLOSED an application. It is null
     * for every OPEN one by definition — which is exactly the set the queue is
     * about — so reading it as ownership reports a queue in which every live
     * application is unowned and every dead one is owned. Precisely backwards,
     * and it would have looked like data.
     *
     * Nullable, and null is the honest state rather than a gap to be filled by
     * a default. §8.2 is explicit that the underlying problem "is a staffing
     * decision rather than a software one": assigning a rota, or defaulting to
     * whoever happens to hold `people_write`, would produce a column that always
     * has a value and never has an owner. The screen renders null as "Nobody",
     * in red, and the founder's DAY carries it until a person is named.
     */
    ownerStaffId: uuid("owner_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    decidedByStaffId: uuid("decided_by_staff_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("applications_status_idx").on(t.status),
    index("applications_person_idx").on(t.personId),
  ],
);

export const waitlistStatus = armory.enum("waitlist_status", WAITLIST_STATUSES);

export const waitlistEntries = armory.table(
  "waitlist_entries",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),

    /**
     * §3.1: "position maintained server-side. Never derived from a client
     * sort." A waitlist is a promise about fairness; a position that can be
     * reordered by whatever order a list happened to arrive in is not one.
     */
    position: integer("position").notNull(),

    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    status: waitlistStatus("status").notNull().default("waiting"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("waitlist_application_key").on(t.applicationId),
    index("waitlist_position_idx").on(t.position),
  ],
);

export const waiverVersions = armory.table(
  "waiver_versions",
  {
    id: id(),
    version: text("version").notNull(),
    body: text("body").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),

    /** §3.1: "Exactly one active version at a time." Partial unique index. */
    isActive: boolean("is_active").notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("waiver_versions_version_key").on(t.version)],
);

/**
 * APPEND-ONLY. §3.1: "No update, no delete. A resignature is a new row."
 *
 * A waiver signature is the club's evidence that a named person accepted a
 * named version of a document at a named moment. Every part of that sentence
 * is destroyed by an UPDATE, which is why the prohibition is a trigger and not
 * a code review comment.
 */
export const waiverSignatures = armory.table(
  "waiver_signatures",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    waiverVersionId: uuid("waiver_version_id")
      .notNull()
      .references(() => waiverVersions.id, { onDelete: "restrict" }),

    /** Object storage key. §10: private bucket, signed expiring URLs only. */
    signatureImageUrl: text("signature_image_url"),

    /** What the signing device believed. May be written offline. */
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    deviceId: uuid("device_id"),
    /** When the server received it. Both clocks, always. See property 3. */
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("waiver_signatures_person_idx").on(t.personId),
    index("waiver_signatures_version_idx").on(t.waiverVersionId),
  ],
);

/**
 * Club competency, explicitly distinct from a licence (§3.1).
 *
 * A licence is the state's permission to own a firearm. A qualification is the
 * club's judgement that this person may shoot this discipline unsupervised.
 * They expire independently and gate different capabilities — conflating them
 * would let a licence renewal silently re-grant a competency nobody reassessed.
 */
export const qualifications = armory.table(
  "qualifications",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    discipline: text("discipline").notNull(),
    level: text("level").notNull(),
    assessedByStaffId: uuid("assessed_by_staff_id"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("qualifications_person_idx").on(t.personId),
    index("qualifications_expiry_idx").on(t.expiresAt),
  ],
);

export const licenceStatus = armory.enum("licence_status", LICENCE_STATUSES);

export const licences = armory.table(
  "licences",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    licenceNumber: text("licence_number").notNull(),
    issuingAuthority: text("issuing_authority").notNull(),

    /** Calibres the licence covers. MAY_USE_OWN_FIREARM checks membership. */
    calibres: text("calibres")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),

    /**
     * Object storage key. §10: "readable only by the founder role. Not by
     * range officers. Not on the desk or lane surfaces." The key is therefore
     * deliberately absent from the day pack (§8.1).
     */
    documentUrl: text("document_url"),

    /** §3.1: "Capability activates only on verified." */
    status: licenceStatus("status").notNull().default("pending_review"),
    verifiedByStaffId: uuid("verified_by_staff_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("licences_person_idx").on(t.personId),
    index("licences_expiry_idx").on(t.expiresOn),
    uniqueIndex("licences_number_key").on(t.licenceNumber),
  ],
);

/**
 * A MEMBER'S PASSWORD — the portal sign-in for people the club already knows.
 *
 * ===========================================================================
 * WHY A CREDENTIAL TABLE AND NOT A COLUMN ON `people`
 *
 * Three reasons, and the third is the one that would have bitten.
 *
 * A password is a property of an ACCOUNT, not of a human. §3.1 makes `people`
 * the club's record of a person — applicant, guest or member — and most rows in
 * it will never have a credential at all. A guest who shot once has a person
 * row and no business having a password column.
 *
 * The throttle needs columns of its own (`failed_count`, `locked_until`), and
 * putting authentication state on `people` would mean a failed sign-in writing
 * to the table the desk reads to check somebody in.
 *
 * And §10's erasure redacts `people` IN PLACE. `src/domain/erasure.ts` carries
 * a test that every column of `people` is classified as identifying or
 * retained, so a password column added there would have to be classified — and
 * "retained" would leave a working credential on an erased person while the
 * erasure reported success. A separate table is deleted outright by
 * `erasePerson`, which is the unambiguous answer.
 *
 * ===========================================================================
 * THIS IS AN INTERIM CREDENTIAL. §9 WANTS OTP.
 *
 *   §9, SMS: "One-time passcodes only. A Nigerian provider with acceptable
 *    delivery rates. Test on all major local networks before launch; THIS IS
 *    THE FRONT DOOR TO EVERY ACCOUNT."
 *   §7: "POST /auth/otp/request, /auth/otp/verify"
 *
 * The specification's intended sign-in is a one-time passcode by SMS, and no
 * SMS provider is configured yet (docs/M10_security_review.md lists it). A
 * password is what lets the club test the member portal end to end before that
 * lands, and it is deliberately built so it can be switched off rather than
 * unpicked: nothing else in the system reads this table, and deleting every row
 * in it disables password sign-in without touching a person, a membership or a
 * session.
 *
 * When OTP arrives, this table is dropped or left dormant. It is not a
 * foundation anything else is built on.
 */
export const memberCredentials = armory.table(
  "member_credentials",
  {
    id: id(),

    /**
     * One credential per person, and the unique index is what enforces it.
     *
     * `cascade` because a credential without a person is not a credential —
     * unlike most references in this schema, there is nothing here worth
     * keeping for its own sake and nothing an audit would want to read later.
     * The audit row for a sign-in lives in `audit_log`, which is append-only.
     */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),

    /** `scrypt:<salt>:<key>`. See src/server/armory/kdf.ts. */
    passwordHash: text("password_hash").notNull(),

    /**
     * True while the member is still on a password somebody else chose.
     *
     * A founder setting a password for a member to test with, or resetting one
     * for a member who forgot, is handing over a secret that two people now
     * know. The portal asks them to change it; until they do, this says so.
     */
    mustChange: boolean("must_change").notNull().default(true),

    /* The throttle. Mirrors `staff_users` — see the note there on why a lockout
       that triggers on ordinary human error is a lockout that gets designed
       around. */
    failedCount: integer("failed_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("member_credentials_person_key").on(t.personId)],
);

export const staffRole = armory.enum("staff_role", STAFF_ROLES);

/**
 * §10: "No shared logins. Every staff action attributable to a named person…
 * Shared accounts destroy the attribution the custody log exists to provide."
 *
 * A staff user is a person who also holds a role — not a separate identity.
 * The same rule as guests: roles are states of a person, not another table of
 * humans.
 */
export const staffUsers = armory.table(
  "staff_users",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    role: staffRole("role").notNull(),

    /**
     * The short local unlock (§10), not a password. Hashed with a memory-hard
     * KDF and a per-user salt — a four-to-six digit PIN has so little entropy
     * that a fast hash would be trivially reversed from a database dump.
     */
    pinHash: text("pin_hash"),

    certifications: text("certifications")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    active: boolean("active").notNull().default(true),

    /**
     * PIN throttling. A six-digit PIN is a million guesses, and an attacker
     * holding the tablet has physical access and unlimited time — so how fast
     * they may try is the only thing protecting a named officer's identity.
     *
     * Persisted rather than held in memory because the desk is a PWA that can
     * be force-quit between attempts, and an in-process counter resets when the
     * app is closed. That is not a hypothetical attack; it is the obvious one.
     */
    pinFailedCount: integer("pin_failed_count").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_users_person_key").on(t.personId),
    index("staff_users_role_idx").on(t.role),
  ],
);

export const staffGrant = armory.enum("staff_grant", STAFF_GRANTS);

/**
 * WHAT A MEMBER OF STAFF MAY DO — Management System §5, §18.
 *
 * §5.1: "Separation of duties becomes visible, and refused rather than trusted…
 * Generated into the navigation, they are facts. A person holding armoury
 * custody does not see LEDGER — not because it is hidden, but because
 * capability refuses it. And the system refuses the role assignment itself at
 * the point it is made."
 *
 * ===========================================================================
 * WHY THIS IS A TABLE AND NOT MORE COLUMNS ON staff_users
 *
 * `staff_users.role` is a single value and stays what it always was: the club's
 * org chart, and the way `apply-credentials.ts` and `permits.ts` resolve the
 * founder. It cannot carry authority, for three reasons that are all the same
 * reason — a role is a label and authority has a lifetime.
 *
 * 1. A GRANT EXPIRES. §4.3's console hand-off assumes a duty manager exists to
 *    hand off to; on a real understaffed evening there is not one. The failure
 *    is not that the club is blocked, it is that somebody is given a PERMANENT
 *    grant to solve a TEMPORARY problem and nobody takes it back. `expires_at`
 *    is the whole fix, and a column on `staff_users` could not hold it.
 *
 * 2. A GRANT IS ATTRIBUTED. §12.1 lists role assignment among the actions that
 *    must always carry a reason. Who granted it, when, and why is the register
 *    that makes the founder exception visible — and it has to be a row.
 *
 * 3. A GRANT IS REVOKED, NOT DELETED. A deleted row is a separation that was
 *    crossed and then tidied away. `revoked_at` keeps the history, which is
 *    what an auditor is actually asking for.
 *
 * ===========================================================================
 * THE FORBIDDEN COMBINATIONS ARE NOT ENFORCED HERE, AND CANNOT BE
 *
 * §12 asks for database-level enforcement wherever it is possible, and 0002
 * delivers it for the append-only tables. This is the case where it is not
 * possible honestly: S3 forbids a SET — custody together with ledger — and a
 * row constraint cannot see a set. A trigger counting sibling rows could, and
 * would be a second implementation of `refuseCombination` in PL/pgSQL, which
 * is the duplication the README's warning about `firearms.status` exists to
 * discourage. One rule, in src/domain/grants.ts, called by the one server
 * module that writes here.
 */
export const staffGrants = armory.table(
  "staff_grants",
  {
    id: id(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),

    grant: staffGrant("grant").notNull(),

    /**
     * Null only where the club bootstrapped itself — the founder's own first
     * grants have nobody to attribute them to. Every later row names a person.
     */
    grantedByStaffId: uuid("granted_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    /** §12.1. Mandatory, and `decideGrant` refuses anything under 12 characters. */
    reason: text("reason").notNull(),

    /**
     * When an acting grant lapses. Null is a standing grant.
     *
     * Read against the clock on every request rather than swept by a job. §15
     * requires capability to be "re-evaluated per request, not per session", and
     * a swept column would mean an acting grant expiring whenever the sweep next
     * ran — which on the evening it matters is not when it was promised to.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByStaffId: uuid("revoked_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    createdAt: createdAt(),
  },
  (t) => [
    index("staff_grants_staff_idx").on(t.staffUserId),
    index("staff_grants_expiry_idx").on(t.expiresAt),
    /**
     * One LIVE row per person per grant.
     *
     * Partial on `revoked_at IS NULL`, so the history of a grant given, taken
     * back and given again is kept — which is exactly the sequence a register
     * exists to show — while the same authority cannot be held twice at once.
     */
    uniqueIndex("staff_grants_live_key")
      .on(t.staffUserId, t.grant)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const deviceSurface = armory.enum("device_surface", DEVICE_SURFACES);

/**
 * §3.1: "Desk and lane surfaces load only on a registered, unrevoked device."
 * §10: "A lost or stolen tablet can be revoked server-side, and its cached day
 * pack rendered unusable on next launch."
 *
 * That second sentence is the one with teeth. The day pack (§8.1) is a full
 * copy of the roster, the firearm register and every expected arrival, sitting
 * in IndexedDB on a tablet that lives in a public building. Revocation has to
 * reach it, so the client checks registration on every launch and wipes local
 * state when the server says the device is gone.
 */
export const devices = armory.table(
  "devices",
  {
    id: id(),
    label: text("label").notNull(),
    surface: deviceSurface("surface").notNull(),
    registeredByStaffId: uuid("registered_by_staff_id").references(
      () => staffUsers.id,
      { onDelete: "set null" },
    ),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /**
     * The device's bearer credential, HASHED. See
     * drizzle/0003_device_tokens.sql for the full reasoning.
     *
     * Without a secret on this table, `devices` can name a device but not
     * authenticate one — and GET /sync/daypack returns the roster, the firearm
     * register and every guest invitation in the window. Knowing a device UUID,
     * which every pushed record carries, would be enough to fetch all of it.
     *
     * SHA-256 with no KDF, deliberately, and the one thing here worth arguing
     * about. `pinHash` above needs a memory-hard KDF because a four-digit PIN
     * has almost no entropy. This is 256 bits from a CSPRNG, so there is nothing
     * to grind — and it is verified on every sync from a range floor, where a
     * deliberately slow hash is paid for by the officer waiting for the desk.
     *
     * No expiry. §10's "short local unlock" protects the SESSION; this
     * identifies the DEVICE, and a device forced to re-authenticate on a
     * schedule would stop working during exactly the multi-day outage §8 exists
     * to survive. Revocation is how a device stops being trusted, and
     * src/offline/device.ts bounds how long one can go without hearing it.
     */
    tokenHash: text("token_hash"),
    tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("devices_surface_idx").on(t.surface),
    /**
     * Lookup is by hash: the device presents a token, the server hashes it and
     * finds the row.
     *
     * Unique because two devices sharing a credential would make §10's
     * per-device revocation meaningless and every custody event's attribution a
     * guess. Partial, so rows predating the token — and any device registered
     * but not yet issued one — do not collide on NULL.
     */
    uniqueIndex("devices_token_hash_key")
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} IS NOT NULL`),
  ],
);

/**
 * §10: "No shared logins. Every staff action attributable to a named person.
 * Device-bound sessions with a short local unlock."
 *
 * Both halves of that sentence are columns here. `deviceId` is the binding — a
 * staff session exists only on a device the founder registered, so a stolen
 * credential is worth nothing off the tablet it was unlocked on, and revoking
 * the device ends every session on it. `expiresAt` is the shortness: a shift,
 * not a fortnight.
 *
 * ===========================================================================
 * WHY A TABLE RATHER THAN A SIGNED TOKEN
 *
 * A stateless token cannot be revoked, and revocability is the entire posture
 * of §10 — the founder must be able to end a session for a tablet left in a
 * car. A signed token would stay valid until its own expiry no matter what the
 * founder did, which would make device revocation a promise the system could
 * not keep during exactly the window that matters.
 *
 * The cost is one lookup per authenticated request. The club has a handful of
 * tablets; this will never be the query that is the problem.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT YET SOLVE
 *
 * Unlocking OFFLINE. A tablet with no network cannot reach this table, and §8
 * requires the desk to work fully offline. The shape that resolves it is in
 * docs/M1_offline_acceptance.md: the officer signs in once while online, and
 * the local unlock re-verifies only that one officer's cached verifier for the
 * length of the shift. This table is the online half and the thing that half
 * has to agree with. The offline half is M5, with the desk.
 */
export const staffSessions = armory.table(
  "staff_sessions",
  {
    id: id(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),

    /**
     * The device this session is bound to. Cascade, not set null: a session
     * whose device is gone is not a session, it is a floating credential.
     */
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),

    /**
     * SHA-256 of the session token, hex. The same reasoning as
     * `devices.tokenHash`: 256 bits from a CSPRNG has nothing to grind, so no
     * KDF — and a database dump must not hand anyone a working session.
     */
    tokenHash: text("token_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when the officer signs out, or when the founder ends it. */
    endedAt: timestamp("ended_at", { withTimezone: true }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("staff_sessions_token_hash_key").on(t.tokenHash),
    index("staff_sessions_staff_idx").on(t.staffUserId),
    index("staff_sessions_device_idx").on(t.deviceId),
    index("staff_sessions_expiry_idx").on(t.expiresAt),
  ],
);

/* ============================================================================
   3.2 HOSTING

   §3.2: "This cluster is the acquisition funnel. Treat its correctness as
   equal in importance to the firearm register."
   ========================================================================= */

/**
 * §3.2: "One row per membership per period. used_count is authoritative and
 * mutated only server-side, inside a transaction."
 *
 * This table is the named defect in §8.3. Two devices can both believe an
 * allowance has room. The resolution is not optimistic locking or a CRDT — it
 * is that this counter is only ever moved by the server, in the same
 * transaction as the invitation that moves it, and that the desk's offline
 * path is an explicit recorded override rather than a second writer.
 */
export const hostAllowances = armory.table(
  "host_allowances",
  {
    id: id(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),

    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    includedQuota: integer("included_quota").notNull().default(0),
    usedCount: integer("used_count").notNull().default(0),
    overageCount: integer("overage_count").notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("host_allowances_period_key").on(t.membershipId, t.periodStart),
    index("host_allowances_membership_idx").on(t.membershipId),
  ],
);

export const invitationStatus = armory.enum("invitation_status", INVITATION_STATUSES);

export const guestInvitations = armory.table(
  "guest_invitations",
  {
    id: id(),
    hostMembershipId: uuid("host_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),

    /**
     * Nullable until the guest completes the link. The host names a guest by
     * phone; the person row is created when they fill it in, so a cancelled
     * invitation leaves no half-built human behind.
     */
    guestPersonId: uuid("guest_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id"),

    /**
     * §3.2: "unique, single-use, expiring." Stored HASHED — the raw token
     * exists only in the WhatsApp message. This is the same reasoning as the
     * leagues auth tokens: the token is a bearer credential granting access to
     * a form that collects a date of birth and an emergency contact, and a
     * database dump must not hand anyone a working link.
     */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    status: invitationStatus("status").notNull().default("issued"),

    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    /**
     * Whether this visit consumes allowance or bills the host as overage.
     * §1.2 rule 5: "Money from a guest visit lands on the host. A guest never
     * transacts with the club."
     */
    isChargeable: boolean("is_chargeable").notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("guest_invitations_token_key").on(t.tokenHash),
    index("guest_invitations_host_idx").on(t.hostMembershipId),
    index("guest_invitations_booking_idx").on(t.bookingId),
    index("guest_invitations_status_idx").on(t.status),
  ],
);

/**
 * §3.2: "Counts across all hosts, not per host. Drives the conversion prompt."
 *
 * A maintained table rather than a view, because the desk reads it offline out
 * of the day pack and a materialised view cannot be shipped to IndexedDB. The
 * across-all-hosts rule is the point: someone brought four times by four
 * different members is the club's warmest prospect and would be invisible to
 * any per-host count.
 */
export const guestVisitSummary = armory.table(
  "guest_visit_summary",
  {
    personId: uuid("person_id")
      .primaryKey()
      .references(() => people.id, { onDelete: "cascade" }),
    visitCount: integer("visit_count").notNull().default(0),
    firstVisitAt: timestamp("first_visit_at", { withTimezone: true }),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    distinctHostCount: integer("distinct_host_count").notNull().default(0),
    convertedMembershipId: uuid("converted_membership_id").references(
      () => memberships.id,
      { onDelete: "set null" },
    ),
    updatedAt: updatedAt(),
  },
  (t) => [index("guest_visit_summary_count_idx").on(t.visitCount)],
);

/* ============================================================================
   3.3 ACTIVITY
   ========================================================================= */

export const laneStatus = armory.enum("lane_status", LANE_STATUSES);

export const lanes = armory.table(
  "lanes",
  {
    id: id(),
    discipline: text("discipline").notNull(),
    number: integer("number").notNull(),
    status: laneStatus("status").notNull().default("available"),
    positionCapacity: integer("position_capacity").notNull().default(1),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("lanes_discipline_number_key").on(t.discipline, t.number)],
);

export const bookingStatus = armory.enum("booking_status", BOOKING_STATUSES);
export const bookingType = armory.enum("booking_type", BOOKING_TYPES);

export const bookings = armory.table(
  "bookings",
  {
    id: id(),

    /**
     * §3.3: "Only a member may hold a booking." Not a person — a membership.
     * The column type is the rule: there is no way to express a guest holding
     * a booking, so no code path can accidentally create one.
     */
    hostMembershipId: uuid("host_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),

    bookingDate: date("booking_date").notNull(),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    slotEnd: timestamp("slot_end", { withTimezone: true }).notNull(),

    /**
     * Members Portal §7.4. What the member is coming in for.
     *
     * Defaulted to `shoot` so every booking written before this column existed
     * is what it always was, rather than becoming null and forcing every reader
     * to decide what a booking with no purpose means.
     *
     * The vocabulary and what each type consumes are set out on `BOOKING_TYPES`
     * in src/domain/enums.ts; the arithmetic is in src/domain/availability.ts.
     */
    bookingType: bookingType("booking_type").notNull().default("shoot"),

    /**
     * Null for a booking that touches no firing line.
     *
     * This nullability IS §7.4's design rule, expressed as a constraint: a
     * table-only or spectating booking must not be able to name a discipline,
     * because a discipline on a booking that consumes no lane is how the
     * availability query starts counting people who are not shooting against
     * the range's capacity. The CHECK in drizzle/0008 makes the pairing
     * mandatory in both directions.
     */
    discipline: text("discipline"),

    status: bookingStatus("status").notNull().default("draft"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_date_idx").on(t.bookingDate),
    index("bookings_host_idx").on(t.hostMembershipId),
    index("bookings_status_idx").on(t.status),
  ],
);

export const participantRole = armory.enum("participant_role", PARTICIPANT_ROLES);

export const bookingParticipants = armory.table(
  "booking_participants",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    role: participantRole("role").notNull(),

    /**
     * §3.3: "Every guest_shooter must carry a guest_invitation_id." Enforced
     * as a CHECK constraint, not in application code — this is the join
     * between the acquisition funnel and the door, and an unattributed guest
     * is both a lost conversion metric and a person nobody authorised.
     */
    guestInvitationId: uuid("guest_invitation_id").references(
      () => guestInvitations.id,
      { onDelete: "restrict" },
    ),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("booking_participants_key").on(t.bookingId, t.personId),
    index("booking_participants_person_idx").on(t.personId),
  ],
);

export const sessionStatus = armory.enum("session_status", SESSION_STATUSES);

export const sessions = armory.table(
  "sessions",
  {
    id: id(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    sessionDate: date("session_date").notNull(),

    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedByStaffId: uuid("opened_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByStaffId: uuid("closed_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    status: sessionStatus("status").notNull().default("open"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sessions_date_idx").on(t.sessionDate),
    index("sessions_status_idx").on(t.status),
  ],
);

/**
 * APPEND-ONLY ON CHECK-IN. §3.3.
 *
 * The one permitted mutation is setting `checked_out_at` once, from null. That
 * is enforced by trigger rather than trusted: everything else about a
 * participation — who, when, under whose hosting, on which lane, at what tier
 * — is the club's record that a named person was on a live range, and it is
 * the row an incident investigation starts from.
 */
export const participations = armory.table(
  "participations",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    role: participantRole("role").notNull(),

    /**
     * §3.3: "required when role is guest_shooter." The host-presence rule in
     * §4 GUEST_MAY_ATTEND is evaluated against this. CHECK-constrained.
     */
    hostPersonId: uuid("host_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),

    laneId: uuid("lane_id").references(() => lanes.id, { onDelete: "set null" }),

    /**
     * §3.3: "records the tier as at the visit — never join to the live tier
     * for historical reporting."
     *
     * A snapshot of the permission matrix, not the tier id. A tier's fees and
     * allowances change; the founder's occupancy-by-tier report for last March
     * must not silently rewrite itself when they do.
     */
    tierSnapshot: jsonb("tier_snapshot"),

    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull(),

    /**
     * WHEN THE OFFICER STARTED — Management §11.4, and the fifteen seconds.
     *
     * =======================================================================
     * THE CLUB'S CENTRAL OPERATING PROMISE WAS UNMEASURED
     *
     * The fifteen-second check-in appears in four documents as a design
     * constraint. The whole members portal is arranged to protect it, the
     * management specification judges every feature against it, and nothing
     * anywhere measured it — so every claim that this software reduces desk
     * work was an assertion rather than a number.
     *
     * The specification budgeted two fields for this. It needed one:
     * `checked_in_at` above has always recorded the COMPLETION. What was
     * missing is the start — the moment the officer opened the sheet on a
     * person already standing at the desk.
     *
     * =======================================================================
     * NULLABLE, AND FAILING TO MEASURE MUST NEVER FAIL A CHECK-IN
     *
     * Null means unmeasured, not zero. Two reasons, and the second is the
     * important one:
     *
     *   Every participation written before this column existed has no start,
     *   and back-filling one would invent a duration.
     *
     *   A check-in must complete whether or not the clock started. If a
     *   measurement bug could refuse a member at the counter, the measurement
     *   would be more important than the thing it measures — which is exactly
     *   backwards, and is how instrumentation ends up switched off.
     *
     * `checkInClock` in src/domain/intelligence.ts discards negative durations
     * as clock skew rather than as fast check-ins, because this is written by
     * a tablet whose clock §8 already declines to trust.
     */
    arrivalAt: timestamp("arrival_at", { withTimezone: true }),

    checkedInByStaffId: uuid("checked_in_by_staff_id").references(
      () => staffUsers.id,
      { onDelete: "set null" },
    ),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),

    /** Both clocks. The desk may check someone in with no network. */
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("participations_session_idx").on(t.sessionId),
    index("participations_person_idx").on(t.personId),
    index("participations_host_idx").on(t.hostPersonId),
  ],
);

export const captureMethod = armory.enum("capture_method", CAPTURE_METHODS);

/**
 * APPEND-ONLY. §3.3.
 *
 * §1.2 rule 3: a correction is a new row referencing the old one. §13 makes
 * the purpose explicit — Phase 1 captures scores so that the Phase 2 leagues
 * engine has something to stand on. Manual capture is the primary path and
 * must be complete without any targeting system (§9).
 */
export const rounds = armory.table(
  "rounds",
  {
    id: id(),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => participations.id, { onDelete: "restrict" }),
    discipline: text("discipline").notNull(),
    format: text("format").notNull(),
    totalScore: integer("total_score").notNull(),

    /** Per-shot detail when a targeting system supplies it. Nullable (§3.3). */
    shotDetail: jsonb("shot_detail"),

    captureMethod: captureMethod("capture_method").notNull(),
    sourceReference: text("source_reference"),

    capturedByStaffId: uuid("captured_by_staff_id").references(
      () => staffUsers.id,
      { onDelete: "set null" },
    ),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),

    /** A correction is a new row pointing at the one it supersedes. */
    correctsRoundId: uuid("corrects_round_id"),
    correctionReason: text("correction_reason"),

    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("rounds_participation_idx").on(t.participationId),
    index("rounds_corrects_idx").on(t.correctsRoundId),
  ],
);

export const incidents = armory.table(
  "incidents",
  {
    id: id(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    narrative: text("narrative").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reportedByStaffId: uuid("reported_by_staff_id").references(
      () => staffUsers.id,
      { onDelete: "set null" },
    ),
    followUpStatus: text("follow_up_status").notNull().default("open"),

    /** §3.3: "Must be creatable offline." Hence both clocks and a device. */
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("incidents_session_idx").on(t.sessionId)],
);

export const incidentPersons = armory.table(
  "incident_persons",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    involvement: text("involvement").notNull(),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.personId] })],
);

/* ============================================================================
   3.4 PROPERTY

   ARCHITECTURAL INSTRUCTION, §3.4, quoted because it is the one place the
   specification raises its voice:

     "One register. One log. No exceptions. Club-owned and member-owned
      firearms are rows in the same table, distinguished by an ownership
      column. Do not create a second table, a second module, or a parallel
      workflow.

      custody_events is append-only and is the sole source of truth for where
      any firearm is. Firearm status is derived from it, not maintained
      independently — if the two can disagree, they eventually will."

   `firearms.status` below therefore exists as a cache and is written ONLY by
   the trigger that recomputes it from custody_events. A direct UPDATE to that
   column is rejected by the database.
   ========================================================================= */

export const firearmOwnership = armory.enum("firearm_ownership", FIREARM_OWNERSHIPS);

export const firearmStatus = armory.enum("firearm_status", FIREARM_STATUSES);

export const firearms = armory.table(
  "firearms",
  {
    id: id(),
    serialNumber: text("serial_number").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    calibre: text("calibre").notNull(),
    discipline: text("discipline"),

    ownership: firearmOwnership("ownership").notNull(),

    /** §3.4: both required when ownership is `member`. CHECK-constrained. */
    ownerPersonId: uuid("owner_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    licenceId: uuid("licence_id").references(() => licences.id, {
      onDelete: "restrict",
    }),

    /** DERIVED from custody_events by trigger. Never written by application code. */
    status: firearmStatus("status").notNull().default("in_service"),

    condition: text("condition"),
    roundCount: integer("round_count").notNull().default(0),
    acquiredOn: date("acquired_on"),
    decommissionedOn: date("decommissioned_on"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("firearms_serial_key").on(t.serialNumber),
    index("firearms_owner_idx").on(t.ownerPersonId),
    index("firearms_status_idx").on(t.status),
  ],
);

export const custodyEventType = armory.enum("custody_event_type", CUSTODY_EVENT_TYPES);

/**
 * APPEND-ONLY. §3.4: "No update. No delete. Ever."
 *
 * This is the table the club's licence rests on. It is also the table a
 * regulator would ask for. Both facts point the same way: the only permitted
 * operation is INSERT, a mistake is corrected by a `correction` row pointing
 * at the event it corrects, and the prohibition is installed in the database
 * so that no future migration, ORM helper or well-meaning fix can bypass it.
 */
export const custodyEvents = armory.table(
  "custody_events",
  {
    id: id(),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearms.id, { onDelete: "restrict" }),
    eventType: custodyEventType("event_type").notNull(),

    /** Who did it. Never null in practice; the audit exists to name a person. */
    actorStaffId: uuid("actor_staff_id").references(() => staffUsers.id, {
      onDelete: "restrict",
    }),
    /** Who it went to or came from. */
    counterpartyPersonId: uuid("counterparty_person_id").references(
      () => people.id,
      { onDelete: "restrict" },
    ),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),

    /** Set only on a `correction` row. CHECK-constrained both ways. */
    correctsEventId: uuid("corrects_event_id"),
    note: text("note"),
  },
  (t) => [
    index("custody_events_firearm_idx").on(t.firearmId, t.occurredAt),
    index("custody_events_session_idx").on(t.sessionId),
    index("custody_events_corrects_idx").on(t.correctsEventId),
  ],
);

export const ammunitionLots = armory.table(
  "ammunition_lots",
  {
    id: id(),
    calibre: text("calibre").notNull(),
    quantityReceived: integer("quantity_received").notNull(),

    /**
     * §3.4: "derived from issues, not decremented independently." Same rule as
     * firearm status and account balance — a counter that two writers can move
     * is a counter that will eventually be wrong. Maintained by trigger.
     */
    quantityRemaining: integer("quantity_remaining").notNull(),

    supplier: text("supplier"),
    receivedOn: date("received_on").notNull(),
    reference: text("reference"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ammunition_lots_calibre_idx").on(t.calibre)],
);

/**
 * §3.4: "Reconciled per participation, not per day. qty_issued must equal
 * qty_fired plus qty_returned at reconciliation."
 *
 * Per participation rather than per day because a per-day total cannot answer
 * the only question that matters when it fails to balance: whose rounds are
 * missing. CHECK-constrained on reconciliation.
 */
export const ammunitionIssues = armory.table(
  "ammunition_issues",
  {
    id: id(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => ammunitionLots.id, { onDelete: "restrict" }),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => participations.id, { onDelete: "restrict" }),

    qtyIssued: integer("qty_issued").notNull(),
    qtyFired: integer("qty_fired"),
    qtyReturned: integer("qty_returned"),

    issuedByStaffId: uuid("issued_by_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),

    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("ammunition_issues_participation_idx").on(t.participationId),
    index("ammunition_issues_lot_idx").on(t.lotId),
  ],
);

/**
 * §3.4: "Build the table; leave the workflow behind a feature flag until the
 * storage decision lands." §14 lists that decision as due before M6.
 *
 * The table exists now so the schema freeze on custody and ammunition is not
 * reopened later; MAY_STORE_FIREARM fails closed while the flag is off.
 */
export const storageAssignments = armory.table(
  "storage_assignments",
  {
    id: id(),
    firearmId: uuid("firearm_id")
      .notNull()
      .references(() => firearms.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    cabinetReference: text("cabinet_reference").notNull(),
    assignedOn: date("assigned_on").notNull(),
    releasedOn: date("released_on"),
    feeStatus: text("fee_status").notNull().default("pending"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("storage_assignments_firearm_idx").on(t.firearmId)],
);

/** §3.4: non-firearm equipment, "tracked without custody-log rigour". */
export const assets = armory.table(
  "assets",
  {
    id: id(),
    category: text("category").notNull(),
    identifier: text("identifier").notNull(),
    status: text("status").notNull().default("available"),
    condition: text("condition"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("assets_identifier_key").on(t.category, t.identifier)],
);

/* ============================================================================
   3.5 MONEY
   ========================================================================= */

/**
 * §3.5: "payer_person_id for a guest charge is ALWAYS the host. Enforce in
 * code, not convention."
 *
 * §1.2 rule 5 is the reason: "Money from a guest visit lands on the host. A
 * guest never transacts with the club." A guest being asked to pay at the desk
 * — in front of the member who invited them — is the single worst thing this
 * system could do to the acquisition funnel it exists to serve.
 */
export const charges = armory.table(
  "charges",
  {
    id: id(),
    payerPersonId: uuid("payer_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),

    referenceType: text("reference_type").notNull(),
    referenceId: uuid("reference_id"),

    lineItems: jsonb("line_items").notNull(),
    totalKobo: kobo("total_kobo").notNull(),

    isSettled: boolean("is_settled").notNull().default(false),
    settledPaymentId: uuid("settled_payment_id"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("charges_payer_idx").on(t.payerPersonId),
    index("charges_reference_idx").on(t.referenceType, t.referenceId),
    index("charges_settled_idx").on(t.isSettled),
  ],
);

export const paymentPurpose = armory.enum("payment_purpose", PAYMENT_PURPOSES);

export const paymentStatus = armory.enum("payment_status", PAYMENT_STATUSES);

export const payments = armory.table(
  "payments",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    amountKobo: kobo("amount_kobo").notNull(),
    purpose: paymentPurpose("purpose").notNull(),
    method: text("method"),
    gateway: text("gateway"),

    /**
     * §3.5 unique where present, and §12: "Duplicate webhook from Paystack →
     * One payment row. Idempotent on gateway_reference." The uniqueness is the
     * idempotency — a second webhook for the same reference cannot insert.
     */
    gatewayReference: text("gateway_reference"),

    status: paymentStatus("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_gateway_reference_key").on(t.gatewayReference),
    index("payments_person_idx").on(t.personId),
  ],
);

/** §3.5: "Balance derived from account_transactions, never written directly." */
export const accounts = armory.table(
  "accounts",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    balanceKobo: kobo("balance_kobo").notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("accounts_person_key").on(t.personId)],
);

export const ledgerDirection = armory.enum("ledger_direction", LEDGER_DIRECTIONS);

/** APPEND-ONLY. §3.5: "Ledger, not a mutable balance." */
export const accountTransactions = armory.table(
  "account_transactions",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    amountKobo: kobo("amount_kobo").notNull(),
    direction: ledgerDirection("direction").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: uuid("reference_id"),
    createdAt: createdAt(),
  },
  (t) => [index("account_transactions_account_idx").on(t.accountId)],
);

/* ============================================================================
   3.6 AUDIT
   ========================================================================= */

/**
 * APPEND-ONLY. §3.6.
 *
 * "Every custody event, score, waiver, admission, guest authorisation, block
 * and override. An override is permitted but never silent — override_reason is
 * mandatory when present."
 *
 * Blocks are audited as well as overrides, and that is deliberate: §4.3 says a
 * member must never first learn of a problem at the desk in front of their
 * guest. The only way to know whether that is happening is to have a record of
 * every block the desk ever showed.
 */
export const auditLog = armory.table(
  "audit_log",
  {
    id: id(),
    actorStaffId: uuid("actor_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),

    before: jsonb("before"),
    after: jsonb("after"),

    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),

    /** §3.6: mandatory when the action was an override. CHECK-constrained. */
    isOverride: boolean("is_override").notNull().default(false),
    overrideReason: text("override_reason"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_occurred_idx").on(t.occurredAt),
    index("audit_log_override_idx").on(t.isOverride),
  ],
);

/* ============================================================================
   IDEMPOTENCY — §7

   "Every write accepts a client-generated UUIDv7 as the record identity and is
   safe to replay. A queued write delivered twice must produce one row, not
   two. This is the single most important API requirement in the system."

   For append-only tables the record id IS the idempotency key: the push is an
   upsert on a primary key the client generated, so a replay is a no-op by
   construction and no extra table is needed.

   This table covers the other half — server-authoritative operations (§8.2)
   that are not a single row insert. Confirming a booking decrements an
   allowance, writes an invitation and raises a charge; replaying that must
   reproduce the original RESULT, not perform it again. The request id is
   recorded with its response so the second delivery returns the first answer.
   ========================================================================= */

export const writeReceipts = armory.table(
  "write_receipts",
  {
    /** The client-generated UUIDv7 the device attached to the operation. */
    requestId: uuid("request_id").primaryKey(),
    operation: text("operation").notNull(),

    /** Serialised result of the first successful execution. Replayed verbatim. */
    result: jsonb("result"),

    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    actorStaffId: uuid("actor_staff_id").references(() => staffUsers.id, {
      onDelete: "set null",
    }),

    createdAt: createdAt(),
  },
  (t) => [index("write_receipts_created_idx").on(t.createdAt)],
);

/* ============================================================================
   TYPES
   ========================================================================= */

export type Person = typeof people.$inferSelect;
export type Tier = typeof tiers.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type Licence = typeof licences.$inferSelect;
export type Qualification = typeof qualifications.$inferSelect;
export type WaiverVersion = typeof waiverVersions.$inferSelect;
export type WaiverSignature = typeof waiverSignatures.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type HostAllowance = typeof hostAllowances.$inferSelect;
export type GuestInvitation = typeof guestInvitations.$inferSelect;
export type Lane = typeof lanes.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type RangeSession = typeof sessions.$inferSelect;
export type Participation = typeof participations.$inferSelect;
export type ScoredRound = typeof rounds.$inferSelect;
export type Firearm = typeof firearms.$inferSelect;
export type CustodyEvent = typeof custodyEvents.$inferSelect;
export type AmmunitionLot = typeof ammunitionLots.$inferSelect;
export type AmmunitionIssue = typeof ammunitionIssues.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;

export type MembershipStatus = (typeof membershipStatus.enumValues)[number];
export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
export type BookingStatus = (typeof bookingStatus.enumValues)[number];
export type InvitationStatus = (typeof invitationStatus.enumValues)[number];
export type SessionStatus = (typeof sessionStatus.enumValues)[number];
export type FirearmStatus = (typeof firearmStatus.enumValues)[number];
export type LicenceStatus = (typeof licenceStatus.enumValues)[number];
export type CustodyEventType = (typeof custodyEventType.enumValues)[number];
export type ParticipantRole = (typeof participantRole.enumValues)[number];
export type StaffRole = (typeof staffRole.enumValues)[number];
export type DeviceSurface = (typeof deviceSurface.enumValues)[number];
