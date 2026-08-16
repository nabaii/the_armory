import type { Metadata } from "next";
import Link from "next/link";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { accountFor } from "@/server/armory/money";
import {
  documentsFor,
  firearmsFor,
  hostingHistoryFor,
  isWorthConverting,
  type HostedGuest,
  type MemberDocuments,
  type MemberFirearm,
} from "@/server/armory/member-file";
import { TOP_UP_AMOUNTS } from "@/content/top-up";
import { format, fromStorage } from "@/lib/money";
import { formatDate, formatWeekdayDate, parseDateColumn } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SettleForm, TopUpForm } from "@/components/member/AccountForms";
import { InviteGuestForm } from "@/components/member/HostingForms";
import { AllowanceMeter } from "@/components/member/AllowanceMeter";
import { StatusPill, type Status } from "@/components/member/StatusPill";
import { memberNumberLabel } from "@/components/member/MembersShell";
import { Body, Caption, Data, H2, H3, Kicker } from "@/components/ui/Text";
import { routes } from "@/lib/site";

/**
 * ME — Members Portal Design Specification §9.
 *
 *   "A settings-shaped surface holding five groups. The order is deliberate and
 *    is not the conventional one."
 *
 *   1. Membership card   photograph, number, tier, status, check-in credential
 *   2. Guests            allowance, hosting history, link status, conversion
 *   3. Documents         waiver, licence, qualifications
 *   4. Firearms          registered, approval status, custody history
 *   5. Account           balance, payments, renewal, saved method
 *
 * ===========================================================================
 * WHY GUESTS IS SECOND
 *
 *   "Guests sits second, not buried under settings. Hosting has no tab; this is
 *    its home, and placing it beneath payment preferences would contradict
 *    Section 5.2 in the one screen that is supposed to compensate for the
 *    missing tab."
 *
 * The conventional order would put the account first, because money feels like
 * the important thing. Hosting is the club's only acquisition mechanism, and
 * §5.2 traded away its tab on the argument that four other placements would add
 * up to more than one tab would. This is the largest of the four. If it drifts
 * down the page, that trade quietly stops being true.
 *
 * ===========================================================================
 * §9.2 — THE OFFLINE CREDENTIAL IS NOT HERE, AND THAT IS THE DEPENDENCY
 *
 *   "DEPENDENCY — Cache nothing until revocation exists. The security review
 *    names a founder-facing revocation control as a launch blocker. A cached
 *    credential with a twenty-four hour life is only safe if there is something
 *    to race against it. Until the control ships, THE MEMBERSHIP CARD IS
 *    ONLINE-ONLY, and this section does not apply."
 *
 * So the card below renders from the server on every request and nothing about
 * it is cached. The screen says so plainly rather than silently omitting the
 * feature — a member who tries to use this at reception with no signal needs to
 * know before they are standing there, which is P5 exactly.
 */

export const metadata: Metadata = { title: "Me" };

export const dynamic = "force-dynamic";

