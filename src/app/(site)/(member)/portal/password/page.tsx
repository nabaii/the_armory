import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getArmoryDb, isArmoryDatabaseConfigured, schema } from "@/db/armory/client";
import { resolveArmoryMember } from "@/server/armory/member-session";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body } from "@/components/ui/Text";
import { ChangePasswordForm } from "@/components/member/MemberPasswordForms";

/**
 * CHANGE YOUR PASSWORD — the interim credential's second screen.
 *
 * Reached two ways, and they need different words:
 *
 *   · Straight after signing in on a password the club set. `must_change` is
 *     true, the member has never chosen this secret, and somebody else knows
 *     it. The page says that plainly rather than presenting a routine settings
 *     form.
 *   · From the Account screen, by a member who simply wants a new one.
 *
 * §9's OTP removes the need for this screen entirely. Until then it is the only
 * way a shared secret stops being shared.
 */

export const metadata: Metadata = {
  title: "Your password",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const resolution = await resolveArmoryMember();

  if (resolution.state !== "member") {
    return (
      <Section>
        <PageHeader title="Your password" />
        <Body>Sign in to change your password.</Body>
      </Section>
    );
  }

  if (!isArmoryDatabaseConfigured()) {
    return (
      <Section>
        <PageHeader title="Your password" />
        <Body>The club&rsquo;s system is not reachable just now.</Body>
      </Section>
    );
  }

  const db = getArmoryDb();

  const [credential] = await db
    .select({ mustChange: schema.memberCredentials.mustChange })
    .from(schema.memberCredentials)
    .where(eq(schema.memberCredentials.personId, resolution.member.personId))
    .limit(1);

  /**
   * The member's own phone, read from their record rather than typed.
   *
   * The change form re-verifies the current password, which needs the
   * identifier — and asking a signed-in member to re-enter their own phone
   * number would be asking them to prove something the session already knows.
   */
  const [person] = await db
    .select({ phone: schema.people.phone })
    .from(schema.people)
    .where(eq(schema.people.id, resolution.member.personId))
    .limit(1);

  /**
   * A member with no credential at all reached this page from the Account
   * screen without ever having had a password — they signed in with an email
   * link and were linked some other way.
   *
   * Told, not offered a form. Setting a first password from inside a session
   * obtained by email would let anybody who once received a link mint a
   * permanent credential for a membership, which is the email-matching hole
   * this whole design refused at the start.
   */
  if (!credential) {
    return (
      <>
        <PageHeader
          ground="teal"
          kicker="Your account"
          title="Your password"
        />
        <Section>
          <Body>
            There is no password on this membership yet. The club sets the first
            one up — ask at the desk, and you will be asked to change it the
            first time you use it.
          </Body>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        ground="teal"
        kicker="Your account"
        title={credential.mustChange ? "Choose your own password." : "Your password"}
        lead={
          credential.mustChange
            ? "The club set this one up for you. Choose one only you know."
            : undefined
        }
      />

      <Section>
        <ChangePasswordForm
          mustChange={credential.mustChange}
          phone={person?.phone ?? ""}
          className="max-w-[34rem]"
        />
      </Section>
    </>
  );
}
