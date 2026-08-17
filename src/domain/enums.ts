/**
 * THE CANONICAL VOCABULARIES.
 *
 * Every status, role and event type named in Build Specification §3 and §5,
 * defined once. The Postgres enums in src/db/armory/schema.ts are generated
 * from these arrays, and the capability service and state machines narrow
 * against the same unions.
 *
 * ===========================================================================
 * WHY THEY LIVE HERE RATHER THAN IN THE SCHEMA
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. Drift. A status list written twice is a status list that will eventually
 *    disagree with itself, and the disagreement surfaces as a capability check
 *    that silently never matches — the worst possible failure mode for code
 *    whose entire job is to say no correctly.
 *
 * 2. THE BUNDLE. §4 requires the capability service to run on the client, and
 *    §8 requires it to run there with no network at all. If the evaluator
 *    imported its unions from the Drizzle schema, `drizzle-orm/pg-core` would
 *    be pulled into the desk bundle — a database driver shipped to a tablet,
 *    inside the one-second cold-start budget §2 sets. This module imports
 *    nothing, so the dependency arrow points schema → domain and never back.
 *
 * Nothing in this file may import anything. That constraint is the whole point
 * of the file; if it ever needs an import, the thing it needs belongs
 * somewhere else.
 */

/* ---------------------------------------------------------------------------
   PEOPLE AND STANDING — §3.1
   -------------------------------------------------------------------------- */

