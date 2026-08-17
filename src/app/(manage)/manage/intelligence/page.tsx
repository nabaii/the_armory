import { notFound } from "next/navigation";
import { admitsSurface } from "@/domain/grants";
import {
  CHECK_IN_PROMISE_SECONDS,
  checkInClock,
  visitMix,
  visitMixCaveat,
} from "@/domain/intelligence";
import { mixCaveat, revenueMix } from "@/domain/revenue";
import { format } from "@/lib/money";
import { addDays } from "@/lib/time";
import { Panel } from "@/components/manage/Panel";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

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

  const source = await manageSource(principal);

  /**
   * The commercial read is gated, and the operational ones are not.
   *
   * A safety officer reaches this surface on `intelligence_operational` and must
   * see the check-in clock and the visit mix — those are their own evidence for
   * §11.3's staffing argument. They must not see a naira figure, so the charges
   * are not even FETCHED for them: a read that never happens cannot leak.
   */
  const [charges, evidence, durations] = await Promise.all([
    mayReadCommercial ? source.charges(window.from) : Promise.resolve([]),
    source.visitEvidence(window.from),
    source.checkInDurations(window.from),
  ]);

  const mix = revenueMix(charges, window);
  const caveat = mixCaveat(mix);

  const visits = visitMix({ ...evidence, window });
  const visitCaveat = visitMixCaveat(visits);
  const clock = checkInClock(durations);

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

      {/* THE FIRST FALSIFYING NUMBER — §11.2. Counts, never a percentage. */}
      <Panel title="Non-shooting visits" count={visits.visits}>
        {visitCaveat ? (
          <p className="text-sight-ink">{visitCaveat}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            <Figure label="Visits with no round fired" value={visits.nonShooting} />
            <Figure label="Visits where somebody shot" value={visits.shooting} />
            <Figure
              label="Known only from something bought"
              value={visits.fromServiceOnly}
            />
          </ul>
        )}
        {/* The basis is not optional and not a footnote. A floor honest about
            being a floor is usable; a census quietly a floor is not. */}
        <p className="mt-2 text-[11px] leading-snug text-sight-ink">{visits.basis}</p>
      </Panel>

      {/* §11.4 — a distribution and a breach count, never a mean, never per officer. */}
      <Panel
        title="The check-in clock"
        count={clock.count}
        needsDecision={clock.overPromise > 0}
      >
        {clock.medianSeconds === null ? (
          <p className="text-sight-ink">
            Nothing measured yet. The console timestamps a check-in from the moment
            the sheet opens; these figures begin at the next one.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            <Figure label="Median" value={`${clock.medianSeconds}s`} />
            <Figure label="Ninetieth percentile" value={`${clock.ninetiethSeconds}s`} />
            <Figure
              label={`Over the ${CHECK_IN_PROMISE_SECONDS}-second promise`}
              value={clock.overPromise}
              alert={clock.overPromise > 0}
            />
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-snug text-sight-ink">
          Never a mean, which hides a bad tail, and never per officer — desk speed
          is a property of the screens rather than of the staff.
        </p>
      </Panel>

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

/** One figure, with its label. Tabular so a column of them lines up. */
function Figure({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span>{label}</span>
      <span
        data-numeric
        className={`ml-auto tabular-nums ${alert ? "text-ten-ring-deep font-semibold" : ""}`}
      >
        {value}
      </span>
    </li>
  );
}
