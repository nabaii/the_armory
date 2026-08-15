import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Caption } from "@/components/ui/Text";
import { MemberSignInForm } from "@/components/member/MemberPasswordForms";
import { safeReturnTo } from "@/server/auth/session";
import { routes } from "@/lib/site";

/**
 * SIGN IN AS AN EXISTING MEMBER — phone and password.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND DOOR, WHEN TWO DOORS IS USUALLY THE WRONG ANSWER
 *
 * `/sign-in` sends a passwordless email link and serves everybody — a visitor
 * checking a ladder, a former guest, a member. It is the right front door and
 * it stays the default.
 *
 * It cannot do the one thing this page does: resolve the person signing in to a
 * row in `armory.people`. An email address is not the club's identifier —
 * §3.1 makes the phone unique and NOT NULL and leaves the email nullable —
 * so a magic link proves control of an address and says nothing about which
 * member that is. `members.person_id` stayed null, and every §6.2 screen
 * correctly reported no membership.
 *
 * So the split is not "two ways to log in". It is: prove an address, or prove a
 * membership. Only the second unlocks the portal, and the page says so rather
 * than making a member guess which door is theirs.
 *
 * ===========================================================================
 * INTERIM. §9's OTP REPLACES THIS.
 *
 *   §9, SMS: "One-time passcodes only… this is the front door to every
 *    account."
 *
 * The identifier is deliberately the same one OTP will use, so a member who
 * learns their phone number is their club identity today does not have to learn
 * something different when the passcode arrives. Only the proof changes.
 *
 * noindex, like every member surface: a members' club does not publish the
 * shape of its member area.
 */

export const metadata: Metadata = {
  title: "Member sign in",
  robots: { index: false, follow: false },
};

export default async function MemberSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Members"
        title="Sign in to the club."
        lead="Use the phone number the club has for you, and your password."
      />

      <Section ground="chalk" rhythm="default">
        {/* Sanitised here as well as in the action. An open redirect on a
            sign-in flow is a phishing primitive — a genuine link from the
            club's own domain that lands somewhere else. */}
        <MemberSignInForm next={safeReturnTo(next)} className="max-w-[34rem]" />

        <Caption className="mt-6 max-w-[68ch]">
          No password yet? The club sets one up for you — ask at the desk or
          message the club, and you will be asked to change it the first time
          you sign in.
        </Caption>

        <Caption className="mt-3 max-w-[68ch]">
          Not a member, or here for a league?{" "}
          <Link href={routes.signIn} className="underline">
            Sign in with an email link instead
          </Link>
          .
        </Caption>
      </Section>
    </>
  );
}
