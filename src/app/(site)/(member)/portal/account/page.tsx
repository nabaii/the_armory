import type { Metadata } from "next";
import { getArmoryDb, isArmoryDatabaseConfigured } from "@/db/armory/client";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { accountFor } from "@/server/armory/money";
import { TOP_UP_AMOUNTS } from "@/content/top-up";
import { format, fromStorage } from "@/lib/money";
import { formatWeekdayDate } from "@/lib/time";
import { uuidv7 } from "@/lib/uuidv7";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SettleForm, TopUpForm } from "@/components/member/AccountForms";
import { AddEmailForm } from "@/components/member/EmailForms";
import { emailStateFor } from "@/server/armory/email-verification";
import { Body, Caption, H2, H3 } from "@/components/ui/Text";

/**
 * ACCOUNT — §6.2.
 *
 *   "Charges, payments, balance, renewal date, TIER AND ITS PRIVILEGES STATED
 *    PLAINLY."
 *
 * ===========================================================================
 * "STATED PLAINLY" IS THE HARD PART, AND IT IS ABOUT THE PRIVILEGES
 *
 * The money on this page is easy: four numbers, one sentence, a list. The tier
 * is where clubs are habitually vague — "Full membership includes generous
 * guest privileges" — and vagueness there has a specific cost in this system.
 *
 * §12.1: "Allowance exhausted mid-booking → Overage offered in the portal with
 * the price shown. NEVER DISCOVERED AT THE DESK." A member who does not know
 * how many guests they get is a member who finds out in front of their guest,
 * which §4.3 names as a defect in this system.
 *
 * So the tier block below is a list of numbers, not a paragraph. Every one of
 * them is read off the tier row that §4's capability service reads — not
 * restated in copy — so the page cannot describe a privilege the club will
 * refuse.
 *
 * ===========================================================================
 * THE LEDGER IS ON THIS PAGE AND IT IS NOT THE HEADLINE
 *
 * §3.5 makes the balance derived from `account_transactions`, and a member who
 * disputes a number needs to be able to see the entries it came from. But
 * almost nobody wants a ledger — they want "what do I owe" — so the standing
 * sentence is the header, charges and payments are the body, and the raw
 * entries are last.
 */

