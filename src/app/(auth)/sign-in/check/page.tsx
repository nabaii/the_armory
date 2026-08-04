import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { routes } from "@/lib/site";

export const metadata: Metadata = {
  title: "Check your email",
  robots: { index: false, follow: false },
};

/**
 * "Check your email."
 *
 * Shown identically whether or not the address belongs to a member — the
 * response must not distinguish, or this page becomes a membership oracle.
 *
 * Because of that, the copy has to carry a burden it would not otherwise: a
 * member who mistyped their address sees success and no email. So the page says
 * plainly what to do about it rather than leaving them waiting.
 */
export default function CheckEmailPage() {
  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Sign in"
        title="Check your email."
        lead="If we hold that address for you, a sign-in link is on its way. It works once and expires in fifteen minutes."
      />

      <Section ground="chalk" rhythm="default">
        <Body muted>
          Nothing arrived? Look in your spam folder first. If it is not there,
          the address may not be the one the club holds for you, or it may have
          been mistyped — try again, or speak to us and we will sort it out.
        </Body>

        <Button href={routes.signIn} variant="secondary" className="mt-4">
          Try a different address
        </Button>

        <Caption className="mt-6 max-w-[68ch]">
          For your security we do not say whether an address belongs to a member.
          That is deliberate: it means nobody can use this page to find out who
          is a member of the club.
        </Caption>
      </Section>
    </>
  );
}
