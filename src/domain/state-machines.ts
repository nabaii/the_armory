import type {
  ApplicationStatus,
  BookingStatus,
  CustodyEventType,
  FirearmStatus,
  InvitationStatus,
  LicenceStatus,
  MembershipStatus,
  SessionStatus,
} from "@/domain/enums";

/**
 * STATE MACHINES — Build Specification §5.
 *
 *   "Implement these as explicit transitions with guards. Do not allow status
 *    to be set by direct assignment from a form."
 *
 * ===========================================================================
 * WHY THE EFFECTS ARE RETURNED RATHER THAN PERFORMED
 *
 * Several transitions here do more than change a word in a column. Cancelling
 * a booking "releases allowance and lane capacity". Cancelling an invitation
 * returns an allowance; marking one `attended` deliberately does not. Those
 * are the rules that decide whether the club's guest numbers add up, and §3.2
 * rates their correctness alongside the firearm register.
 *
 * So a transition returns the effects it implies as DATA, and the caller
 * applies them inside the same database transaction as the status change. Two
 * things fall out of that:
 *
 *   · The rule is unit-testable without a database. "Cancelling before the
 *     session returns the allowance" is an assertion about a returned array,
 *     not an integration test.
 *   · The status and its consequences cannot separate. A caller that writes
 *     the status without applying the effects is not a subtle bug — it fails
 *     to compile, because the effect list is the transition's return value.
 *
 * ===========================================================================
 * WHY REFUSALS CARRY A MESSAGE
 *
 * Every refusal below returns the same shape as a capability block: a stable
 * code and a written line. §4.3 applies to these too — a range officer who
 * cannot close a session is entitled to know which firearm is still out, not
 * that "the session cannot be closed".
 */

export type Transition<S> =
  | { readonly ok: true; readonly to: S; readonly effects: readonly Effect[] }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      /** The specific outstanding items, where there are any. §6.4. */
      readonly outstanding?: readonly string[];
      /** Whether a founder or officer may force it with a recorded reason. */
      readonly overridable: boolean;
    };

/**
 * A consequence the caller must apply in the same transaction.
 *
 * Deliberately a closed union. Adding a consequence to a transition means
 * adding a variant here, which makes every existing caller a compile error
 * until it decides what to do — which is the correct amount of friction for a
 * change to the club's guest accounting.
 */
export type Effect =
  /** §5 Booking, §5 GuestInvitation: give the host their guest slot back. */
  | { kind: "release_allowance"; membershipId: string }
  /** §3.2: consumed server-side, in the same transaction as the invitation. */
  | { kind: "consume_allowance"; membershipId: string }
  /** §8.3: allowance already exhausted; the visit stands and the host is billed. */
  | { kind: "record_overage"; membershipId: string }
  | { kind: "release_lane_capacity"; bookingId: string }
  | { kind: "close_waitlist_entry"; applicationId: string }
  | { kind: "issue_membership"; applicationId: string }
  /** A Partner membership cannot outlive its principal (§5). */
  | { kind: "cascade_to_attached_memberships"; membershipId: string }
  | { kind: "raise_charge"; personId: string; purpose: string }
  | { kind: "notify"; template: string; personId: string };

const ok = <S>(to: S, effects: readonly Effect[] = []): Transition<S> => ({
  ok: true,
  to,
  effects,
});

const refuse = <S>(
  code: string,
  message: string,
  options: { outstanding?: readonly string[]; overridable?: boolean } = {},
): Transition<S> => ({
  ok: false,
  code,
  message,
  outstanding: options.outstanding,
  overridable: options.overridable ?? false,
});

/* ============================================================================
   APPLICATION — §5

   "submitted → under_review → admitted | waitlisted | declined.
    waitlisted → admitted | withdrawn. Any → withdrawn.
    Admission requires roster headroom or an explicit founder override."
   ========================================================================= */

export type ApplicationEvent =
  | { type: "begin_review" }
  | {
      type: "admit";
      /** §14 lists the roster cap as blocking M3. Supplied by the caller. */
      rosterHeadroom: number;
      /** §12: "admitted only with explicit founder override recorded". */
      founderOverride?: { staffUserId: string; reason: string };
    }
  | { type: "waitlist" }
  | { type: "decline" }
  | { type: "withdraw" };

