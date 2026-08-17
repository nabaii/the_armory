import { notFound } from "next/navigation";
import Link from "next/link";
import { admitsSurface } from "@/domain/grants";
import { attribution, reportingHealth } from "@/domain/near-miss";
import { definitionOf, degradationSummary, maySetLevel } from "@/domain/operating";
import { routes } from "@/lib/site";
import { addDays } from "@/lib/time";
import { Panel } from "@/components/manage/Panel";
import { NearMissForm } from "@/components/manage/NearMissForm";
import { OperatingLevelControl } from "@/components/manage/OperatingLevelControl";
import type { ExpiryRow, LevelEvent, NearMissRow } from "@/server/armory/manage-reads";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

/**
 * SAFETY — Management System §9.
 *
 *   §9: "The surface where the club's structural separations, its non-punitive
 *    reporting culture and its forensic record all meet. It is specified
 *    conservatively."
 *
 * ===========================================================================
 * THE SURFACE ADMITS TWO GRANTS AND FILTERS INSIDE
 *
 * `safety_manage` reads the register — reports, expiries, the ladder's history.
 * `custody` reads the armoury's exceptions, because §9.1 puts custody exceptions
 * on this surface and the armourer owns them.
 *
 * So an armourer reaches this page and sees no near-miss narrative. That is the
 * same shape INTELLIGENCE uses to keep a safety officer away from revenue: the
 * surface lets you in, the grant decides what you read. Filtering here rather
 * than in the navigation is what lets one page serve two different jobs without
 * either party seeing the other's record.
 */

const QUARTER = 90;

