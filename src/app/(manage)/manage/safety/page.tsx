import { notFound } from "next/navigation";
import Link from "next/link";
import { admitsSurface } from "@/domain/grants";
import { routes } from "@/lib/site";
import { Panel } from "@/components/manage/Panel";
import type { ExpiryRow } from "@/server/armory/manage-reads";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

/**
 * SAFETY — Management System §9, and the expiry register in particular.
 *
 *   §9.3: "The data exists across M2 and is currently only visible one person at
 *    a time. A single register — every licence and qualification across staff
 *    and members, ordered by expiry — turns a recurring compliance failure into
 *    a routine weekly glance. It is one query and one screen, and it is the
 *    cheapest serious risk reduction in this document."
 *
 * So it is the first thing built on this surface. Incidents and custody
 * exceptions already have data behind them; near-miss reporting does not exist
 * yet and is the next piece, because §9.2 is right that culture is set in the
 * first month rather than the sixth.
 */

export default async function Safety() {
  const principal = await requireStaffPrincipal();

  /**
   * The surface guard, in the page rather than only in the layout.
   *
   * The layout says "you are staff". Only this says "you may see safety". A
   * layout check protects the page from a stranger; it does not stop a member
   * of finance typing /manage/safety into the address bar, and §5.1's whole
   * claim is that a separation refused by the navigation must also be refused
   * by the route.
   *
   * `notFound` rather than a refusal page: the club does not confirm the shape
   * of surfaces somebody may not see.
   */
  if (!admitsSurface(principal, "safety")) notFound();

  const source = await manageSource(principal);
  const rows = await source.expiries(new Date(), 90);

  const lapsed = rows.filter((row) => row.daysRemaining < 0);
  const soon = rows.filter((row) => row.daysRemaining >= 0);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">Safety</h1>
        <p className="text-[13px] text-sight-ink">
          Everything expiring across the roster and the staff, soonest first.
        </p>
      </header>

      {/* Lapsed first, and separately. A lapsed licence and one expiring in
          seven weeks are not the same item on a list — the first is somebody who
          may be refused at the firing point this evening. */}
      <ExpirySection
        title="Already lapsed"
        rows={lapsed}
        needsDecision
        emptyLine="Nothing has lapsed in the last 90 days."
      />

      <ExpirySection
        title="Expiring within 90 days"
        rows={soon}
        emptyLine="Nothing expires in the next 90 days."
      />

      <div className="grid gap-2 md:grid-cols-2">
        <Panel
          title="Near-misses"
          empty={{
            kind: "not_built",
            line:
              "A form short enough to file from a phone in under thirty seconds, asking what happened rather than who did it. Never attributed, never on a commercial screen.",
          }}
        />
        <Panel
          title="Incidents"
          empty={{
            kind: "not_built",
            line: "Recorded at the lane since M7. This surface reads them; it does not yet.",
          }}
        />
      </div>
    </div>
  );
}

function ExpirySection({
  title,
  rows,
  emptyLine,
  needsDecision = false,
}: {
  title: string;
  rows: ExpiryRow[];
  emptyLine: string;
  needsDecision?: boolean;
}) {
  if (rows.length === 0) {
    return <Panel title={title} empty={{ kind: "clear", line: emptyLine }} />;
  }

  return (
    <Panel title={title} count={rows.length} needsDecision={needsDecision}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-sight-grey/30 text-left text-[11px] uppercase tracking-[0.1em] text-sight-ink">
              <th scope="col" className="py-1 pr-2 font-semibold">Person</th>
              <th scope="col" className="py-1 pr-2 font-semibold">No.</th>
              <th scope="col" className="py-1 pr-2 font-semibold">What</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Expires</th>
              <th scope="col" className="py-1 font-semibold">Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.personId}-${row.kind}-${row.label}`}
                className="border-b border-sight-grey/15 last:border-0"
              >
                <td className="py-1 pr-2">
                  <Link
                    href={routes.managePerson(row.personId)}
                    className="border-b border-transparent hover:border-sight-grey"
                  >
                    {row.name}
                  </Link>
                </td>
                <td data-numeric className="py-1 pr-2 tabular-nums text-sight-ink">
                  {row.memberNumber ?? "—"}
                </td>
                <td className="py-1 pr-2">{row.label}</td>
                <td className="py-1 pr-2 tabular-nums text-sight-ink">
                  {row.expiresOn.toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "Africa/Lagos",
                  })}
                </td>
                <td
                  data-numeric
                  className={`py-1 tabular-nums ${
                    row.daysRemaining < 0 ? "text-ten-ring-deep" : "text-sight-ink"
                  }`}
                >
                  {row.daysRemaining}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