export const metadata: Metadata = { title: "Your account" };

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const resolution = await resolveArmoryMember();

  if (resolution.state === "signed_out") {
    return (
      <Section>
        <PageHeader title="Your account" />
        <Body>Sign in to see your account.</Body>
      </Section>
    );
  }

  if (resolution.state !== "member") {
    return (
      <Section>
        <PageHeader title="Your account" />
        <Body>
          There is no membership against this account. If you have shot here as
          a guest, a member can put you forward.
        </Body>
      </Section>
    );
  }

  const member = resolution.member;

  if (!isArmoryDatabaseConfigured()) {
    return (
      <Section>
        <PageHeader title="Your account" />
        <Body>The club&rsquo;s system is not reachable just now.</Body>
      </Section>
    );
  }

  const [account, emailState] = await Promise.all([
    accountFor(getArmoryDb(), member.personId),
    emailStateFor(member.personId),
  ]);

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Your account"
        title={account.standing.line}
        lead={account.standing.remedy ?? undefined}
      />

      {/* --------------------------------------------------------- HOW YOU GET IN

          Placed above the money deliberately. A member reads this page when
          something is wrong, and the thing most likely to be wrong on a page
          they cannot reach is that they could not get to it — §12 is explicit
          that a member must never be surprised, and being locked out of your own
          club with no way back is the largest surprise this system can produce.
      */}

      <Section ground="soffit" aria-labelledby="signing-in">
        <H2 id="signing-in">How you sign in</H2>
        <div className="mt-3">
          <AddEmailForm
            state={emailState.state}
            current={emailState.state === "none" ? undefined : emailState.email}
          />
        </div>
      </Section>

      {/* ------------------------------------------------- TIER AND PRIVILEGES */}

      <Section aria-labelledby="tier">
        <H2 id="tier">{member.tier.name}</H2>
        <Caption muted className="mt-1">
          Member {member.memberNumber} · since{" "}
          {formatWeekdayDate(member.startedOn)}
        </Caption>

        <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {/**
           * Every line is read off the tier row §4 reads. §12.1 in one
           * component: the guest allowance and what is left of it, stated
           * before the member ever reaches a booking screen.
           */}
          <Privilege
            term="Guests included"
            detail={
              member.tier.canHost
                ? `${member.allowance.includedQuota} a year · ${member.allowance.remaining} left until ${formatWeekdayDate(member.allowance.periodEnd)}`
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
          <Privilege
            term="Your own firearm"
            detail={
              member.tier.canOwnFirearm
                ? "Permitted, with a verified licence on file."
                : "Not on this tier."
            }
          />
          <Privilege
            term="Storage at the club"
            detail={
              member.tier.canStoreFirearm
                ? "Permitted. The club will confirm a cabinet."
                : "Not on this tier."
            }
          />
        </dl>
      </Section>

      {/* ------------------------------------------------------------ CHARGES */}

      <Section ground="soffit" aria-labelledby="charges">
        <H2 id="charges">Charges</H2>

        {account.charges.length === 0 ? (
          <Body className="mt-4">Nothing has been charged to this account.</Body>
        ) : (
          <ul className="mt-6 divide-y divide-[--color-terrazzo]">
            {account.charges.map((charge) => (
              <li key={charge.id} className="flex items-baseline gap-4 py-3">
                <span className="min-w-0 flex-1">
                  <Caption>{charge.description}</Caption>
                  <Caption muted>
                    {formatWeekdayDate(charge.raisedAt)}
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
        )}

        {/* §9's account top-up, on the screen that shows what it is for. */}
        <div className="mt-8 border-t border-[--color-terrazzo] pt-6">
          <H3>Top up</H3>
          <TopUpForm
            amounts={TOP_UP_AMOUNTS.map((amount) => format(amount))}
          />
        </div>
      </Section>

      {/* ----------------------------------------------------------- PAYMENTS */}

      <Section aria-labelledby="payments">
        <H2 id="payments">Payments</H2>

        {account.payments.length === 0 ? (
          <Body className="mt-4">No payments recorded yet.</Body>
        ) : (
          <ul className="mt-6 divide-y divide-[--color-terrazzo]">
            {account.payments.map((payment) => (
              <li key={payment.id} className="flex items-baseline gap-4 py-3">
                <span className="min-w-0 flex-1">
                  <Caption>{PURPOSE_LABELS[payment.purpose]}</Caption>
                  <Caption muted>
                    {payment.paidAt
                      ? formatWeekdayDate(payment.paidAt)
                      : /* §9: state is webhook-driven. A payment the club has
                           started and not yet heard the end of says so, rather
                           than being hidden or shown as though it had landed. */
                        "Awaiting confirmation from the bank"}
                  </Caption>
                </span>
                <span className="shrink-0 tabular-nums">
                  {format(fromStorage(payment.amountKobo), { minorUnits: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ------------------------------------------------------------- LEDGER */}

      {account.ledger.length > 0 && (
        <Section ground="soffit" aria-labelledby="ledger">
          <H3 id="ledger">Every entry</H3>
          <Body muted className="mt-2">
            Your balance is the sum of these. Nothing is written to it directly.
          </Body>

          <ul className="mt-4 divide-y divide-[--color-terrazzo]">
            {account.ledger.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-4 py-2">
                <span className="min-w-0 flex-1">
                  <Caption muted>
                    {formatWeekdayDate(entry.at)} · {entry.description}
                  </Caption>
                </span>
                <span className="shrink-0 tabular-nums">
                  {entry.direction === "credit" ? "+" : "−"}
                  {format(fromStorage(entry.amountKobo), { minorUnits: true })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** §3.5's purposes, in words a member would use for them. */
const PURPOSE_LABELS: Record<string, string> = {
  subscription: "Membership",
  guest_overage: "Guest visit",
  account_topup: "Top-up",
  bar: "Bar",
  retail: "Shop",
  other: "Other",
};

function Privilege({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-sm tracking-wide text-[--color-sight-ink] uppercase">
        {term}
      </dt>
      <dd className="mt-1">{detail}</dd>
    </div>
  );
}