export const MEMBERSHIP_STATUSES = [
  "pending",
  "active",
  "lapsed",
  "suspended",
  "resigned",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "admitted",
  "waitlisted",
  "declined",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const SPONSOR_TYPES = ["member", "club"] as const;
export type SponsorType = (typeof SPONSOR_TYPES)[number];

export const WAITLIST_STATUSES = [
  "waiting",
  "contacted",
  "admitted",
  "withdrawn",
] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const LICENCE_STATUSES = [
  "pending_review",
  "verified",
  "expired",
  "revoked",
] as const;
export type LicenceStatus = (typeof LICENCE_STATUSES)[number];

/**
 * The named posts a member of staff can hold.
 *
 * ===========================================================================
 * A ROLE IS A LABEL. A GRANT IS THE AUTHORITY — see STAFF_GRANTS below
 *
 * The first three existed from M0 and are load-bearing outside permission:
 * `founder` is how `apply-credentials.ts` and `permits.ts` resolve the club's
 * owner, by role rather than by a value somebody typed. They are kept.
 *
 * What changed with the management system is that a role no longer DECIDES
 * anything. Management §5 requires the club's two structural separations to be
 * refused by the system rather than promised in a charter, and a flat role
 * column cannot express "custody and payment are never in the same hands"
 * — it can only name a post and hope the naming is respected. So the authority
 * moved to `staff_grants`, and this list became what it always read as: the
 * club's org chart.
 */
export const STAFF_ROLES = [
  "founder",
  "range_officer",
  "read_only",
  "front_of_house",
  "armourer",
  "duty_manager",
  "finance",
  "safety_officer",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * WHAT A MEMBER OF STAFF MAY ACTUALLY DO — Management System §5, §18.
 *
 *   "No management screen evaluates a permission… staff permissions are the
 *    mechanism by which the club's separation of duties is enforced. An inline
 *    check in an administrative screen is not a shortcut; it is a hole in the
 *    club's governance."
 *
 * ===========================================================================
 * THE GRANT IS THE PRIMITIVE, AND THAT IS THE WHOLE DESIGN
 *
 * §18 makes the role model the first open decision and hands it to the founder
 * on the grounds that S3 makes it a governance document rather than a
 * configuration file. That is right about its standing and wrong about its
 * shape: a system whose permission unit is a ROLE cannot express a duty manager
 * covering the armoury for one evening without inventing a role — and the
 * evening always wins, so somebody gets a permanent grant to solve a temporary
 * problem and nobody ever takes it back.
 *
 * Grants are therefore the unit, roles are named bundles of them
 * (`ROLE_BUNDLES` in src/domain/grants.ts), and a grant may carry an expiry.
 *
 * ===========================================================================
 * WHY SOME OF THESE ARE SPLIT AND OTHERS ARE NOT
 *
 * Every split below exists because a FORBIDDEN COMBINATION needs it. Nothing is
 * split for tidiness, because each division is a decision the founder has to
 * make about a real person on a real evening.
 *
 *   people_read / people_write     Front of house needs the roster to answer a
 *                                  question at the counter. Deciding an
 *                                  application is a different act.
 *   safety_report / safety_manage  S5: near-miss reporting must be open to ANY
 *                                  member of staff in under thirty seconds. The
 *                                  veto, the register and an incident's outcome
 *                                  are not. Collapsing these would mean either
 *                                  a range officer who cannot report, or a
 *                                  reporting surface that carries the veto.
 *   intelligence_operational /     S4: "a safety veto holder is never measured
 *   intelligence_commercial        on commercial outcomes". Reporting health,
 *                                  utilisation and coverage are the safety
 *                                  officer's own evidence. Revenue is not.
 *
 * `custody` and `ledger` are deliberately NOT split. S3 is about hands on the
 * record, and a read of the armoury register is already the safety surface's.
 */
export const STAFF_GRANTS = [
  /** Check in, issue equipment, close the day. The console. */
  "desk",
  /** Author hours, service hours, events and closures; take and amend bookings. */
  "programme",
  "people_read",
  "people_write",
  /** The armoury register and every firearm movement. */
  "custody",
  /** File a near-miss or an incident. Open to any staff member — S5. */
  "safety_report",
  /** The safety veto, the expiry register, and an incident's outcome. */
  "safety_manage",
  /** Charges, reconciliation, balances, takings. */
  "ledger",
  "intelligence_operational",
  "intelligence_commercial",
  /** Assigning and revoking every grant above. Including these. */
  "grants",
] as const;
export type StaffGrant = (typeof STAFF_GRANTS)[number];

export const DEVICE_SURFACES = ["desk", "lane"] as const;
export type DeviceSurface = (typeof DEVICE_SURFACES)[number];

/* ---------------------------------------------------------------------------
   HOSTING — §3.2
   -------------------------------------------------------------------------- */

export const INVITATION_STATUSES = [
  "issued",
  "opened",
  "completed",
  "attended",
  "cancelled",
  "expired",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/* ---------------------------------------------------------------------------
   ACTIVITY — §3.3
   -------------------------------------------------------------------------- */

export const LANE_STATUSES = ["available", "maintenance", "closed"] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];

export const BOOKING_STATUSES = [
  "draft",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PARTICIPANT_ROLES = [
  "member_shooter",
  "guest_shooter",
  "spectator",
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/**
 * WHAT A BOOKING IS FOR — Members Portal §7.4.
 *
 *   "Shoot, table, both and spectate require a `booking_type` on the booking,
 *    and availability must model table capacity separately from lane capacity."
 *
 * ===========================================================================
 * THIS LIST IS THE HOSPITALITY-FIRST PRINCIPLE, EXPRESSED AS A COLUMN
 *
 * The governing frame is "a hospitality operation with a shooting range
 * attached", and priority inversion is a named design risk. Until this column
 * existed, every booking in the system was a lane — which meant the club's own
 * schema could not express a member coming in to eat, and a member who wanted
 * to could only do it by booking a firing point they did not intend to use.
 *
 * The four are equal. `table` is not a lesser booking than `shoot`, and no
 * screen may present it as one (§7.4, step 2: "Four equal options").
 *
 * What each consumes is the whole reason the distinction is in the database:
 *
 *   shoot     one firing position, one seat at neither table nor deck
 *   table     one table seat, NO lane
 *   both      one firing position AND one table seat
 *   spectate  neither a lane nor a table — but a seat on the premises and,
 *             more importantly, a NAME ON THE ARRIVALS LIST. A person in the
 *             building whom the desk did not expect is the failure this row
 *             prevents.
 *
 * src/domain/availability.ts holds the arithmetic; this is the vocabulary.
 */
export const BOOKING_TYPES = ["shoot", "table", "both", "spectate"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

/**
 * WHAT IS ON — Members Portal §7.3, §12 item 5.
 *
 *   "M0 through M10 cover people, admission, hosting, booking, desk, armoury,
 *    lane, money, dashboard and hardening. Nothing holds *what is on this
 *    Thursday*."
 *
 * The Diary draws on three feeds. Two of them already exist — the operating
 * rhythm comes from opening hours, fixtures come from the leagues product — so
 * this entity carries only the third: the one-offs. A guest evening, the Aduvie
 * tournament, a closure for a public holiday.
 *
 * `closure` is on the list and is not an event in the ordinary sense. It is the
 * only way the club can say "we are open on Thursdays, except this Thursday"
 * without editing its opening hours and forgetting to put them back — and a
 * member who drives to a closed range because the portal said it was open is
 * the single worst thing this surface can do.
 */
export const PROGRAMME_KINDS = ["event", "fixture", "closure"] as const;
export type ProgrammeKind = (typeof PROGRAMME_KINDS)[number];

export const SESSION_STATUSES = ["open", "closed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const CAPTURE_METHODS = ["manual", "electronic"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/**
 * §3.3's `incidents.category`.
 *
 * The column is `text`, not a Postgres enum, and that is deliberate rather than
 * an omission — §14 leaves the regulatory and licensing obligation open, and a
 * reporting category the regulator turns out to require is a migration if the
 * vocabulary is in the database and a deploy if it is here. Everything that
 * WRITES an incident narrows against this list, so the column is as constrained
 * in practice as an enum would be, and is cheaper to widen.
 *
 * `other` exists and is last on purpose. A fixed list with no escape hatch does
 * not produce cleaner data; it produces incidents filed under the nearest wrong
 * category, or not filed at all — and §6.5 puts the incident button one tap from
 * everywhere precisely because the cost of not recording one is unbounded.
 */
export const INCIDENT_CATEGORIES = [
  /** A shot nobody intended. The one every range fears and must record. */
  "negligent_discharge",
  /** Muzzle discipline, a breach of the line, shooting out of sequence. */
  "safety_breach",
  "injury",
  "equipment_fault",
  "property_damage",
  /** Conduct: intoxication, refusal of an instruction, a dispute. */
  "conduct",
  "other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/**
 * How a person is attached to an incident — §3.3's `incident_persons.involvement`.
 *
 * `witness` is on the list for a reason worth stating: an incident with nobody
 * but the subject recorded against it is the version that is hardest to stand
 * behind afterwards, and the people who saw it are on the premises for another
 * ten minutes and then gone.
 */
export const INCIDENT_INVOLVEMENTS = [
  "involved",
  "witness",
  "injured",
  "reported",
] as const;
export type IncidentInvolvement = (typeof INCIDENT_INVOLVEMENTS)[number];

/**
 * THE DEGRADATION LADDER — Management System §6.2.
 *
 *   "The club's degradation order under staffing pressure is already defined:
 *    guest numbers cap first, then live fire closes, then the full range closes,
 *    then the clubhouse trades only. It currently lives in a document, which
 *    means that under real pressure it lives in somebody's memory."
 *
 * ===========================================================================
 * THE ORDER IS THE CONTENT, WHICH IS WHY IT IS AN ORDERED LIST
 *
 * These are not four independent states the club picks between. They are four
 * rungs, and the club's own operating principle is that it comes down them in
 * sequence — you do not close the range while still admitting guests. The index
 * of a value in this array is therefore meaningful, and `src/domain/operating.ts`
 * compares them numerically.
 *
 * A club under pressure improvises, and improvisation is the failure §6.2 names:
 * the order exists so that an understaffed evening degrades BY DESIGN. Written
 * in a document it lives in whoever is on shift; written here it moves guest
 * caps, closes slots, notifies members and updates the desk's day pack.
 */
export const OPERATING_LEVELS = [
  /** Everything open. The state the club is in unless somebody says otherwise. */
  "normal",
  /** Guest numbers capped. The first thing to give, and the least visible. */
  "guests_capped",
  /** No live fire. The deck and kitchen still trade — the hospitality half. */
  "live_fire_closed",
  /** The range is shut. The clubhouse trades only. */
  "range_closed",
] as const;
export type OperatingLevel = (typeof OPERATING_LEVELS)[number];

/**
 * WHY THE CLUB DEGRADED — Management §11.3.
 *
 *   "Degradation events, with reasons → the staffing argument, made from
 *    evidence."
 *
 * A closed vocabulary rather than free text, for the reason `charges.ts` gives
 * about revenue sources: the value of this control over a season is the RECORD
 * of why the club degraded, and a record grouped on strings somebody typed is
 * three spellings of "short-staffed". The free-text note sits beside it and
 * carries the particulars.
 */
export const DEGRADATION_CAUSES = [
  /** The commonest, and the one §4.3 says this control exists for. */
  "staffing",
  /** An officer certification lapsed, or nobody qualified is on the floor. */
  "coverage",
  "weather",
  /** A lane, the ventilation, the targets. */
  "equipment",
  /** Imposed by the National Stadium rather than chosen by the club. */
  "stadium",
  /** Following an incident, on the safety holder's instruction. */
  "safety",
  "other",
] as const;
export type DegradationCause = (typeof DEGRADATION_CAUSES)[number];

/**
 * WHAT A NEAR-MISS WAS ABOUT — Management §9.2.
 *
 * Deliberately shorter and blunter than `INCIDENT_CATEGORIES`. §9.2 requires a
 * report that "can be submitted from a phone in under thirty seconds", and every
 * additional option is a decision somebody makes while standing on a range
 * wanting to get back to work. Seven categories is a form; four is a tap.
 *
 * They also ask a different question. An incident category names what HAPPENED;
 * these name what ALMOST happened, which is why "nearly" reads through all of
 * them and why none of them is a person.
 */
export const NEAR_MISS_KINDS = [
  /** Muzzle direction, crossing the line, a shot out of sequence. */
  "line_discipline",
  /** A firearm or a lane behaved unexpectedly. */
  "equipment",
  /** The wrong ammunition, an unsafe load, a mix-up on the bench. */
  "ammunition",
  /** Somebody where they should not have been. */
  "movement",
  "other",
] as const;
export type NearMissKind = (typeof NEAR_MISS_KINDS)[number];

/* ---------------------------------------------------------------------------
   PROPERTY — §3.4
   -------------------------------------------------------------------------- */

export const FIREARM_OWNERSHIPS = ["club", "member"] as const;
export type FirearmOwnership = (typeof FIREARM_OWNERSHIPS)[number];

/**
 * §5: "Status is DERIVED from the latest custody_event. Never set directly."
 *
 * Listed here because the derivation function and the database trigger must
 * agree on the vocabulary, and because the desk renders these words.
 */
export const FIREARM_STATUSES = [
  "in_service",
  "issued",
  "off_site",
  "in_storage",
  "at_service",
  "decommissioned",
] as const;
export type FirearmStatus = (typeof FIREARM_STATUSES)[number];

export const CUSTODY_EVENT_TYPES = [
  "issued",
  "returned",
  "brought_in",
  "taken_out",
  "stored",
  "withdrawn",
  "sent_for_service",
  "returned_from_service",
  "decommissioned",
  "correction",
] as const;
export type CustodyEventType = (typeof CUSTODY_EVENT_TYPES)[number];

/* ---------------------------------------------------------------------------
   MONEY — §3.5
   -------------------------------------------------------------------------- */

export const PAYMENT_PURPOSES = [
  "subscription",
  "guest_overage",
  "account_topup",
  "bar",
  "retail",
  "other",
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const LEDGER_DIRECTIONS = ["credit", "debit"] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/* ---------------------------------------------------------------------------
   CAPABILITIES — §4.2
   -------------------------------------------------------------------------- */

export const CAPABILITIES = [
  "MAY_BOOK",
  "MAY_HOST",
  "MAY_ATTEND",
  "GUEST_MAY_ATTEND",
  "MAY_SHOOT_DISCIPLINE",
  "MAY_USE_OWN_FIREARM",
  "MAY_STORE_FIREARM",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
