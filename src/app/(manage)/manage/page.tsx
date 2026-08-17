import Link from "next/link";
import { panelsFor, type DayPanel } from "@/domain/grants";
import { maySetLevel } from "@/domain/operating";
import { revenueMix } from "@/domain/revenue";
import { ZERO, format } from "@/lib/money";
import { addDays } from "@/lib/time";
import { NearMissForm } from "@/components/manage/NearMissForm";
import { OperatingLevelControl } from "@/components/manage/OperatingLevelControl";
import { TakeApplication } from "@/components/manage/TakeApplication";
import { gateSummary, outstanding } from "@/lib/content-gate";
import { routes } from "@/lib/site";
import { lagosDateKey } from "@/lib/time";
import { Panel, type EmptyState } from "@/components/manage/Panel";
import {
  type ApplicationRow,
  type ArrivalRow,
  type ExpiryRow,
  type OperatingLevelValue,
  type RevenueChargeRow,
} from "@/server/armory/manage-reads";
import type { StaffPrincipal } from "@/server/armory/grants";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

/**
 * THE DAY — Management System §6.
 *
 *   "The dashboard, and the landing surface for every role. It answers one
 *    question — what is happening, and what needs me — and it answers it
 *    differently for each person."
 *
 * ===========================================================================
 * COMPOSED FROM THE HAND, NOT SWITCHED ON THE ROLE
 *
 * §6.1 describes a dashboard composed per role, which reads as five dashboards
 * to build, test and keep honest — and a sixth the moment the founder invents a
 * role in November. `panelsFor` inverts it: each panel declares the grant it
 * needs, and this page renders whatever the viewer's hand admits, in a fixed
 * order.
 *
 * There is no `if (role === …)` anywhere below, and there must never be one.
 * S1: no management screen evaluates a permission.
 *
 * ===========================================================================
 * THE DATA IS FETCHED ONCE FOR THE PANELS THAT ARE ACTUALLY RENDERED
 *
 * A page that read every panel's data and then discarded most of it would put
 * the roster, the applications queue and the expiry register through Postgres
 * for a front-of-house phone that shows two panels — and §14 warns that an
 * unguarded management query is an availability risk against the desk. So the
 * reads are keyed to the admitted set.
 */

