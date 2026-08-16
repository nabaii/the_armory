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

export const STAFF_ROLES = ["founder", "range_officer", "read_only"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

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