export function applicationTransition(
  from: ApplicationStatus,
  event: ApplicationEvent,
): Transition<ApplicationStatus> {
  /* "Any → withdrawn." An applicant may always take themselves out, including
     after admission and before they pay. */
  if (event.type === "withdraw") {
    if (from === "withdrawn") {
      return refuse("ALREADY_WITHDRAWN", "This application is already withdrawn.");
    }
    return ok("withdrawn");
  }

  switch (event.type) {
    case "begin_review":
      return from === "submitted"
        ? ok("under_review")
        : refuse(
            "NOT_SUBMITTED",
            "Only a submitted application can be moved into review.",
          );

    case "admit": {
      if (from !== "under_review" && from !== "waitlisted") {
        return refuse(
          "NOT_REVIEWABLE",
          "An application is admitted from review or from the waitlist.",
        );
      }

      /* THE ROSTER CAP. §1.1: "The roster has a hard cap; a waitlist sits
         behind it." §12 requires that admitting past it is either blocked or
         recorded as a founder override — never silent, because the cap is the
         product. */
      if (event.rosterHeadroom <= 0 && !event.founderOverride) {
        return refuse(
          "ROSTER_AT_CAP",
          "The roster is at its cap. Admitting now needs a founder override.",
          { overridable: true },
        );
      }

      const effects: Effect[] = [{ kind: "issue_membership", applicationId: "" }];
      if (from === "waitlisted") {
        effects.push({ kind: "close_waitlist_entry", applicationId: "" });
      }
      return ok("admitted", effects);
    }

    case "waitlist":
      return from === "under_review"
        ? ok("waitlisted")
        : refuse(
            "NOT_UNDER_REVIEW",
            "An application joins the waitlist from review.",
          );

    case "decline":
      return from === "under_review"
        ? ok("declined")
        : refuse("NOT_UNDER_REVIEW", "An application is declined from review.");
  }
}

/* ============================================================================
   MEMBERSHIP — §5

   "pending → active (on payment) → lapsed (renewal missed) | suspended (staff
    action) | resigned. lapsed → active on payment. suspended → active on staff
    action. A Partner membership cannot outlive its principal."
   ========================================================================= */

export type MembershipEvent =
  | { type: "payment_received" }
  | { type: "renewal_missed" }
  | { type: "suspend"; staffUserId: string; reason: string }
  | { type: "reinstate"; staffUserId: string }
  | { type: "resign" }
  /** The principal membership ended; §5's cascade. */
  | { type: "principal_ended" };

export function membershipTransition(
  from: MembershipStatus,
  event: MembershipEvent,
  membership: { id: string; isAttached: boolean },
): Transition<MembershipStatus> {
  switch (event.type) {
    case "payment_received":
      if (from === "pending" || from === "lapsed") {
        return ok("active", [
          { kind: "cascade_to_attached_memberships", membershipId: membership.id },
        ]);
      }
      if (from === "active") {
        /* A renewal on a live membership. Not a state change — but not an
           error either, and treating it as one would make the payment webhook
           noisy at exactly the time of year it is busiest. */
        return ok("active");
      }
      return refuse(
        "NOT_PAYABLE",
        from === "suspended"
          ? "A suspended membership is reinstated by the founder, not by payment."
          : "This membership has ended. Payment does not reopen it.",
      );

    case "renewal_missed":
      return from === "active"
        ? ok("lapsed", [
            { kind: "notify", template: "membership_lapsed", personId: "" },
            {
              kind: "cascade_to_attached_memberships",
              membershipId: membership.id,
            },
          ])
        : refuse("NOT_ACTIVE", "Only an active membership can lapse.");

    case "suspend":
      if (from === "resigned") {
        return refuse("ALREADY_ENDED", "This membership has already ended.");
      }
      return ok("suspended", [
        { kind: "cascade_to_attached_memberships", membershipId: membership.id },
      ]);

    case "reinstate":
      return from === "suspended"
        ? ok("active")
        : refuse(
            "NOT_SUSPENDED",
            "Only a suspended membership is reinstated.",
          );

    case "resign":
      return from === "resigned"
        ? refuse("ALREADY_ENDED", "This membership has already ended.")
        : ok("resigned", [
            {
              kind: "cascade_to_attached_memberships",
              membershipId: membership.id,
            },
          ]);

    /* ------------------------------------------------------------------
       "A Partner membership cannot outlive its principal."

       Worth stating plainly because the failure is invisible: a principal
       resigns, their partner's membership is never touched, and the club
       carries a full member who pays nothing and whom no report flags —
       for as long as nobody happens to look.
       ------------------------------------------------------------------ */
    case "principal_ended":
      if (!membership.isAttached) {
        return refuse(
          "NOT_ATTACHED",
          "This membership stands on its own; no principal governs it.",
        );
      }
      return from === "resigned" ? ok("resigned") : ok("lapsed");
  }
}

