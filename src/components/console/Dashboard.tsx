"use client";

import { useEffect, useState } from "react";
import type { DashboardView } from "@/server/armory/dashboard";

/**
 * THE OWNER DASHBOARD — §6.6, §11 M9.
 *
 *   "Roster against cap with waitlist depth; hosting rate; guest-to-application
 *    conversion; admissions by host; occupancy by day and slot separating
 *    member and guest load; lapse list; revenue by source; reconciliation
 *    exceptions; expiries within 90 days; overrides in the last 7 days."
 *
 * ===========================================================================
 * THIS IS THE ONE CONSOLE SCREEN THAT REQUIRES A NETWORK, AND IT SAYS SO
 *
 * Every other surface in /console works with no uplink, because §8 requires it
 * and because a range cannot stop when the link does. This one does not, and
 * the difference is what the screen is FOR.
 *
 * The desk and the lane are operational: people are on the premises and the
 * club has to keep running. A dashboard is a decision aid read in an office. A
 * founder who cannot see this month's conversion rate until the uplink returns
 * has been mildly inconvenienced; an officer who cannot check somebody in has a
 * queue.
 *
 * So there is no offline cache here — nothing on this screen is in the day
 * pack, and putting it there would mean every tablet on the range holding the
 * club's revenue. §10's whole argument about what belongs on a device applies:
 * the pack deliberately carries no address and no licence scan, and it should
 * not carry the books either.
 *
 * When the request fails it says the club's system could not be reached, which
 * is true and actionable, rather than showing a stale month as though it were
 * this one.
 */

type State =
  | { phase: "loading" }
  | { phase: "ready"; view: DashboardView }
  | { phase: "refused"; reason: string };

