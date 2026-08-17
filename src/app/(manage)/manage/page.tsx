import Link from "next/link";
import { getArmoryDb } from "@/db/armory/client";
import { panelsFor, type DayPanel } from "@/domain/grants";
import { gateSummary, outstanding } from "@/lib/content-gate";
import { routes } from "@/lib/site";
import { lagosDateKey } from "@/lib/time";
import { Panel, type EmptyState } from "@/components/manage/Panel";
import {
  applicationsQueue,
  expectedArrivals,
  expiryRegister,
  type ApplicationRow,
  type ArrivalRow,
  type ExpiryRow,
} from "@/server/armory/manage-reads";
import { requireStaffPrincipal } from "@/server/armory/manage-session";

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
  const db = getArmoryDb();

  const [arrivals, applications, expiries] = await Promise.all([
    shown.has("arrivals") ? expectedArrivals(db, { now }) : null,
    shown.has("applications") ? applicationsQueue(db, { now }) : null,
    shown.has("expiries-today") ? expiryRegister(db, { now, withinDays: 30 }) : null,
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
            arrivals={arrivals}
            applications={applications}
            expiries={expiries}
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
  arrivals,
  applications,
  expiries,
}: {
  panel: DayPanel;
  arrivals: ArrivalRow[] | null;
  applications: ApplicationRow[] | null;
  expiries: ExpiryRow[] | null;
}) {
  switch (panel.id) {
    case "arrivals":
      return <ArrivalsPanel title={panel.title} rows={arrivals ?? []} />;

    case "applications":
      return <ApplicationsPanel title={panel.title} rows={applications ?? []} />;

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
      return <NotBuilt title={panel.title} line="Lanes, relays and officer coverage against tonight's demand." />;
    case "open-safety":
      return <NotBuilt title={panel.title} line="Incidents and near-misses still open. Needs the near-miss form." />;
    case "operating-level":
      return <NotBuilt title={panel.title} line="The degradation ladder as a switch — §6.2." />;
    case "takings":
      return <NotBuilt title={panel.title} line="Yesterday, by category. Needs a day of categorised charges first." />;
    case "unreconciled":
      return <NotBuilt title={panel.title} line="Paystack against the ledger. The sweep is a security blocker." />;
    case "business-strip":
      return (
        <NotBuilt
          title={panel.title}
          line="The two falsifying numbers. Capture began this sprint; they need a quarter behind them to mean anything."
        />
      );
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

function ApplicationsPanel({ title, rows }: { title: string; rows: ApplicationRow[] }) {
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
   * has one." Every open application is unowned today, because the column does
   * not exist — see `ApplicationRow.ownerStaffId`. So this panel always needs a
   * decision, which is true and is exactly what the blocker register says.
   */
  return (
    <Panel title={title} count={rows.length} needsDecision>
      <ul className="flex flex-col gap-1">
        {rows.slice(0, 8).map((row) => (
          <li key={row.id} className="flex items-baseline gap-2">
            <span className="truncate">{row.name}</span>
            <span className="ml-auto shrink-0 tabular-nums text-sight-ink">
              {row.ageDays}d
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ten-ring-deep">
        {rows.length === 1 ? "This application has" : "These applications have"} no
        named owner.
      </p>
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