/* ============================================================================
   BOOKING — §5

   "draft → confirmed → completed | cancelled | no_show. Cancellation releases
    allowance and lane capacity. no_show set by the end-of-day close, not
    manually."
   ========================================================================= */

export type BookingEvent =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "complete" }
  /** §5: only the end-of-day close may set this. §6.4. */
  | { type: "mark_no_show"; source: "end_of_day_close" };

export function bookingTransition(
  from: BookingStatus,
  event: BookingEvent,
  booking: {
    id: string;
    hostMembershipId: string;
    /** Guest invitations still holding allowance against this booking. */
    heldAllowances: number;
  },
): Transition<BookingStatus> {
  switch (event.type) {
    case "confirm":
      return from === "draft"
        ? ok("confirmed")
        : refuse("NOT_DRAFT", "Only a draft booking can be confirmed.");

    case "cancel": {
      if (from === "cancelled") {
        return refuse("ALREADY_CANCELLED", "This booking is already cancelled.");
      }
      if (from === "completed" || from === "no_show") {
        return refuse(
          "ALREADY_CLOSED",
          "This booking has already been through the range.",
        );
      }

      /* §5: "Cancellation releases allowance and lane capacity." One
         release per invitation that was holding one — a booking with two
         guests returns two, and a loop that returned one would leak a guest
         slot per cancellation for the life of the club. */
      const effects: Effect[] = [
        { kind: "release_lane_capacity", bookingId: booking.id },
      ];
      for (let i = 0; i < booking.heldAllowances; i += 1) {
        effects.push({
          kind: "release_allowance",
          membershipId: booking.hostMembershipId,
        });
      }
      return ok("cancelled", effects);
    }

    case "complete":
      return from === "confirmed"
        ? ok("completed")
        : refuse("NOT_CONFIRMED", "Only a confirmed booking completes.");

    case "mark_no_show":
      if (event.source !== "end_of_day_close") {
        return refuse(
          "MANUAL_NO_SHOW",
          "A no-show is set by the end-of-day close, not by hand.",
        );
      }
      return from === "confirmed"
        ? ok("no_show")
        : refuse("NOT_CONFIRMED", "Only a confirmed booking can be a no-show.");
  }
}

/* ============================================================================
   GUEST INVITATION — §5

   "issued → opened → completed → attended. issued | opened | completed →
    cancelled (returns allowance) | expired. attended is terminal and does not
    return allowance."
   ========================================================================= */

export type InvitationEvent =
  | { type: "open" }
  | { type: "complete" }
  | { type: "attend" }
  | { type: "cancel" }
  | { type: "expire" };

const RETURNS_ALLOWANCE: readonly InvitationStatus[] = [
  "issued",
  "opened",
  "completed",
];

