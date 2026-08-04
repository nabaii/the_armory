import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption } from "@/components/ui/Text";
import { SignInForm } from "@/components/member/SignInForm";
import { safeReturnTo } from "@/server/auth/session";
import { routes } from "@/lib/site";

/* ============================================================================
   SIGN IN.

   Members only, and deliberately austere — this is not a marketing surface and
   it should not try to be one. No hero, no photography, no CTA competing with
   the one thing the page is for.

   noindex: a members' club does not publish the shape of its member area, and
   a sign-in page in search results serves nobody.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function SignInPage({
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
        title="Sign in."
        lead="We will email you a link. There is no password to remember, and nothing to reset."
      />

      <Section ground="chalk" rhythm="default">
        {/* Sanitised here as well as at redemption. An open redirect on a
            sign-in flow is a phishing primitive — a genuine link from the club's
            own domain that lands somewhere else. */}
        <SignInForm next={safeReturnTo(next)} className="max-w-[34rem]" />

        <Caption className="mt-6 max-w-[68ch]">
          Sign-in links work once and expire after fifteen minutes. If you are
          not a member yet, there is nothing to sign in to —{" "}
          <a
            href={routes.membership}
            className="underline decoration-1 underline-offset-2"
          >
            membership starts with an application
          </a>
          .
        </Caption>
      </Section>

      <Section ground="terrazzo" rhythm="tight">
        <Body muted>
          Trouble signing in? The link is sent to the address the club holds for
          you. If that has changed, we will need to update it before you can sign
          in — that is a conversation with a person rather than a form.
        </Body>
      </Section>
    </>
  );
}
