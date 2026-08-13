import { assertNoRestrictedFields, type DayPack } from "@/offline/daypack";
import { tierPermissions } from "./subject";
import type { DayPackSource } from "./rows";

/**
 * BUILDING A DAY PACK — §8.1, §10.
 *
 *   §8.1: "On connection, each desk and lane device pulls and caches: today's and
 *          tomorrow's expected arrivals with computed status; all active
 *          memberships and tiers; all guest invitations for the window; the full
 *          firearm register; ammunition lot balances; the active waiver version;
 *          staff and device records."
 *
 * A pure projection from the rows in src/server/rows.ts. It is the narrowest part
 * of the sync layer and the one with the highest consequence, because everything
 * it copies into a pack is data that then sits on a tablet in a public building.
 *
 * ===========================================================================
 * PROJECTED FIELD BY FIELD, EVERYWHERE, ON PURPOSE
 *
 * Not one spread in this file. It would be shorter with them, and the shortness
 * is the problem: `...row` copies whatever the query happened to select, so a
 * column added to a table or a `select *` written in a hurry becomes a field on a
 * tablet without anybody choosing it. §10 opens by naming what these tables hold
 * — "identity documents, photographs, addresses, dates of birth and firearm
 * licences" — and the pack's whole safety argument is that a desk holds the
 * smallest subset that can still make a decision.
 *
 * Listing every field means adding one is a visible act in a diff.
 *
 * ===========================================================================
 * THE RUNTIME CHECK HERE IS A TRIPWIRE, NOT THE DEFENCE
 *
 * `assertNoRestrictedFields` runs before the pack is returned, and it is worth
 * being honest about what that does and does not buy on this side.
 *
 * Because the projection below is exhaustive, an over-selecting query cannot get a
 * restricted column past it: the field is dropped before the check ever sees it,
 * which is asserted directly in parity.test.ts. So today the check catches nothing
 * here. It stays because the projection will grow, and the first pass-through value
 * added to it — a JSONB column, a nested snapshot — is the one that would slip
 * through unexamined.
 *
 * The check earns its keep on the DEVICE, where a pack arrives as JSON over the
 * network with no compiler present, and it runs again there before anything is
 * stored (src/offline/daypack-store.ts). Two calls, deliberately: this side stops a
 * bad pack being sent, that side stops a bad pack being kept, and neither trusts
 * the other to have run.
 */

