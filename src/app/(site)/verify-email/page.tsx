import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Caption } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { ConfirmEmailForm } from "@/components/member/EmailForms";
import { routes } from "@/lib/site";

/**
 * CONFIRMING AN EMAIL ADDRESS — the landing half of the link.
 *
 * ===========================================================================
 * WHY THIS IS NOT IN THE MEMBER AREA
 *
 * Everything else that touches a member's record sits under `(member)` and is
 * guarded by `requireMember()`. This deliberately does not, and the reason is
 * the member it exists for: somebody with no email on file, whose only way in
 * is a phone and a password, adding an address so they have a second one. They
 * will open this link wherever their mail is — a laptop, a work machine, a
 * browser the club has never seen — and a guard here would send them to a
 * sign-in they may not be able to complete. That is the exact problem the
 * address is being added to solve, so the fix must not depend on it.
 *
 * It is safe because the token IS the proof and redemption grants nothing. No
 * session is issued, no privilege changes hands; a stranger holding the link
 * can prove an address on somebody else's record and gain no way into it. The
 * link is single use and expires in an hour.
 *
 * noindex, like every page that is reached from a message rather than found.
 */

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false, nocache: true, nosnippet: true },
};

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <PageHeader
          ground="teal"
          kicker="Your account"
          title="That link is incomplete."
          lead="Some email clients shorten long links. Try opening it again from the message, or ask for a new one from your account."
        />
        <Section ground="chalk" rhythm="tight">
          <Button href={routes.portalAccount} variant="primary">
            Go to your account
          </Button>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Your account"
        title="One more tap."
        lead="Confirm below and this address becomes a way to sign in."
      />

      <Section ground="chalk" rhythm="default">
        <ConfirmEmailForm token={token} />

        <Caption className="mt-6 max-w-[68ch]">
          Confirming does not sign you in and does not change your password. It
          records that this mailbox is yours.
        </Caption>
      </Section>
    </>
  );
}