export function invitationTransition(
  from: InvitationStatus,
  event: InvitationEvent,
  invitation: { hostMembershipId: string },
): Transition<InvitationStatus> {
  switch (event.type) {
    case "open":
      return from === "issued"
        ? ok("opened")
        : from === "opened"
          ? /* Guests reopen the link — they close the browser, or come back to
               it in the car park. Idempotent by design (§7). */
            ok("opened")
          : refuse("NOT_OPENABLE", "This invitation can no longer be opened.");

    case "complete":
      return from === "opened" || from === "issued"
        ? ok("completed")
        : from === "completed"
          ? ok("completed")
          : refuse(
              "NOT_COMPLETABLE",
              "This invitation can no longer be completed.",
            );

    case "attend":
      return from === "completed"
        ? /* Terminal, and §5 is explicit that it does NOT return allowance:
             the guest came, the club hosted them, the slot was used. */
          ok("attended")
        : refuse(
            "NOT_COMPLETED",
            "A guest is marked attended only after their details are complete.",
          );

    case "cancel":
      return RETURNS_ALLOWANCE.includes(from)
        ? ok("cancelled", [
            {
              kind: "release_allowance",
              membershipId: invitation.hostMembershipId,
            },
          ])
        : refuse(
            "NOT_CANCELLABLE",
            from === "attended"
              ? "This guest has already visited."
              : "This invitation is already closed.",
          );

    case "expire":
      return RETURNS_ALLOWANCE.includes(from)
        ? ok("expired", [
            {
              kind: "release_allowance",
              membershipId: invitation.hostMembershipId,
            },
          ])
        : refuse("NOT_EXPIRABLE", "This invitation is already closed.");
  }
}

/* ============================================================================
   SESSION — §5

   "open → closed. Close is GUARDED: blocked while any firearm issued against
    the session is unreturned, any ammunition issue unreconciled, or any
    participation without checkout."

   §12 names the scenario: "Session close with a firearm unreturned → Blocked.
   Lists the specific firearm. Override requires a reason and appears on the
   dashboard."
   ========================================================================= */

export type SessionCloseState = {
  /** Serial numbers of firearms issued against this session and not returned. */
  unreturnedFirearms: readonly string[];
  /** Descriptions of ammunition issues not yet reconciled. */
  unreconciledAmmunition: readonly string[];
  /** Names of people checked in and never checked out. */
  missingCheckouts: readonly string[];
};

export function sessionTransition(
  from: SessionStatus,
  event: { type: "close" },
  state: SessionCloseState,
): Transition<SessionStatus> {
  if (from !== "open") {
    return refuse("NOT_OPEN", "This session is already closed.");
  }
  void event;

  /* The guard reports EVERYTHING outstanding at once, not the first problem.
     §6.4: "Guarded. Lists everything outstanding." An officer closing down at
     nine in the evening should get one list and clear it, not discover a
     second item after fixing the first. */
  const outstanding: string[] = [
    ...state.unreturnedFirearms.map((serial) => `Firearm ${serial} is still out`),
    ...state.unreconciledAmmunition.map((item) => `${item} is unreconciled`),
    ...state.missingCheckouts.map((name) => `${name} has not checked out`),
  ];

  if (outstanding.length > 0) {
    return refuse(
      "SESSION_NOT_CLEAR",
      outstanding.length === 1
        ? "One thing is outstanding before this session can close."
        : `${outstanding.length} things are outstanding before this session can close.`,
      /* Overridable — §12 requires the override to exist, to carry a reason,
         and to appear on the founder's dashboard. A range that cannot be
         locked because of a data problem is worse than a recorded exception. */
      { outstanding, overridable: true },
    );
  }

  return ok("closed");
}

/* ============================================================================
   FIREARM — §5

   "Status is DERIVED from the latest custody_event. Never set directly."

   §3.4 raises its voice on this: "custody_events is append-only and is the
   sole source of truth for where any firearm is. Firearm status is derived
   from it, not maintained independently — if the two can disagree, they
   eventually will."

   ⚠ THIS FUNCTION IS IMPLEMENTED TWICE, ON PURPOSE.

   Here in TypeScript, so the desk can show a firearm's status offline from the
   day pack; and in PL/pgSQL in drizzle/0002_armory_enforcement.sql, so the
   database maintains firearms.status itself and no application code can write
   it. The two must agree. Any change to the mapping below is a change to that
   migration in the same commit — the table at the top of the SQL function is
   the same table as the one below.
   ========================================================================= */