export function Dashboard({
  staffToken,
  onClose,
}: {
  /** The founder's session. Null when the shift has no live one. */
  staffToken: string | null;
  onClose: () => void;
}) {
  /**
   * The no-token case is decided at render, not in the effect.
   *
   * `staffTokenFor` already answered it before this component mounted, so
   * there is nothing to fetch and nothing to wait for — and a state set from
   * inside an effect would render "loading" for one frame to say something it
   * knew at the top.
   */
  const initial: State = staffToken
    ? { phase: "loading" }
    : {
        phase: "refused",
        reason:
          "This tablet has no live sign-in for the dashboard. Sign in again while there is a connection.",
      };

  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    if (!staffToken) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/dashboard", {
          headers: { authorization: `Bearer ${staffToken}` },
          cache: "no-store",
        });

        if (cancelled) return;

        if (!response.ok) {
          /* The endpoint's own sentence where it sent one — §4.3's shape
             applies to an API refusal as much as to a block at the desk, and
             "Your role does not cover this" is the answer a range officer
             holding a founder's tablet needs to read. */
          const body = (await response.json().catch(() => null)) as {
            reason?: unknown;
          } | null;

          setState({
            phase: "refused",
            reason:
              typeof body?.reason === "string"
                ? body.reason
                : "The club's system could not be reached just now.",
          });
          return;
        }

        setState({ phase: "ready", view: (await response.json()) as DashboardView });
      } catch {
        if (!cancelled) {
          setState({
            phase: "refused",
            reason:
              "The club's system could not be reached. The dashboard needs a connection; the desk does not.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [staffToken]);

  return (
    <section
      aria-label="Owner dashboard"
      className="fixed inset-0 z-20 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
          {state.phase === "ready" && (
            /* The headline, ordered by what would ruin a week. Not a summary of
               what is fine — see `dashboardHeadline`. */
            <p className="mt-1 text-lg font-medium">{state.view.headline}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          Close
        </button>
      </header>

      {state.phase === "loading" && (
        <p className="mt-6 text-[--color-sight-ink]">Reading the club&rsquo;s books…</p>
      )}

      {state.phase === "refused" && (
        <p
          role="alert"
          className="mt-6 border-l-8 border-[--color-ten-ring-deep] py-2 pl-3 font-medium"
        >
          {state.reason}
        </p>
      )}

      {state.phase === "ready" && <Panels view={state.view} />}
    </section>
  );
}

function Panels({ view }: { view: DashboardView }) {
  return (
    <>
      {/* ------------------------------------------- IS ANYTHING WRONG? */}

      {/* First, not last. §12 puts overrides in front of the founder the same
          day, and an exception list below three panels of growth metrics is a
          list nobody scrolls to. */}
      {view.exceptions.length > 0 && (
        <Panel heading="Needs a person">
          <p className="mb-2 font-medium">{view.exceptionSummary}</p>
          <ul className="space-y-2">
            {view.exceptions.map((exception) => (
              <li
                key={`${exception.kind}-${exception.subject.id}`}
                className={`border-l-4 pl-3 ${
                  exception.severity === "integrity"
                    ? "border-[--color-ten-ring-deep]"
                    : "border-[--color-deck-oak]"
                }`}
              >
                <span className="block">{exception.line}</span>
                {exception.remedy && (
                  <span className="block text-sm text-[--color-sight-ink]">
                    {exception.remedy}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.overrides.length > 0 && (
        <Panel heading="Overrides, last seven days">
          <ul className="space-y-2">
            {view.overrides.map((row) => (
              <li key={row.id}>
                <span className="block font-medium">{row.reason}</span>
                <span className="block text-sm text-[--color-sight-ink]">
                  {row.action} · {row.actorName} ·{" "}
                  {new Date(row.occurredAt).toLocaleString("en-NG", {
                    timeZone: "Africa/Lagos",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.expiring.length > 0 && (
        <Panel heading="Expiring within ninety days">
          <ul className="space-y-1">
            {view.expiring.map((row) => (
              <li key={`${row.kind}-${row.personName}-${row.expiresOn}`}>
                {row.line}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------- IS THE CLUB FILLING? */}

      <Panel heading="Roster">
        <p className="text-lg">{view.roster.line}</p>
      </Panel>

      {view.lapses.length > 0 && (
        <Panel heading="Lapsed">
          <ul className="space-y-1">
            {view.lapses.map((row) => (
              <li key={row.personId}>{row.line}</li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------ IS THE FUNNEL WORKING? */}

      <Panel heading={`The funnel, last ${view.windowDays} days`}>
        {/* Both lines state their denominator. See src/domain/dashboard.ts. */}
        <p>{view.hosting.line}</p>
        <p className="mt-1">{view.conversion.line}</p>
      </Panel>

      {view.admissionsByHost.length > 0 && (
        <Panel heading="Admissions by host">
          <ul className="space-y-1">
            {view.admissionsByHost.map((host) => (
              <li key={host.hostPersonId} className="flex gap-3">
                <span className="min-w-0 flex-1">{host.hostName}</span>
                <span className="shrink-0 tabular-nums text-[--color-sight-ink]">
                  {host.guestsBrought} brought · {host.applications} applied ·{" "}
                  <strong className="text-[--color-reticle-black]">
                    {host.admitted} admitted
                  </strong>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ---------------------------------------- IS THE RANGE BEING USED? */}

      {view.occupancy.length > 0 && (
        <Panel heading="Occupancy">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[--color-sight-ink]">
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 font-medium">Slot</th>
                <th className="py-1 text-right font-medium">Members</th>
                <th className="py-1 text-right font-medium">Guests</th>
              </tr>
            </thead>
            <tbody>
              {view.occupancy.map((cell) => (
                <tr key={`${cell.date} ${cell.slot}`}>
                  <td className="py-1">{cell.date}</td>
                  <td className="py-1">{cell.slot}</td>
                  {/* §6.6 separates these deliberately: a full evening is a
                      good problem or a bad one depending which column it is. */}
                  <td className="py-1 text-right tabular-nums">
                    {cell.memberCount}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {cell.guestCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {view.revenue.length > 0 && (
        <Panel heading={`Revenue by source, last ${view.windowDays} days`}>
          <ul className="space-y-1">
            {view.revenue.map((row) => (
              <li key={row.purpose} className="flex gap-3">
                <span className="min-w-0 flex-1">{row.purpose}</span>
                <span className="shrink-0 tabular-nums">
                  {row.label}{" "}
                  <span className="text-[--color-sight-ink]">
                    ({row.count})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Panel({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium tracking-wide uppercase">{heading}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
