import Link from "next/link";
import { notFound } from "next/navigation";
import { admitsSurface } from "@/domain/grants";
import { mixCaveat, revenueMix } from "@/domain/revenue";
import { format, fromStorage, type Kobo } from "@/lib/money";
import { routes } from "@/lib/site";
import { addDays } from "@/lib/time";
import { Panel } from "@/components/manage/Panel";
import type { BalanceRow, FailedPaymentRow } from "@/server/armory/manage-reads";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

/**
 * LEDGER — Management System §10.
 *
 * Constrained by S3: nobody holding armoury custody sees this surface. That is
 * NOT enforced here, and the absence is deliberate — it is enforced in
 * `refuseCombination`, at the moment the grant is issued. A check on this page
 * would be a second implementation of a governance rule, and the second one is
 * always the one that drifts.
 *
 * ===========================================================================
 * TAKINGS ARE THE MIX, NOT A TOTAL
 *
 * §10: "The category split on takings is not a reporting nicety. It is the input
 * to the single most important number in Section 11, and if charges are not
 * categorised at the point they are raised the split cannot be reconstructed
 * afterwards."
 *
 * So this page renders the same `revenueMix` INTELLIGENCE renders, over a
 * shorter window. One computation consumed twice, per §11.6 — because the first
 * time a report disagrees with a dashboard, the founder stops trusting both.
 */

const MONTH = 30;

export default async function Ledger() {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "ledger")) notFound();

  const source = await manageSource(principal);
  const now = new Date();
  const since = addDays(now, -MONTH);

  const [charges, outstanding, failures] = await Promise.all([
    source.charges(since),
    source.balances(now),
    source.failedPayments(addDays(now, -90)),
  ]);

  const mix = revenueMix(charges, { from: since, to: now });
  const caveat = mixCaveat(mix);

  /* Summed through `fromStorage` rather than cast. Kobo is branded precisely so
     a total cannot be built out of loose numbers and quietly become a float. */
  const owed = fromStorage(
    outstanding.reduce((total, row) => total + Number(row.outstandingKobo), 0),
  );

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">Ledger</h1>
        <p className="text-[13px] text-sight-ink">
          What the club is owed, and what it took. The last {MONTH} days.
        </p>
      </header>

      <div className="grid gap-2 md:grid-cols-2">
        <Panel
          title="Takings, by category"
          count={mix.count}
          needsDecision={mix.hasUncategorised}
        >
          {caveat ? (
            <p className="text-sight-ink">{caveat}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {mix.lines.map((line) => (
                <li key={line.category} className="flex items-baseline gap-2">
                  <span className="capitalize">{CATEGORY_LABELS[line.category] ?? line.category}</span>
                  <span data-numeric className="ml-auto tabular-nums">
                    {format(line.amountKobo)}
                  </span>
                  {/* §11.1's sample size, beside the figure rather than in a
                      footnote. A line built from two charges is two charges. */}
                  <span
                    data-numeric
                    className="w-8 shrink-0 text-right tabular-nums text-sight-ink"
                  >
                    {line.count}
                  </span>
                </li>
              ))}
              <li className="mt-1 flex items-baseline gap-2 border-t border-sight-grey/30 pt-1 font-semibold">
                <span>Total</span>
                <span data-numeric className="ml-auto tabular-nums">
                  {format(mix.totalKobo)}
                </span>
                <span className="w-8 shrink-0" />
              </li>
            </ul>
          )}
          {mix.hasUncategorised && (
            <p className="mt-1 text-[11px] leading-snug text-ten-ring-deep">
              Some of this is uncategorised — adjustments entered by hand. Anything
              sold on the deck belongs on the F&amp;B line, and an adjustment that
              should have been one is a figure the club cannot read next quarter.
            </p>
          )}
        </Panel>

        <Balances rows={outstanding} totalKobo={owed} />
      </div>

      <FailedPayments rows={failures} />

      <Panel
        title="Reconciliation"
        empty={{
          kind: "not_built",
          line:
            "Paystack against the ledger, unmatched in both directions. The scheduled sweep is a security-review blocker and ships before this screen — a reconciliation surface without the sweep behind it would show a clean slate it had not checked.",
        }}
      />
    </div>
  );
}

