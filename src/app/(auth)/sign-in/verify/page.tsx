import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { VerifyForm } from "@/components/member/VerifyForm";
import { safeReturnTo } from "@/server/auth/session";
import { routes } from "@/lib/site";

/* ============================================================================
   THE LANDING PAGE FOR AN EMAILED SIGN-IN LINK.

   It deliberately does NOTHING on load. Redemption happens on the POST from
   the button below — see the note on completeSignIn() for why: scanners,
   preview bots and prefetchers follow GET links and would burn a single-use
   token before the member ever clicked it.

   `dynamic` because it reads searchParams, and `noindex` because the URL
   contains a live credential.
   ========================================================================= */

export const metadata: Metadata = {
  title: "Confirm sign-in",
  robots: { index: false, follow: false, nocache: true, nosnippet: true },
};

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const { token, next } = await searchParams;

  if (!token) {
    return (
      <>
        <PageHeader
          ground="teal"
          kicker="Sign in"
          title="That link is incomplete."
          lead="Some email clients shorten long links. Try opening it again, or request a new one."
        />
        <Section ground="chalk" rhythm="tight">
          <Button href={routes.signIn} variant="primary">
            Request a new link
          </Button>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Sign in"
        title="One more tap."
        lead="Confirm below and we will sign you in."
      />

      <Section ground="chalk" rhythm="default">
        <VerifyForm token={token} next={safeReturnTo(next)} />

        <Body muted className="mt-6 max-w-[68ch]">
          If you did not ask to sign in, close this page and nothing happens. The
          link expires on its own.
        </Body>

        <Caption className="mt-3 max-w-[68ch]">
          We ask for this tap because email systems often open links
          automatically to scan them. Without it, a scanner could use up your
          one-time link before you got to it.
        </Caption>
      </Section>
    </>
  );
}
