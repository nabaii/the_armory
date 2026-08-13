import { desc, eq, inArray } from "drizzle-orm";
import { schema } from "@/db/armory/client";
import { APPLICATION_STATUSES } from "@/domain/enums";
import type { ApplicationStatus } from "@/domain/enums";
import {
  handleRead,
  handleWrite,
  malformed,
  readWrite,
  requireStaff,
} from "@/server/armory/http";
import { submitApplication, waitlistDepth, currentStanding } from "@/server/armory/applications";
import { DEFAULT_ROSTER_POLICY } from "@/domain/roster";

/**
 * /api/applications — §7's admission group, §11 M3.
 *
 * GET  lists them for review (§6.6, the founder's dashboard).
 * POST submits one (§6.1 the public form, §6.2 a member sponsoring a guest).
 *
 * ===========================================================================
 * WHY POST REQUIRES A STAFF SESSION HERE AND §6.1 DOES NOT
 *
 * §6.1 describes a live form on the public site writing an application at
 * `sponsor_type = club`, and that form has no staff session — the applicant is a
 * stranger. So this endpoint is NOT that path.
 *
 * That path needs its own protections, and they are not the same ones: a public
 * write endpoint needs the rate limiting and the bot defence §10 asks for on the
 * OTP and guest-token endpoints, and the person record has to be created in the
 * same breath. It is a different endpoint with a different threat model, and
 * building it as an option on this one would mean an authenticated route with a
 * branch that skips authentication — which is how a public write appears in a
 * system by accident.
 *
 * This is the staff-side create: an officer entering an application that arrived
 * by phone or in person, and the route the founder's dashboard uses.
 */

export const dynamic = "force-dynamic";

const isStatus = (value: string): value is ApplicationStatus =>
  (APPLICATION_STATUSES as readonly string[]).includes(value);

export async function GET(request: Request): Promise<Response> {
  /* read_only may read. §10's third role exists precisely so someone can see the
     funnel without being able to change it. */
  const auth = await requireStaff(request, { atLeast: "read_only" });
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const requested = url.searchParams.getAll("status").filter(isStatus);

  /* Default to the ones that need a decision. A review screen opening on every
     application the club has ever declined would bury the four that are
     waiting. */
  const statuses: ApplicationStatus[] =
    requested.length > 0
      ? requested
      : ["submitted", "under_review", "waitlisted"];

  return handleRead("applications.list", async (tx) => {
    const rows = await tx
      .select({
        id: schema.applications.id,
        status: schema.applications.status,
        sponsorType: schema.applications.sponsorType,
        requestedTierId: schema.applications.requestedTierId,
        submittedAt: schema.applications.submittedAt,
        decidedAt: schema.applications.decidedAt,
        personId: schema.people.id,
        firstName: schema.people.firstName,
        lastName: schema.people.lastName,
        /* No phone, no address, no date of birth. §10 calls this "a
           concentration of sensitive personal data"; a list screen needs a name
           to decide on, and the detail view can ask for the rest. */
        position: schema.waitlistEntries.position,
      })
      .from(schema.applications)
      .innerJoin(schema.people, eq(schema.people.id, schema.applications.personId))
      .leftJoin(
        schema.waitlistEntries,
        eq(schema.waitlistEntries.applicationId, schema.applications.id),
      )
      .where(inArray(schema.applications.status, statuses))
      .orderBy(desc(schema.applications.submittedAt));

    const standing = await currentStanding(tx, DEFAULT_ROSTER_POLICY);

    return {
      applications: rows,
      /* Returned alongside, because §5 makes headroom the thing that decides
         whether the admit button will work — and a reviewer who has to load a
         second screen to find out will click it and be refused. */
      roster: standing,
      waitlistDepth: await waitlistDepth(tx),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireStaff(request);
  if ("response" in auth) return auth.response;

  const write = await readWrite(request);
  if ("response" in write) return write.response;

  const { personId, sponsorType, sponsorMembershipId, requestedTierId } =
    write.envelope.payload;

  if (typeof personId !== "string") {
    return malformed("An application needs the person it is for.");
  }
  if (sponsorType !== "club" && sponsorType !== "member") {
    return malformed("An application is sponsored by the club or by a member.");
  }

  return handleWrite(
    { envelope: write.envelope, operation: "applications.submit", staff: auth.staff },
    (tx) =>
      submitApplication(tx, {
        personId,
        sponsorType,
        sponsorMembershipId:
          typeof sponsorMembershipId === "string" ? sponsorMembershipId : null,
        requestedTierId:
          typeof requestedTierId === "string" ? requestedTierId : null,
      }),
  );
}
