import Link from "next/link";
import { notFound } from "next/navigation";
import { admitsSurface } from "@/domain/grants";
import { routes } from "@/lib/site";
import { Panel } from "@/components/manage/Panel";
import type { ApplicationRow, RosterRow } from "@/server/armory/manage-reads";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

/**
 * PEOPLE — Management System §8. The roster, and the pipeline that fills it.
 *
 * ===========================================================================
 * SEARCH IS THE NAVIGATION, NOT A FILTER ON A LIST
 *
 * At roughly 125 members a hierarchy is the wrong model. §8.4: "When a question
 * arises it is almost always about a person: why can this member not host, when
 * did their licence lapse, what do they owe, who brought them."
 *
 * So the roster is rendered whole — 125 rows is one screen and one query, and
 * paginating it would cost a scroll and buy nothing — and the browser's own
 * find is a better search than one this page could build. A filter box that
 * needed a round trip would be slower than Ctrl-F on the same data.
 *
 * That stops being true at a few hundred members. The moment it does, this is
 * where a real search goes, and it goes here rather than into each screen.
 */

export default async function People() {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "people")) notFound();

  const source = await manageSource(principal);
  const now = new Date();

  /**
   * The applications queue is `people_write`, not `people_read`.
   *
   * Front of house can look somebody up at the counter and cannot see who is
   * applying — a queue is a set of decisions, and reading it is the first half
   * of making one. The roster below is admitted by either grant.
   */
  const mayDecide = principal.grants.has("people_write");

  const [members, applications] = await Promise.all([
    source.roster(),
    mayDecide ? source.applications(now) : null,
  ]);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold leading-none">People</h1>
        <p className="text-[13px] text-sight-ink">
          {members.length} on the roster
          {applications ? ` · ${applications.length} applying` : ""}
        </p>
      </header>

      {applications && <ApplicationsQueue rows={applications} />}

      <Roster rows={members} />
    </div>
  );
}

/**
 * THE APPLICATIONS QUEUE — §8.2.
 *
 *   "*Applications land somewhere nobody owns* is on the blocker register, and
 *    it is a staffing decision rather than a software one. What the software can
 *    do is make ownerlessness impossible to ignore."
 *
 * So the owner column is rendered, it is empty for every row, and it says so in
 * words. Hiding a column the club cannot yet fill would make the screen look
 * finished and the queue look owned.
 */
function ApplicationsQueue({ rows }: { rows: ApplicationRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel
        title="Applications"
        empty={{ kind: "clear", line: "Nobody is waiting on a decision." }}
      />
    );
  }

  const oldest = rows[0];

  return (
    <Panel title="Applications" count={rows.length} needsDecision>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-sight-grey/30 text-left text-[11px] uppercase tracking-[0.1em] text-sight-ink">
              <th scope="col" className="py-1 pr-2 font-semibold">Applicant</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Route</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Stage</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Age</th>
              <th scope="col" className="py-1 font-semibold">Owner</th>
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
                  {row.sponsorType === "member" ? "Nominated" : "Applied"}
                </td>
                <td className="py-1 pr-2 text-sight-ink">
                  {row.status === "under_review" ? "Under review" : "Submitted"}
                </td>
                <td
                  data-numeric
                  className={`py-1 pr-2 tabular-nums ${
                    row.ageDays > 14 ? "text-ten-ring-deep" : "text-sight-ink"
                  }`}
                >
                  {row.ageDays}d
                </td>
                <td className="py-1 text-ten-ring-deep">Nobody</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-sight-ink">
        No application has a named owner, because the system has nowhere to put
        one. This is on the outstanding register as{" "}
        <span className="font-medium">membership-owner</span>, and it is a
        staffing decision rather than a piece of software.
        {oldest.ageDays > 14 && (
          <>
            {" "}
            The oldest has been waiting{" "}
            <span className="font-medium text-ten-ring-deep">
              {oldest.ageDays} days
            </span>
            .
          </>
        )}
      </p>
    </Panel>
  );
}

function Roster({ rows }: { rows: RosterRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel
        title="The roster"
        empty={{
          kind: "not_started",
          line: "The club has no members yet. The roster fills from the applications queue.",
        }}
      />
    );
  }

  return (
    <Panel title="The roster" count={rows.length}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-sight-grey/30 text-left text-[11px] uppercase tracking-[0.1em] text-sight-ink">
              <th scope="col" className="py-1 pr-2 font-semibold">No.</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Member</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Tier</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Standing</th>
              <th scope="col" className="py-1 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId} className="border-b border-sight-grey/15 last:border-0">
                <td data-numeric className="py-1 pr-2 tabular-nums text-sight-ink">
                  {row.memberNumber}
                </td>
                <td className="py-1 pr-2">
                  <Link
                    href={routes.managePerson(row.personId)}
                    className="border-b border-transparent hover:border-sight-grey"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="py-1 pr-2 text-sight-ink">{row.tierName ?? "—"}</td>
                <td
                  className={`py-1 pr-2 ${
                    row.status === "active" ? "text-sight-ink" : "text-ten-ring-deep"
                  }`}
                >
                  {row.status}
                </td>
                <td className="py-1 tabular-nums text-sight-ink">
                  {row.startedOn
                    ? row.startedOn.toLocaleDateString("en-GB", {
                        month: "short",
                        year: "numeric",
                        timeZone: "Africa/Lagos",
                      })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