/* ============================================================================
   BALANCES — §10, "outstanding by member, with age"
   ========================================================================= */

function Balances({
  rows,
  totalKobo,
}: {
  rows: BalanceRow[];
  totalKobo: Kobo;
}) {
  if (rows.length === 0) {
    return (
      <Panel
        title="Balances"
        empty={{ kind: "clear", line: "Nothing outstanding. Every charge is settled." }}
      />
    );
  }

  /* Thirty days is the line where an unpaid charge stops being a timing
     difference and starts being a conversation nobody has had. */
  const stale = rows.filter((row) => row.ageDays > 30);

  return (
    <Panel title="Balances" count={rows.length} needsDecision={stale.length > 0}>
      <ul className="flex flex-col gap-1">
        {rows.slice(0, 12).map((row) => (
          <li key={row.personId} className="flex items-baseline gap-2">
            <Link
              href={routes.managePerson(row.personId)}
              className="truncate border-b border-transparent hover:border-sight-grey"
            >
              {row.name}
            </Link>
            <span data-numeric className="ml-auto shrink-0 tabular-nums">
              {format(row.outstandingKobo)}
            </span>
            {/* Ordered by AGE, not by amount — a large fresh balance is somebody
                who has just been charged, and a small old one is the problem. */}
            <span
              data-numeric
              className={`w-10 shrink-0 text-right tabular-nums ${
                row.ageDays > 30 ? "text-ten-ring-deep" : "text-sight-ink"
              }`}
            >
              {row.ageDays}d
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 border-t border-sight-grey/30 pt-1 text-[13px] font-semibold">
        <span data-numeric className="tabular-nums">
          {format(totalKobo)}
        </span>{" "}
        <span className="font-normal text-sight-ink">outstanding in total</span>
      </p>
    </Panel>
  );
}

/* ============================================================================
   FAILED PAYMENTS — §10
   ========================================================================= */

function FailedPayments({ rows }: { rows: FailedPaymentRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel
        title="Failed payments"
        empty={{ kind: "clear", line: "No payment has failed in the last 90 days." }}
      />
    );
  }

  return (
    <Panel title="Failed payments" count={rows.length} needsDecision>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-sight-grey/30 text-left text-[11px] uppercase tracking-[0.1em] text-sight-ink">
              <th scope="col" className="py-1 pr-2 font-semibold">Member</th>
              <th scope="col" className="py-1 pr-2 font-semibold">For</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Amount</th>
              <th scope="col" className="py-1 pr-2 font-semibold">When</th>
              <th scope="col" className="py-1 font-semibold">Told?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-sight-grey/15 last:border-0">
                <td className="py-1 pr-2">
                  <Link
                    href={routes.managePerson(row.personId)}
                    className="border-b border-transparent hover:border-sight-grey"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="py-1 pr-2 text-sight-ink">
                  {PURPOSE_LABELS[row.purpose] ?? row.purpose}
                </td>
                <td data-numeric className="py-1 pr-2 tabular-nums">
                  {format(row.amountKobo)}
                </td>
                <td className="py-1 pr-2 tabular-nums text-sight-ink">
                  {row.at.toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    timeZone: "Africa/Lagos",
                  })}
                </td>
                {/**
                 * §10 asks for these "with the remedy, and whether the member has
                 * been told". Nothing records that, and this column does not
                 * pretend otherwise — a tick claiming a member had been contacted
                 * when nobody had is worse than the gap it hides.
                 */}
                <td className="py-1 text-ten-ring-deep">Not recorded</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-sight-ink">
        Whether the member has been told is not recorded anywhere in the system.
        Until it is, this column is honest rather than useful.
      </p>
    </Panel>
  );
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  membership: "Membership",
  range: "Range",
  fnb: "Food and drink",
  guest: "Guest fees",
  storage: "Storage",
  uncategorised: "Uncategorised",
};

const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  subscription: "Membership",
  guest_overage: "Guest overage",
  account_topup: "Account top-up",
  bar: "Bar",
  retail: "Retail",
  other: "Other",
};
