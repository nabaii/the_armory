import { notFound } from "next/navigation";
import { admitsSurface } from "@/domain/grants";
import { Panel } from "@/components/manage/Panel";
import { requireStaffPrincipal } from "@/server/armory/manage-session";
import { manageSource } from "@/server/armory/manage-source";

/**
 * THE PERSON RECORD — Management System §8.4.
 *
 *   "The person record is the surface staff will actually live in. When a
 *    question arises it is almost always about a person: why can this member not
 *    host, when did their licence lapse, what do they owe, who brought them."
 *
 * ===========================================================================
 * WHAT IS HERE, AND WHAT IS DELIBERATELY NOT YET
 *
 * Standing and paperwork — the half that answers the questions actually asked at
 * a counter. Visits, scores, guests hosted, charges and custody are the other
 * half, and each is a read across a milestone this screen does not yet touch.
 * They are not stubbed with plausible-looking sections: an empty "Charges" block
 * on a member who owes money would be a lie told by layout.
 *
 * The capability refusals §8.4 calls the most useful thing on this screen are
 * the next piece. `foreseeableBlocks` already produces exactly that list, in the
 * member's own words, and the portal renders it — so this screen showing the
 * same sentences is arrangement rather than new logic, and it is the one
 * addition that would change how this page is used.
 */

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requireStaffPrincipal();
  if (!admitsSurface(principal, "people")) notFound();

  const { id } = await params;
  const source = await manageSource(principal);
  const person = await source.person(id);
  if (!person) notFound();

  return (
    <div className="mx-auto flex max-w-[800px] flex-col gap-3 p-2 lg:p-3">
      <header className="flex flex-col gap-1">
        {person.memberNumber !== null && (
          <p
            data-numeric
            className="text-[11px] uppercase tracking-[0.18em] tabular-nums text-sight-ink"
          >
            Member {person.memberNumber}
          </p>
        )}
        <h1 className="text-2xl font-bold leading-none">{person.name}</h1>
      </header>

      <Panel title="Standing">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Row label="Membership" value={person.membershipStatus ?? "Not a member"} />
          <Row label="Tier" value={person.tierName ?? "—"} />
          <Row label="Joined" value={formatDate(person.startedOn)} />
          <Row label="Renews" value={formatDate(person.renewsOn)} />
          <Row
            label="Waiver"
            value={
              person.waiverSignedAt
                ? `Signed ${formatDate(person.waiverSignedAt)}`
                : "Never signed"
            }
            alert={person.waiverSignedAt === null}
          />
        </dl>
      </Panel>

      {person.licences.length === 0 ? (
        <Panel
          title="Firearm licences"
          empty={{ kind: "clear", line: "This person holds no licence with the club." }}
        />
      ) : (
        <Panel title="Firearm licences" count={person.licences.length}>
          <ul className="flex flex-col gap-1">
            {person.licences.map((licence) => (
              <li key={licence.number} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{licence.number}</span>
                <span
                  className={
                    licence.status === "verified" ? "text-sight-ink" : "text-ten-ring-deep"
                  }
                >
                  {licence.status.replace("_", " ")}
                </span>
                <span className="text-sight-ink">
                  {licence.calibres.join(", ") || "no calibres recorded"}
                </span>
                <span className="ml-auto tabular-nums text-sight-ink">
                  {formatDate(licence.expiresOn)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {person.qualifications.length === 0 ? (
        <Panel
          title="Sign-offs"
          empty={{ kind: "clear", line: "No discipline sign-offs recorded." }}
        />
      ) : (
        <Panel title="Sign-offs" count={person.qualifications.length}>
          <ul className="flex flex-col gap-1">
            {person.qualifications.map((qualification) => (
              <li
                key={`${qualification.discipline}-${qualification.level}`}
                className="flex items-baseline gap-2"
              >
                <span>{qualification.discipline}</span>
                <span className="text-sight-ink">{qualification.level}</span>
                <span className="ml-auto tabular-nums text-sight-ink">
                  {formatDate(qualification.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Visits, scores, guests and charges"
        empty={{
          kind: "not_built",
          line:
            "Assembled across M4, M6, M7 and M8. Not stubbed here — an empty section on a member who owes money would be a lie told by layout.",
        }}
      />
    </div>
  );
}

function Row({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-sight-ink">{label}</dt>
      <dd className={alert ? "text-ten-ring-deep" : ""}>{value}</dd>
    </>
  );
}

/** Null renders as an em dash, never as today's date or an empty string. S2. */
const formatDate = (value: Date | null): string =>
  value
    ? value.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Lagos",
      })
    : "—";
