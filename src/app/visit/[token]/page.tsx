import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import { invitationForToken } from "@/server/armory/invitations";
import { activeWaiverVersion } from "@/server/armory/waivers";
import { uuidv7 } from "@/lib/uuidv7";
import { Body, Caption, H2, Lead } from "@/components/ui/Text";
import { VisitForm } from "@/components/visit/VisitForm";

/**
 * THE GUEST LINK — §6.3.
 *
 *   "HIGHEST-STAKES SCREEN IN THE BUILD.
 *    Two minutes, on a phone, in poor signal, by someone who has never heard of
 *    you. This is the first surface a future member ever touches. It is opened
 *    once, in a car, by someone slightly nervous about shooting for the first
 *    time…
 *    Also carries: what to expect, what to wear, that nothing needs to be
 *    brought, that no experience is required."
 *
 * ===========================================================================
 * WHAT THIS PAGE DELIBERATELY DOES NOT LOAD
 *
 * No layout chrome, no navigation, no site header, no fonts beyond the ones
 * already in the document, no images. Not for tidiness — for the budget.
 *
 * Two minutes on throttled 3G is roughly one HTML document and one round trip.
 * Every kilobyte spent on a navigation bar this person will never use is taken
 * directly out of the time they have to type an emergency contact. The page
 * sits OUTSIDE the (site) route group for exactly this reason: it does not
 * inherit the marketing header and footer.
 *
 * ===========================================================================
 * THE REASSURANCE COMES BEFORE THE FORM
 *
 * §6.3 lists "what to expect, what to wear, that nothing needs to be brought,
 * that no experience is required" as things this screen carries — alongside the
 * form, not instead of it.
 *
 * They are placed above the fields rather than below. The person reading this is
 * "slightly nervous about shooting for the first time", and the questions in
 * their head are answered before they are asked to hand over a date of birth and
 * an emergency contact. A form that opens cold with those two fields reads like
 * a liability exercise, which is the wrong first impression of a club whose
 * §3.2 acquisition funnel this is.
 *
 * ===========================================================================
 * A CLOSED LINK STILL GETS A ROUTE FORWARD
 *
 * Expired, cancelled and attended each get their own sentence naming the host —
 * "ask Ada to send you another" is something the guest can do. "Invalid link"
 * tells them they have done something wrong and ends the conversation, in a car
 * park, with the club's acquisition funnel on the other side of it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your visit",
  /* §10-adjacent: this URL is a bearer credential. It must never be indexed, and
     a referrer must not carry the token to anywhere the guest navigates next. */
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function VisitPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isArmoryDatabaseConfigured()) {
    return (
      <Shell>
        <H2>We cannot check this link just now.</H2>
        <Body>
          Call the club and they will take your details at the door. Nothing is
          lost.
        </Body>
      </Shell>
    );
  }

  const db = getArmoryDb();
  const invitation = await invitationForToken(db, token);

  if (!invitation) {
    /* The one case that says little. A token matching nothing may be someone
       probing rather than a guest with a stale link. */
    return (
      <Shell>
        <H2>This link is not one the club recognises.</H2>
        <Body>Check the message it came from, or give the club a call.</Body>
      </Shell>
    );
  }

  const now = new Date();

  if (invitation.expiresAt <= now || invitation.status === "expired") {
    return (
      <Shell>
        <H2>This link has expired.</H2>
        <Body>
          Ask {invitation.hostName} to send you another — it only takes them a
          moment.
        </Body>
      </Shell>
    );
  }

  if (invitation.status === "cancelled") {
    return (
      <Shell>
        <H2>This visit was cancelled.</H2>
        <Body>
          {invitation.hostName} called it off. Give them a call if that is a
          surprise.
        </Body>
      </Shell>
    );
  }

  if (invitation.status === "attended") {
    /* §6.3: "After the session it becomes their result page — their score, and
       a route to apply." The scores are M7 and the application route is M3's
       public form, so this is the honest placeholder: it says what happened
       rather than pretending the link is broken. */
    return (
      <Shell>
        <H2>You have already visited on this link.</H2>
        <Body>
          Your scores will appear here once the club has entered them. If you
          would like to come back, {invitation.hostName} can invite you again.
        </Body>
      </Shell>
    );
  }

  const waiver = await activeWaiverVersion(db);

  if (!waiver) {
    return (
      <Shell>
        <H2>The club is not quite ready for you.</H2>
        <Body>
          Its waiver has not been published yet. Call the club — they will sort
          this out at the door.
        </Body>
      </Shell>
    );
  }

  const [version] = await db
    .select({ body: schema.waiverVersions.body })
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.id, waiver.id))
    .limit(1);

  return (
    <Shell>
      <Caption>{invitation.hostName} has invited you to shoot</Caption>
      <H2>Two minutes, and you are done.</H2>

      <Lead>
        No account, no password, and nothing to print. Fill this in now and the
        desk will have you on the list when you arrive.
      </Lead>

      {/* §6.3's four reassurances, before the fields rather than after. */}
      <ul className="my-6 space-y-2 border-l-2 border-[var(--rule)] pl-4">
        <li>
          <Body>
            <strong>No experience needed.</strong> Most first-timers have never
            held a firearm. A range officer stays with you the whole session.
          </Body>
        </li>
        <li>
          <Body>
            <strong>Nothing to bring.</strong> Eyes, ears, firearm and ammunition
            are all provided.
          </Body>
        </li>
        <li>
          <Body>
            <strong>Wear flat closed shoes.</strong> No open toes, and avoid a
            low neckline — brass gets hot. Anything else you own is fine.
          </Body>
        </li>
        <li>
          <Body>
            <strong>Expect about two hours.</strong> A safety briefing, then time
            on the range with your host.
          </Body>
        </li>
      </ul>

      <VisitForm
        token={token}
        /* Minted here, so a guest who taps Confirm twice on a bad connection
           sends the same ids both times and creates one person and one
           signature. §7's replay safety, on a surface with no client to
           generate an id of its own. */
        personId={invitation.guestPersonId ?? uuidv7()}
        signatureId={uuidv7()}
        hostName={invitation.hostName}
        waiverBody={version?.body ?? ""}
      />
    </Shell>
  );
}

/**
 * The whole page frame.
 *
 * One column, generous target sizes, nothing above the content. §6.3's reader is
 * holding a phone one-handed in a car; a layout that needs horizontal attention
 * is a layout that costs them seconds.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">{children}</main>
  );
}