export default async function TheDay() {
  const principal = await requireStaffPrincipal();
  const panels = panelsFor(principal);
  const shown = new Set(panels.map((panel) => panel.id));

  const now = new Date();

  /* Real or demonstration — decided once per request, in one place. A page that
     reached for a database client directly would bypass the switch, which is why
     this holds a source rather than a `db`. */
  const source = await manageSource(principal);

  const [arrivals, applications, expiries, charges, level] = await Promise.all([
    shown.has("arrivals") ? source.arrivals(now) : null,
    shown.has("applications") ? source.applications(now) : null,
    shown.has("expiries-today") ? source.expiries(now, 30) : null,
    shown.has("takings") || shown.has("business-strip")
      ? source.charges(addDays(now, -30))
      : null,
    shown.has("operating-level") ? source.currentLevel() : null,
  ]);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-sight-ink">
          {lagosDateKey(now)}
        </p>
        <h1 className="text-2xl font-bold leading-none">The day</h1>
      </header>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {panels.map((panel) => (
          <PanelBody
            key={panel.id}
            panel={panel}
            principal={principal}
            arrivals={arrivals}
            applications={applications}
            expiries={expiries}
            charges={charges}
            level={level}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One panel's content.
 *
 * A switch over the panel id rather than a component per panel, so that adding
 * a panel to `DAY_PANELS` and forgetting to render it is a TYPE ERROR rather
 * than a silently missing square on somebody's dashboard.
 */
function PanelBody({
  panel,
  principal,
  arrivals,
  applications,
  expiries,
  charges,
  level,
}: {
  panel: DayPanel;
  principal: StaffPrincipal;
  arrivals: ArrivalRow[] | null;
  applications: ApplicationRow[] | null;
  expiries: ExpiryRow[] | null;
  charges: RevenueChargeRow[] | null;
  level: OperatingLevelValue | null;
}) {
  switch (panel.id) {
    case "arrivals":
      return <ArrivalsPanel title={panel.title} rows={arrivals ?? []} />;

    case "applications":
      return (
        <ApplicationsPanel
          title={panel.title}
          rows={applications ?? []}
          staffUserId={principal.staffUserId}
        />
      );

    case "expiries-today":
      return <ExpiriesPanel title={panel.title} rows={expiries ?? []} />;

    case "gate-register":
      return <RegisterPanel title={panel.title} />;

    /**
     * Everything below is admitted by grant and not yet built.
     *
     * Named individually rather than swept into a default, so that the list of
     * what remains is legible in the code and a new panel cannot join it by
     * accident. Each says what it is waiting for — an internal tool owes its
     * own staff the same honesty S2 demands of a figure.
     */
    case "guest-links":
      return <NotBuilt title={panel.title} line="Guest invitations outstanding, with their host." />;
    case "walk-ups":
      return <NotBuilt title={panel.title} line="Members who arrived unbooked and need a decision." />;
    case "coverage":
      return <CoveragePanel title={panel.title} rows={arrivals ?? []} />;

    /* §9.2 wants the form one tap from everywhere. This is the tap. */
    case "file-near-miss":
      return (
        <Panel title={panel.title}>
          <NearMissForm />
        </Panel>
      );

    case "operating-level":
      return (
        <Panel title={panel.title} needsDecision={(level ?? "normal") !== "normal"}>
          <OperatingLevelControl
            current={level ?? "normal"}
            maySet={maySetLevel(principal.grants)}
          />
        </Panel>
      );

    case "takings":
      return <TakingsPanel title={panel.title} charges={charges ?? []} />;

    case "business-strip":
      return <BusinessPanel title={panel.title} charges={charges ?? []} />;

    case "open-safety":
      return (
        <Panel
          title={panel.title}
          empty={{
            kind: "not_built",
            line: "Incidents still open, from M7's lane records. The near-miss register is on SAFETY.",
          }}
        />
      );
    case "unreconciled":
      return <NotBuilt title={panel.title} line="Paystack against the ledger. The sweep is a security blocker." />;
  }
}

/* ============================================================================
   THE PANELS
   ========================================================================= */

function ArrivalsPanel({ title, rows }: { title: string; rows: ArrivalRow[] }) {
  const outstanding = rows.filter((row) => !row.checkedIn);

  if (rows.length === 0) {
    return (
      <Panel
        title={title}
        empty={{ kind: "clear", line: "Nobody is booked in today." }}
      />
    );
  }

  return (
    <Panel title={title} count={outstanding.length}>
      <ul className="flex flex-col gap-1">
        {rows.slice(0, 12).map((row) => (
          <li key={`${row.personId}-${row.at.toISOString()}`} className="flex gap-2">
            <time
              dateTime={row.at.toISOString()}
              className="w-12 shrink-0 tabular-nums text-sight-ink"
            >
              {row.at.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Africa/Lagos",
              })}
            </time>
            <span className={row.checkedIn ? "text-sight-ink line-through" : ""}>
              {row.name}
            </span>
            <span className="ml-auto text-sight-ink">
              {row.discipline ?? row.bookingType}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ApplicationsPanel({
  title,
  rows,
  staffUserId,
}: {
  title: string;
  rows: ApplicationRow[];
  staffUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <Panel
        title={title}
        empty={{ kind: "clear", line: "No applications are waiting." }}
      />
    );
  }

  /**
   * §8.2: "an application with no owner appears on the founder's DAY until it
   * has one." So the panel needs a decision exactly while something is unowned,
   * and stops shouting once every application has a name against it.
   */
  const unowned = rows.filter((row) => row.ownerStaffId === null);

  return (
    <Panel title={title} count={rows.length} needsDecision={unowned.length > 0}>
      <ul className="flex flex-col gap-1">
        {rows.slice(0, 8).map((row) => (
          <li key={row.id} className="flex items-baseline gap-2">
            <span className="truncate">{row.name}</span>
            <span
              data-numeric
              className={`ml-auto shrink-0 tabular-nums ${
                row.ageDays > 14 ? "text-ten-ring-deep" : "text-sight-ink"
              }`}
            >
              {row.ageDays}d
            </span>
            <TakeApplication
              applicationId={row.id}
              ownedByMe={row.ownerStaffId === staffUserId}
              ownerName={row.ownerName}
            />
          </li>
        ))}
      </ul>
      {unowned.length > 0 && (
        <p className="mt-1 text-[11px] text-ten-ring-deep">
          {unowned.length} of these {rows.length === 1 ? "has" : "have"} nobody
          carrying {unowned.length === 1 ? "it" : "them"}.
        </p>
      )}
    </Panel>
  );
}

/* ============================================================================
   COVERAGE — §6.1, the range officer's panel
   ========================================================================= */

function CoveragePanel({ title, rows }: { title: string; rows: ArrivalRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel
        title={title}
        empty={{ kind: "clear", line: "Nothing booked, so nothing to cover." }}
      />
    );
  }

  /* Demand by discipline, which is what "coverage" means to somebody deciding
     whether tonight needs a second officer. Table bookings are counted apart —
     they need a cover rather than a firing point. */
  const byDiscipline = new Map<string, number>();
  let tables = 0;

  for (const row of rows) {
    if (row.discipline) {
      byDiscipline.set(row.discipline, (byDiscipline.get(row.discipline) ?? 0) + 1);
    }
    if (row.bookingType === "table" || row.bookingType === "both") tables += 1;
  }

  return (
    <Panel title={title} count={rows.length}>
      <ul className="flex flex-col gap-1">
        {[...byDiscipline.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([discipline, count]) => (
            <li key={discipline} className="flex items-baseline gap-2">
              <span>{discipline}</span>
              <span data-numeric className="ml-auto tabular-nums">
                {count}
              </span>
            </li>
          ))}
        {tables > 0 && (
          <li className="flex items-baseline gap-2 border-t border-sight-grey/25 pt-1">
            <span className="text-sight-ink">At the tables</span>
            <span data-numeric className="ml-auto tabular-nums text-sight-ink">
              {tables}
            </span>
          </li>
        )}
      </ul>
      <p className="mt-1 text-[11px] leading-snug text-sight-ink">
        Officer coverage is declared per opening period, not rostered here — §13
        keeps the rota out of the system.
      </p>
    </Panel>
  );
}

/* ============================================================================
   MONEY ON THE DAY — §6.1, finance and the founder
   ========================================================================= */

function TakingsPanel({
  title,
  charges,
}: {
  title: string;
  charges: RevenueChargeRow[];
}) {
  const now = new Date();
  const mix = revenueMix(charges, { from: addDays(now, -30), to: now });

  if (mix.count === 0) {
    return (
      <Panel
        title={title}
        empty={{ kind: "clear", line: "No charges raised in the last 30 days." }}
      />
    );
  }

  return (
    <Panel title={title} count={mix.count} needsDecision={mix.hasUncategorised}>
      <ul className="flex flex-col gap-1">
        {mix.lines
          .filter((line) => line.count > 0)
          .map((line) => (
            <li key={line.category} className="flex items-baseline gap-2">
              <span className="capitalize">{line.category}</span>
              <span data-numeric className="ml-auto tabular-nums">
                {format(line.amountKobo)}
              </span>
            </li>
          ))}
      </ul>
      <Link
        href={routes.manageLedger}
        className="mt-1 inline-block border-b border-sight-grey pb-[1px] text-[11px] text-sight-ink"
      >
        The ledger
      </Link>
    </Panel>
  );
}

/**
 * THE FOUNDER'S BUSINESS STRIP — §6.1.
 *
 * Two lines, and they are §11.2's two falsifying numbers rather than a revenue
 * total. A founder's DAY should carry the figures that could change the club's
 * strategy, not the ones that make it look busy.
 */
function BusinessPanel({
  title,
  charges,
}: {
  title: string;
  charges: RevenueChargeRow[];
}) {
  const now = new Date();
  const mix = revenueMix(charges, { from: addDays(now, -30), to: now });
  const fnb = mix.lines.find((line) => line.category === "fnb");
  const range = mix.lines.find((line) => line.category === "range");

  if (mix.count === 0) {
    return (
      <Panel
        title={title}
        empty={{
          kind: "clear",
          line: "Nothing traded in the last 30 days, so there is no mix to read.",
        }}
      />
    );
  }

  return (
    <Panel title={title} count={mix.count}>
      <ul className="flex flex-col gap-1">
        <li className="flex items-baseline gap-2">
          <span>Food and drink</span>
          <span data-numeric className="ml-auto tabular-nums">
            {format(fnb?.amountKobo ?? ZERO)}
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span>Range</span>
          <span data-numeric className="ml-auto tabular-nums">
            {format(range?.amountKobo ?? ZERO)}
          </span>
        </li>
      </ul>
      <p className="mt-1 text-[11px] leading-snug text-sight-ink">
        A club whose food and drink line is trivial is a range with a bar. Read it
        against a quarter, never a day — §11.1.
      </p>
      <Link
        href={routes.manageIntelligence}
        className="mt-1 inline-block border-b border-sight-grey pb-[1px] text-[11px] text-sight-ink"
      >
        The figures
      </Link>
    </Panel>
  );
}

function ExpiriesPanel({ title, rows }: { title: string; rows: ExpiryRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel
        title={title}
        empty={{ kind: "clear", line: "Nothing expires in the next 30 days." }}
      />
    );
  }

  const lapsed = rows.filter((row) => row.daysRemaining < 0);

  return (
    <Panel title={title} count={rows.length} needsDecision={lapsed.length > 0}>
      <ul className="flex flex-col gap-1">
        {rows.slice(0, 8).map((row) => (
          <li key={`${row.personId}-${row.label}`} className="flex items-baseline gap-2">
            <span className="truncate">{row.name}</span>
            <span
              className={`ml-auto shrink-0 tabular-nums ${
                row.daysRemaining < 0 ? "text-ten-ring-deep" : "text-sight-ink"
              }`}
            >
              {row.daysRemaining < 0 ? "lapsed" : `${row.daysRemaining}d`}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href={routes.manageSafety}
        className="mt-1 inline-block border-b border-sight-grey pb-[1px] text-[11px] text-sight-ink"
      >
        The whole register
      </Link>
    </Panel>
  );
}

/**
 * THE GATE REGISTER — §6.3.
 *
 *   "npm run gate already produces seventeen blockers and ten degradations…
 *    Render that register as a founder panel… The build's own honesty mechanism
 *    becomes the management surface that resolves the thing it is complaining
 *    about — and the register stops being something seen only when somebody
 *    runs a command."
 *
 * It reads no database, which makes it the one panel with real content on the
 * club's first day — and the most valuable one in month one for that reason.
 */
function RegisterPanel({ title }: { title: string }) {
  const items = outstanding();
  const totals = gateSummary();
  const blockers = items.filter((item) => item.severity === "blocker");

  if (items.length === 0) {
    return (
      <Panel title={title} empty={{ kind: "clear", line: "Nothing outstanding." }} />
    );
  }

  return (
    <Panel title={title} count={totals.outstanding} needsDecision={blockers.length > 0}>
      <ul className="flex flex-col gap-1">
        {items.slice(0, 8).map((item) => (
          <li key={item.id} className="flex items-baseline gap-2">
            <span className="truncate">{item.label}</span>
            <span className="ml-auto shrink-0 text-[11px] uppercase tracking-[0.1em] text-sight-ink">
              {item.owner}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-sight-ink">
        {blockers.length} blocker{blockers.length === 1 ? "" : "s"} ·{" "}
        {items.length - blockers.length} degraded
      </p>
    </Panel>
  );
}

function NotBuilt({ title, line }: { title: string; line: string }) {
  const empty: EmptyState = { kind: "not_built", line };
  return <Panel title={title} empty={empty} />;
}
