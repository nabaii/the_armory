import { notFound } from "next/navigation";
import { getArmoryDb, schema } from "@/db/armory/client";
import { admitsSurface } from "@/domain/grants";
import { mixCaveat, revenueMix, type RevenueCharge } from "@/domain/revenue";
import { format, fromStorage } from "@/lib/money";
import { addDays } from "@/lib/time";
import { Panel } from "@/components/manage/Panel";
import { requireStaffPrincipal } from "@/server/armory/manage-session";

/**
 * INTELLIGENCE — Management System §11.
 *
 * ===========================================================================
 * THE TWO NUMBERS THAT CAN FALSIFY THE STRATEGY SIT ABOVE EVERYTHING ELSE
 *
 *   §11.2: "The club has one strategic hypothesis: that it is a hospitality
 *    business with a shooting range attached… Two numbers test it, and they
 *    should sit at the top of the founder's intelligence surface above
 *    everything else."
 *
 * Capture for both began this sprint — the `fnb` charge category, and the visit
 * evidence derived from it. Neither can say anything yet, and this screen says
 * THAT rather than rendering a composition of four charges. §11.1 is explicit:
 * "Where a figure is too small to mean anything, the surface says so rather than
 * drawing a line through three points."
 *
 * ===========================================================================
 * THE QUERY IS BOUNDED, BECAUSE AN AGGREGATE MUST NOT SLOW A CHECK-IN
 *
 * §14: "Intelligence queries must not run against the operational path
 * unguarded. A season-wide aggregate scanning the visit table while a member is
 * checking in is an availability risk."
 *
 * The read below is one quarter of the charges table, which at this club's size
 * is a few hundred rows and is safe today. It is NOT safe as a pattern: the
 * moment this surface reads visits or participations across a season it needs a
 * materialised view refreshed on a schedule, and §15 wants that load-tested
 * against a live console session before it ships.
 */

const QUARTER_DAYS = 90;

export default async function Intelligence() {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "intelligence")) notFound();

  /**
   * The commercial half is a separate grant from the operational half — S4.
   *
   * A safety officer holds `intelligence_operational` and reaches this surface
   * legitimately; they must not see revenue. The nav admitted them; this decides
   * what they read, and it asks the hand rather than the role.
   */
  const mayReadCommercial = principal.grants.has("intelligence_commercial");

  const now = new Date();
  const window = { from: addDays(now, -QUARTER_DAYS), to: now };

  const charges: RevenueCharge[] = mayReadCommercial
    ? (
        await getArmoryDb()
          .select({
            referenceType: schema.charges.referenceType,
            totalKobo: schema.charges.totalKobo,
            raisedAt: schema.charges.createdAt,
          })
          .from(schema.charges)
      ).map((row) => ({
        referenceType: row.referenceType as RevenueCharge["referenceType"],
        /* `fromStorage`, not a cast. A kobo column arrives from pg as a
           number or a string depending on its width, and the branded type
           exists precisely so that boundary is crossed in one documented
           place rather than by an assertion at each read site. */
        totalKobo: fromStorage(row.totalKobo),
        raisedAt: row.raisedAt,
      }))
    : [];

  const mix = revenueMix(charges, window);
  const caveat = mixCaveat(mix);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">Figures</h1>
        <p className="text-[13px] text-sight-ink">
          The last {QUARTER_DAYS} days. Counts, not percentages — at this cohort
          size a rate moves eight points because one person did something.
        </p>
      </header>

      {mayReadCommercial ? (
        <Panel title="Revenue mix" count={mix.count} needsDecision={mix.hasUncategorised}>
          {caveat ? (
            <p className="text-sight-ink">{caveat}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {mix.lines.map((line) => (
                <li key={line.category} className="flex items-baseline gap-2">
                  <span className="capitalize">{line.category}</span>
                  <span
                    data-numeric
                    className="ml-auto tabular-nums"
                  >
                    {format(line.amountKobo)}
                  </span>
                  {/* §11.1's sample size, beside the figure and not in a
                      footnote. A line built from two charges is two charges. */}
                  <span
                    data-numeric
                    className="w-10 shrink-0 text-right tabular-nums text-sight-ink"
                  >
                    {line.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {caveat && (
            <p className="mt-1 text-[11px] text-sight-ink">
              Capture began on 17 August 2026. The mix is readable once the club
              has traded a quarter against it.
            </p>
          )}
        </Panel>
      ) : (
        <Panel
          title="Revenue mix"
          empty={{
            kind: "clear",
            line:
              "Commercial figures are held under a separate grant. A person who can stop the range is never measured on commercial outcomes.",
          }}
        />
      )}

      <Panel
        title="Non-shooting visit share"
        empty={{
          kind: "not_built",
          line:
            "Computable from this sprint — a categorised F&B charge on a day with no round fired is the evidence. The screen needs a quarter of capture behind it, and the figure is a floor rather than a census.",
        }}
      />

      <Panel
        title="The check-in clock"
        empty={{
          kind: "not_built",
          line:
            "The console started timestamping arrivals this sprint. Reported as a distribution and a count over the promise, never as a mean and never per officer.",
        }}
      />

      <Panel
        title="Member analytics"
        empty={{
          kind: "not_built",
          line:
            "Blocked, and should stay blocked. A per-member behavioural record is a surveillance capability as much as a management one, and the retention schedule for attendance records is an open legal question.",
        }}
      />
    </div>
  );
}