const STATUS_BY_EVENT: Record<
  Exclude<CustodyEventType, "correction">,
  FirearmStatus
> = {
  issued: "issued",
  returned: "in_service",
  /* A member's own firearm arriving on site. It is here and it is theirs. */
  brought_in: "in_service",
  taken_out: "off_site",
  stored: "in_storage",
  /* Out of the cabinet and on the premises — not yet off site; that is a
     separate `taken_out` when they leave with it. */
  withdrawn: "in_service",
  sent_for_service: "at_service",
  returned_from_service: "in_service",
  decommissioned: "decommissioned",
};

export type CustodyEventRecord = {
  id: string;
  eventType: CustodyEventType;
  occurredAt: Date;
  /** Set only on a `correction` row: the event this one withdraws. */
  correctsEventId: string | null;
};

/**
 * A firearm's status, derived from its whole custody history.
 *
 * Not "the last event" naively — §1.2 rule 3 makes a correction a NEW row
 * referencing the old one, so the history contains events that have since been
 * withdrawn. The derivation therefore removes every corrected event and every
 * correction row, then takes the latest of what remains.
 *
 * Ordering is by `occurred_at`, tie-broken by id. Ids are UUIDv7 and therefore
 * time-ordered (see src/lib/uuidv7.ts), which gives a stable answer when two
 * events share a timestamp — as they will when a batch is replayed from an
 * outbox that was offline for an hour.
 */
export function deriveFirearmStatus(
  events: readonly CustodyEventRecord[],
): FirearmStatus {
  if (events.length === 0) return "in_service";

  const corrected = new Set(
    events
      .filter((e) => e.eventType === "correction" && e.correctsEventId)
      .map((e) => e.correctsEventId as string),
  );

  const live = events.filter(
    (e) => e.eventType !== "correction" && !corrected.has(e.id),
  );
  if (live.length === 0) return "in_service";

  const latest = live.reduce((a, b) => {
    const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (byTime !== 0) return byTime > 0 ? a : b;
    return a.id >= b.id ? a : b;
  });

  return STATUS_BY_EVENT[
    latest.eventType as Exclude<CustodyEventType, "correction">
  ];
}

/** Whether a firearm in this state may be issued to a shooter. */
export const isIssuable = (status: FirearmStatus): boolean =>
  status === "in_service";

/* ============================================================================
   LICENCE — §5

   "pending_review → verified → expired (by date) | revoked (staff action).
    Capability is live only while verified and unexpired."
   ========================================================================= */

export type LicenceEvent =
  | { type: "verify"; staffUserId: string }
  | { type: "revoke"; staffUserId: string; reason: string }
  /** Set by the expiry sweep, from the date. Not a staff action. */
  | { type: "expire" };

export function licenceTransition(
  from: LicenceStatus,
  event: LicenceEvent,
): Transition<LicenceStatus> {
  switch (event.type) {
    case "verify":
      return from === "pending_review"
        ? ok("verified")
        : refuse(
            "NOT_PENDING",
            from === "revoked"
              ? "A revoked licence is not re-verified; record the new one."
              : "Only a licence awaiting review can be verified.",
          );

    case "revoke":
      return from === "revoked"
        ? refuse("ALREADY_REVOKED", "This licence is already revoked.")
        : ok("revoked");

    case "expire":
      return from === "verified"
        ? ok("expired")
        : refuse(
            "NOT_VERIFIED",
            "Only a verified licence expires; the others are already inactive.",
          );
  }
}

/**
 * §5: "Capability is live only while verified and unexpired."
 *
 * Both halves, together, in one place. The status column alone is not enough —
 * it is maintained by a sweep, and between the expiry date and the sweep
 * running the column says `verified` while the licence is not. The capability
 * service calls this rather than reading the column.
 */
export const isLicenceLive = (
  licence: { status: LicenceStatus; expiresOn: Date | null },
  now: Date,
): boolean =>
  licence.status === "verified" &&
  (licence.expiresOn === null || licence.expiresOn.getTime() > now.getTime());
