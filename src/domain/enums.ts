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

export const SESSION_STATUSES = ["open", "closed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const CAPTURE_METHODS = ["manual", "electronic"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

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