export default async function MePage() {
  const resolution = await resolveArmoryMember();

  if (resolution.state === "signed_out") {
    return (
      <>
        <PageHeader kicker="Me" title="Your membership" />
        <Section ground="chalk">
          <Body>Sign in to see your membership.</Body>
        </Section>
      </>
    );
  }

  if (resolution.state !== "member") {
    return (
      <>
        <PageHeader kicker="Me" title="Your membership" />
        <Section ground="chalk">
          <Body className="max-w-[68ch]">
            There is no membership against this account. If you have shot here
            as a guest, a member can put you forward.
          </Body>
        </Section>
      </>
    );
  }

  const member = resolution.member;

  if (!isArmoryDatabaseConfigured()) {
    return (
      <>
        <PageHeader kicker="Me" title="Your membership" />
        <Section ground="chalk">
          <Body>The club&rsquo;s system is not reachable just now.</Body>
        </Section>
      </>
    );
  }

  const db = getArmoryDb();

  const [account, documents, firearms, guests] = await Promise.all([
    accountFor(db, member.personId),
    documentsFor(db, member.personId),
    firearmsFor(db, member.personId),
    hostingHistoryFor(db, member.membershipId),
  ]);

  return (
    <>
      {/* ============================================================ 1 of 5
          THE MEMBERSHIP CARD. */}
      <PageHeader
        ground="teal"
        kicker="Me"
        title={memberNumberLabel(member.memberNumber)}
        lead={`${member.tier.name} · member since ${formatWeekdayDate(member.startedOn)}`}
      />

      <Section ground="chalk" rhythm="tight">
        <Caption className="block max-w-[68ch]">
          {/*
            §9.2's dependency, stated to the member rather than only in a
            comment. A member who learns at reception that their card needs a
            connection has learned it in the one place P5 says they must not.
          */}
          Your card needs a connection. The desk holds the club&rsquo;s own
          record and that is what admits you — this is here so a lookup is
          quick, not so it can stand in for one.
        </Caption>
      </Section>

      {/* ============================================================ 2 of 5
          GUESTS — the ledger, and hosting's home. §5.2, §10. */}
      <Section ground="chalk" rhythm="default" aria-labelledby="guests">
        <Kicker className="mb-2">Guests</Kicker>
        <H2 id="guests">Who you have brought.</H2>

        {member.tier.canHost ? (
          <>
            <AllowanceMeter
              className="mt-4 max-w-[40rem]"
              remaining={member.allowance.remaining}
              included={member.allowance.includedQuota}
              periodEnd={member.allowance.periodEnd}
            />

            {guests.length === 0 ? (
              <Body muted className="mt-4 max-w-[68ch]">
                Nobody yet. A guest gets their own link to fill in before they
                arrive, and their score afterwards.
              </Body>
            ) : (
              <ul className="mt-6 flex flex-col divide-y divide-[var(--rule)]/25">
                {guests.map((guest) => (
                  <li key={guest.invitationId} className="py-3">
                    <GuestLine guest={guest} />
                  </li>
                ))}
              </ul>
            )}

            {/* §6.2's "invite a guest", and §6.2's "allowance shown before and
                after" — the form states the remaining count before, and the
                action returns the new one after. */}
            <div className="mt-8 border-t border-[var(--rule)]/30 pt-6">
              <H3>Invite someone</H3>
              <InviteGuestForm
                bookingId={null}
                remaining={member.allowance.remaining}
                includedQuota={member.allowance.includedQuota}
              />
            </div>
          </>
        ) : (
          <Body muted className="mt-2">
            Your tier does not include guest visits.
          </Body>
        )}
      </Section>

      {/* ============================================================ 3 of 5
          DOCUMENTS. */}
      <Section ground="soffit" rhythm="default" aria-labelledby="documents">
        <Kicker className="mb-2">Documents</Kicker>
        <H2 id="documents">What the club holds.</H2>
        <Documents documents={documents} />
      </Section>

      {/* ============================================================ 4 of 5
          FIREARMS. Read-only by design — §9.1. */}
      <Section ground="chalk" rhythm="default" aria-labelledby="firearms">
        <Kicker className="mb-2">Firearms</Kicker>
        <H2 id="firearms">Your own firearms.</H2>

        {firearms.length === 0 ? (
          <Body muted className="mt-2 max-w-[68ch]">
            {member.tier.canOwnFirearm
              ? "Nothing registered. The club registers a firearm against a verified licence — bring both and the founder will record it."
              : "Your tier does not cover privately owned firearms."}
          </Body>
        ) : (
          <ul className="mt-6 flex flex-col gap-6">
            {firearms.map((firearm) => (
              <li key={firearm.id}>
                <Firearm firearm={firearm} />
              </li>
            ))}
          </ul>
        )}

        <Caption className="mt-6 block max-w-[68ch]">
          {/* §9.1's reason, said to the member. It reads as care rather than as
              a limitation, which is what it is. */}
          Every movement is recorded at the club, by the person who handled it.
          Nothing here can be changed from a phone.
        </Caption>
      </Section>

      {/* ============================================================ 5 of 5
          ACCOUNT. */}
      <Section ground="chalk" rhythm="default" aria-labelledby="account">
        <Kicker className="mb-2">Account</Kicker>
        <H2 id="account">{account.standing.line}</H2>
        {account.standing.remedy && (
          <Body muted className="mt-2">
            {account.standing.remedy}
          </Body>
        )}

        <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {/* Every line read off the tier row §4 reads, never restated in copy,
              so the page cannot describe a privilege the club will refuse. */}
          <Privilege
            term="Guests included"
            detail={
              member.tier.canHost
                ? `${member.allowance.includedQuota} a year · ${member.allowance.remaining} left until ${formatDate(member.allowance.periodEnd)}`
                : "This tier does not host guests."
            }
          />
          <Privilege
            term="Guests at once"
            detail={
              member.tier.canHost
                ? `${member.tier.guestConcurrentMax} in one session`
                : "—"
            }
          />
          <Privilege
            term="Disciplines"
            detail={
              member.tier.disciplineAccess.length > 0
                ? member.tier.disciplineAccess.join(", ")
                : "None recorded against this tier."
            }
          />
          <Privilege
            term="Booking"
            detail={`Up to ${member.tier.bookingHorizonDays} days ahead · ${member.tier.concurrentBookingsMax} open at a time`}
          />
        </dl>

        {account.charges.length > 0 && (
          <div className="mt-8 border-t border-[var(--rule)]/30 pt-6">
            <H3>Charges</H3>
            <ul className="mt-4 flex flex-col divide-y divide-[var(--rule)]/25">
              {account.charges.map((charge) => (
                <li key={charge.id} className="flex items-baseline gap-4 py-3">
                  <span className="min-w-0 flex-1">
                    <Caption>{charge.description}</Caption>
                    <Caption muted>
                      {formatDate(charge.raisedAt)}
                      {charge.isSettled ? " · settled" : " · outstanding"}
                    </Caption>

                    {/* Offered only where the balance actually covers it. A
                        button that refuses when pressed is worse than no button:
                        the member has to discover the shortfall by trying. */}
                    {!charge.isSettled &&
                      account.standing.balanceKobo >= charge.totalKobo && (
                        <SettleForm
                          chargeId={charge.id}
                          requestId={uuidv7()}
                          label="Settle from balance"
                        />
                      )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {format(fromStorage(charge.totalKobo), { minorUnits: true })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 border-t border-[var(--rule)]/30 pt-6">
          <H3>Top up</H3>
          <TopUpForm amounts={TOP_UP_AMOUNTS.map((amount) => format(amount))} />
        </div>

        <div className="mt-8 border-t border-[var(--rule)]/30 pt-6">
          <H3>Sign-in</H3>
          <Body muted className="mt-1 max-w-[68ch]">
            You sign in with your phone number and a password.
          </Body>
          <Link
            href={routes.portalPassword}
            className="mt-2 inline-block text-body font-display font-bold underline decoration-1 underline-offset-4"
          >
            Change your password
          </Link>
        </div>
      </Section>
    </>
  );
}

/* ============================================================================
   GUESTS
   ========================================================================= */

function GuestLine({ guest }: { guest: HostedGuest }) {
  const status = invitationStatus(guest.status);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Body>{guest.name ?? "Not opened yet"}</Body>
        <StatusPill status={status.tone} label={status.label} />
        <Caption>{formatDate(guest.issuedAt)}</Caption>
      </div>

      {/*
        §10's conversion route. It appears against the guest rather than as a
        list somewhere, because the member is the one who would make the
        introduction and this is the moment they are looking at that person's
        name.
      */}
      {isWorthConverting(guest) && (
        <Body muted className="mt-1">
          {guest.name ?? "This guest"} has been in {guest.visitsAcrossAllHosts}{" "}
          times now.{" "}
          <Link href={routes.membership} className="underline decoration-1 underline-offset-4">
            Membership would suit them
          </Link>
          .
        </Body>
      )}
    </div>
  );
}

/**
 * What an invitation's status means to the HOST.
 *
 * §14: "Guest link abandonment — flagged to the host, never to the guest." So
 * an unopened link is `attention` on this screen: the member is the one who can
 * chase it, and it is theirs to know about before the day.
 */
function invitationStatus(
  status: HostedGuest["status"],
): { tone: Status; label: string } {
  switch (status) {
    case "attended":
      return { tone: "clear", label: "Came" };
    case "completed":
      return { tone: "clear", label: "Ready" };
    case "opened":
      return { tone: "attention", label: "Half done" };
    case "issued":
      return { tone: "attention", label: "Not opened" };
    case "cancelled":
      return { tone: "blocked", label: "Cancelled" };
    case "expired":
      return { tone: "blocked", label: "Expired" };
  }
}

/* ============================================================================
   DOCUMENTS
   ========================================================================= */

function Documents({ documents }: { documents: MemberDocuments }) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <H3>Waiver</H3>
          <StatusPill
            status={documents.waiver.isCurrent ? "clear" : "blocked"}
            label={documents.waiver.isCurrent ? "Signed" : "Needs signing"}
          />
        </div>
        <Body muted className="mt-1">
          {documents.waiver.signedAt
            ? `Version ${documents.waiver.version} · signed ${formatDate(documents.waiver.signedAt)}`
            : "Not signed. The desk will take it when you next come in."}
          {documents.waiver.signedAt &&
            !documents.waiver.isCurrent &&
            documents.waiver.activeVersion &&
            ` · the club is now on version ${documents.waiver.activeVersion}`}
        </Body>
      </div>

      <div>
        <H3>Firearm licence</H3>
        {documents.licences.length === 0 ? (
          <Body muted className="mt-1">
            None on file. One is needed before you may use your own firearm.
          </Body>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {documents.licences.map((licence) => (
              <li key={licence.id} className="flex flex-wrap items-baseline gap-2">
                <StatusPill
                  status={licence.status === "verified" ? "clear" : "attention"}
                  label={LICENCE_LABELS[licence.status]}
                />
                <Body muted>
                  {licence.calibres.length > 0
                    ? licence.calibres.join(", ")
                    : "No calibres recorded"}
                  {licence.expiresOn &&
                    ` · expires ${formatDate(parseDateColumn(licence.expiresOn))}`}
                </Body>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <H3>Sign-offs</H3>
        {documents.qualifications.length === 0 ? (
          <Body muted className="mt-1">
            None recorded. Some lines need one before you shoot them
            unsupervised.
          </Body>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {documents.qualifications.map((qualification) => (
              <li key={`${qualification.discipline}-${qualification.level}`}>
                <Body muted>
                  {qualification.discipline} · {qualification.level}
                  {qualification.expiresAt &&
                    ` · until ${formatDate(qualification.expiresAt)}`}
                </Body>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const LICENCE_LABELS: Record<MemberDocuments["licences"][number]["status"], string> = {
  pending_review: "With the club",
  verified: "Verified",
  expired: "Expired",
  revoked: "Revoked",
};

/* ============================================================================
   FIREARMS
   ========================================================================= */

function Firearm({ firearm }: { firearm: MemberFirearm }) {
  return (
    <div className="border-t border-[var(--rule)]/30 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <H3>
          {firearm.make} {firearm.model}
        </H3>
        <Data>{firearm.serialNumber}</Data>
      </div>

      <Body muted className="mt-1">
        {firearm.calibre} · {FIREARM_STATE[firearm.status] ?? firearm.status}
      </Body>

      {firearm.custody.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {firearm.custody.slice(0, 5).map((event) => (
            <li key={event.id}>
              <Caption>
                {CUSTODY_WORDS[event.eventType] ?? event.eventType} ·{" "}
                {formatDate(event.occurredAt)}
              </Caption>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The club's own words for a firearm's state, rather than the column's. */
const FIREARM_STATE: Record<string, string> = {
  in_service: "At the club, in service",
  issued: "Issued",
  off_site: "With you",
  in_storage: "In storage at the club",
  at_service: "Away for service",
  decommissioned: "Decommissioned",
};

const CUSTODY_WORDS: Record<string, string> = {
  issued: "Issued to you",
  returned: "Returned",
  brought_in: "Brought in",
  taken_out: "Taken out",
  stored: "Into storage",
  withdrawn: "Out of storage",
  sent_for_service: "Sent for service",
  returned_from_service: "Back from service",
  decommissioned: "Decommissioned",
  correction: "Corrected",
};

/* ============================================================================
   SHARED
   ========================================================================= */

function Privilege({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt>
        <Caption>{term}</Caption>
      </dt>
      <dd className="mt-1 text-body text-[var(--ink)]">{detail}</dd>
    </div>
  );
}