export default async function Safety() {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "safety")) notFound();

  const readsCustody = principal.grants.has("custody");
  const mayFile = principal.grants.has("safety_report");

  /**
   * The founder reads the register without holding the grant — §9.2.
   *
   * "Reports are visible to the safety holder and the founder." Their bundle
   * deliberately withholds `safety_manage` to honour S4, so a check against
   * grants alone would hide from them the exact reports §9 says they must see.
   * The same read exemption `panelsFor` applies, applied here.
   */
  const readsRegister =
    principal.grants.has("safety_manage") || principal.role === "founder";

  const source = await manageSource(principal);
  const now = new Date();
  const since = addDays(now, -QUARTER);

  const [expiries, reports, history, level] = await Promise.all([
    readsRegister ? source.expiries(now, QUARTER) : Promise.resolve([]),
    readsRegister ? source.nearMisses(since) : Promise.resolve([]),
    readsRegister ? source.levelHistory(addDays(now, -365)) : Promise.resolve([]),
    source.currentLevel(),
  ]);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">Safety</h1>
        <p className="text-[13px] text-sight-ink">
          What went wrong, and what is about to.
        </p>
      </header>

      {/* THE OPERATING LEVEL — §6.2. First, because it is the only thing on this
          surface that changes what the club is doing right now. */}
      <Panel title="Operating level" needsDecision={level !== "normal"}>
        <OperatingLevelControl current={level} maySet={maySetLevel(principal.grants)} />
      </Panel>

      {/* §9.2's thirty-second form, for anybody who works here. */}
      {mayFile && (
        <Panel title="Report a near-miss">
          <NearMissForm />
        </Panel>
      )}

      {readsRegister && (
        <>
          <NearMissRegister reports={reports} />
          <LadderHistory events={history} />
          <ExpirySection
            title="Already lapsed"
            rows={expiries.filter((row) => row.daysRemaining < 0)}
            needsDecision
            emptyLine="Nothing has lapsed in the last 90 days."
          />
          <ExpirySection
            title="Expiring within 90 days"
            rows={expiries.filter((row) => row.daysRemaining >= 0)}
            emptyLine="Nothing expires in the next 90 days."
          />
        </>
      )}

      {readsCustody && (
        <Panel
          title="Custody exceptions"
          empty={{
            kind: "not_built",
            line:
              "Every discrepancy in the armoury register. exceptions.ts has computed these since M6; this surface does not read them yet.",
          }}
        />
      )}

      {readsRegister && (
        <Panel
          title="Incidents"
          empty={{
            kind: "not_built",
            line:
              "Recorded at the lane since M7, with narrative, people involved and outcome. Near-misses came first because an incident already has a record and a near-miss had none.",
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
   NEAR-MISSES — §9.2
   ========================================================================= */

function NearMissRegister({ reports }: { reports: NearMissRow[] }) {
  /**
   * Two 45-day halves rather than a raw count, so the sentence has something to
   * compare against. §9.2 wants the count read as reporting health, and a bare
   * number cannot be read that way.
   */
  const midpoint = addDays(new Date(), -QUARTER / 2);
  const recent = reports.filter((row) => row.reportedAt >= midpoint).length;
  const earlier = reports.length - recent;
  const health = reportingHealth({ thisPeriod: recent, previousPeriod: earlier });

  return (
    <Panel
      title="Near-misses"
      count={reports.length}
      /* Red here means "a reporting problem", never "an unsafe club". A rising
         count is the outcome this surface is built for. */
      needsDecision={health.concerning}
    >
      {/* The sentence outranks the number, and sits above it. */}
      <p
        className={`mb-2 text-[12px] leading-snug ${
          health.concerning ? "text-ten-ring-deep" : "text-sight-ink"
        }`}
      >
        {health.line}
      </p>

      {reports.length > 0 && (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li
              key={report.id}
              className="flex flex-col gap-[2px] border-l-2 border-l-terrazzo pl-2"
            >
              <p className="text-[13px] leading-snug">{report.whatHappened}</p>
              <p className="text-[11px] text-sight-ink">
                {KIND_LABELS[report.kind] ?? report.kind}
                {report.location ? ` · ${report.location}` : ""} ·{" "}
                {report.reportedAt.toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  timeZone: "Africa/Lagos",
                })}
                {" · "}
                {/* Identical for named and anonymous reports. A named one beside
                    an anonymous one would make the anonymous one conspicuous —
                    the objection to per-report choice, mitigated where it bites. */}
                {attribution()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ============================================================================
   THE LADDER'S HISTORY — §6.2, §11.3
   ========================================================================= */

function LadderHistory({ events }: { events: LevelEvent[] }) {
  if (events.length === 0) {
    return (
      <Panel
        title="Degradations"
        empty={{ kind: "clear", line: "The club has not degraded in the last year." }}
      />
    );
  }

  const summary = degradationSummary(events);
  const descents = events.filter((event) => event.to !== "normal");

  return (
    <Panel title="Degradations" count={descents.length}>
      {/* The staffing argument, made from evidence rather than from memory. */}
      <ul className="mb-2 flex flex-wrap gap-2">
        {summary.map((entry) => (
          <li key={entry.cause} className="text-[12px]">
            <span className="font-semibold tabular-nums">{entry.count}</span>{" "}
            <span className="text-sight-ink">
              {CAUSE_LABELS[entry.cause] ?? entry.cause}
            </span>
          </li>
        ))}
      </ul>

      <ul className="flex flex-col gap-1">
        {descents.slice(0, 10).map((event) => (
          <li key={event.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
            <span className="tabular-nums text-sight-ink">
              {event.at.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                timeZone: "Africa/Lagos",
              })}
            </span>
            <span className="font-medium">{definitionOf(event.to).label}</span>
            <span className="text-sight-ink">{event.note}</span>
            {event.setByName && (
              <span className="ml-auto text-[11px] text-sight-ink">{event.setByName}</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ============================================================================
   THE EXPIRY REGISTER — §9.3
   ========================================================================= */

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

const KIND_LABELS: Readonly<Record<string, string>> = {
  line_discipline: "Line discipline",
  equipment: "Equipment",
  ammunition: "Ammunition",
  movement: "Somebody moved",
  other: "Something else",
};

const CAUSE_LABELS: Readonly<Record<string, string>> = {
  staffing: "short-staffed",
  coverage: "no qualified officer",
  weather: "weather",
  equipment: "equipment",
  stadium: "stadium",
  safety: "safety decision",
  other: "other",
};