export function projectDayPack(source: DayPackSource): DayPack {
  const pack: DayPack = {
    pulledAt: source.pulledAt.toISOString(),
    windowStart: source.windowStart,
    windowEnd: source.windowEnd,

    activeWaiverVersionId: source.activeWaiverVersionId,
    waiverValidityDays: source.waiverValidityDays,
    storageEnabled: source.storageEnabled,
    disciplinesRequiringQualification: source.disciplinesRequiringQualification,

    /* The pack's tier is the evaluator's tier plus `active`, which the desk needs
       to render a tier list but which never reaches a Subject. See the projection
       note in src/server/subject.ts. */
    tiers: source.tiers.map((tier) => ({
      ...tierPermissions(tier),
      active: tier.active,
    })),

    /**
     * §10, the omissions that matter most.
     *
     * A name, a photograph and a status are what §1.2 needs to check somebody in
     * within fifteen seconds. Address, date of birth and next of kin are not, and
     * a stolen tablet holding four hundred of them is the concentration §10 opens
     * by warning about. `PackPerson` has no field for them, so this is not a
     * filter anybody could relax — it is the only shape that compiles.
     */
    people: source.people.map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      photoUrl: person.photoUrl,
    })),

    memberships: source.memberships.map((membership) => ({
      id: membership.id,
      personId: membership.personId,
      tierId: membership.tierId,
      memberNumber: membership.memberNumber,
      status: membership.status,
      endedOn: membership.endedOn,
      renewsOn: membership.renewsOn,
    })),

    /* Licence FACTS and no document. The desk needs to know whether a licence is
       verified, what calibres it covers and when it expires — MAY_USE_OWN_FIREARM
       is undecidable without those. It does not need the scan, and §10 says it may
       not have it. */
    licences: source.licences.map((licence) => ({
      id: licence.id,
      personId: licence.personId,
      status: licence.status,
      calibres: licence.calibres,
      expiresOn: licence.expiresOn,
    })),

    qualifications: source.qualifications.map((qualification) => ({
      personId: qualification.personId,
      discipline: qualification.discipline,
      level: qualification.level,
      expiresAt: qualification.expiresAt,
    })),

    waiverSignatures: source.waiverSignatures.map((signature) => ({
      personId: signature.personId,
      waiverVersionId: signature.waiverVersionId,
      signedAt: signature.signedAt,
    })),

    allowances: source.allowances.map((allowance) => ({
      membershipId: allowance.membershipId,
      includedQuota: allowance.includedQuota,
      usedCount: allowance.usedCount,
      overagePriceLabel: allowance.overagePriceLabel,
    })),

    /* No `tokenHash`. The invitation token is a bearer credential for the guest
       link (§6.3); a pack carrying four hundred of them would let anyone holding
       the tablet complete any pending invitation. */
    invitations: source.invitations.map((invitation) => ({
      id: invitation.id,
      hostMembershipId: invitation.hostMembershipId,
      hostPersonId: invitation.hostPersonId,
      guestPersonId: invitation.guestPersonId,
      bookingId: invitation.bookingId,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      isChargeable: invitation.isChargeable,
    })),

    /**
     * Arrivals WITHOUT a computed status, despite §8.1 saying "with computed
     * status".
     *
     * A status computed here is wrong the moment the host checks in, and §4
     * requires precisely that row to clear itself without the officer retrying.
     * Shipping a precomputed status would make that impossible and would put a
     * second copy of the permission logic on the wire, which is the duplication §4
     * forbids. The desk computes it by calling the same `evaluate()` this server
     * calls. See the note on `PackArrival`.
     */
    arrivals: source.arrivals.map((arrival) => ({
      personId: arrival.personId,
      bookingId: arrival.bookingId,
      sessionId: arrival.sessionId,
      role: arrival.role,
      discipline: arrival.discipline,
      slotStart: arrival.slotStart,
      hostPersonId: arrival.hostPersonId,
      invitationId: arrival.invitationId,
    })),

    /* The full register (§8.1), minus the licence link and the acquisition
       history. `status` is derived from custody_events server-side (§3.4) and the
       desk treats it as read-only. */
    firearms: source.firearms.map((firearm) => ({
      id: firearm.id,
      serialNumber: firearm.serialNumber,
      make: firearm.make,
      model: firearm.model,
      calibre: firearm.calibre,
      ownership: firearm.ownership,
      ownerPersonId: firearm.ownerPersonId,
      status: firearm.status,
    })),

    ammunitionLots: source.ammunitionLots.map((lot) => ({
      id: lot.id,
      calibre: lot.calibre,
      quantityRemaining: lot.quantityRemaining,
    })),

    /* No `pinHash`. §10: "Device-bound sessions with a short local unlock" — the
       unlock is verified against the server, and a pack containing every officer's
       PIN hash would move the club's staff authentication onto a tablet that can
       be carried out of the building. */
    staff: source.staff.map((member) => ({
      id: member.id,
      personId: member.personId,
      displayName: member.displayName,
      role: member.role,
      active: member.active,
    })),

    devices: source.devices.map((device) => ({
      id: device.id,
      label: device.label,
      surface: device.surface,
      revoked: device.revoked,
    })),
  };

  /* Throws rather than filtering. A pack that should not exist must not be sent
     in a repaired form, because the repair would hide the query that produced it. */
  assertNoRestrictedFields(pack);

  return pack;
}
