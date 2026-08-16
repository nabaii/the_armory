import { eq } from "drizzle-orm";
import type { ArmoryReader } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import {
  EXPIRY_WARNING_DAYS,
  expiries,
  foreseeableBlocks,
  type FirearmSnapshot,
} from "@/domain/capability";
import type { Remedy } from "@/components/member/RemedyCard";
import { formatDate } from "@/lib/time";
import { routes } from "@/lib/site";
import type { ArmoryMember } from "./member-session";

/**
 * THE ACTION STACK — Members Portal §6.2.
 *
 *   "The temptation is to hand-write a card for each condition — an expiring
 *    waiver card, an unpaid balance card, an incomplete guest link card. Do
 *    not. The capability service already returns a refusal with a reason and a
 *    remedy attached. The action stack is therefore a single RemedyCard
 *    rendering whatever capability hands back, in a loop.
 *
 *    Two things follow. Every future gate the club introduces appears on Today
 *    automatically, with no interface work. And P1 is structurally enforced on
 *    the busiest screen in the portal, because there is nowhere for an inline
 *    permission check to live."
 *
 * ===========================================================================
 * THIS MODULE DECIDES NOTHING, AND THAT IS WORTH CHECKING WHEN YOU EDIT IT
 *
 * Every sentence a member reads on Today's first card comes from
 * src/domain/capability/reasons.ts. This file reads the facts, hands them to
 * `foreseeableBlocks` and `expiries`, and translates the results into the shape
 * the component takes. There is no condition here that says whether a member
 * may do something.
 *
 * The test of a change to this file: if it introduces a comparison against a
 * date, a count or a status, it has become a second source of truth about
 * permission and belongs in the capability service instead. The one comparison
 * below is against `EXPIRY_WARNING_DAYS`, which is the capability service's own
 * notice ladder, imported rather than restated.
 *
 * ===========================================================================
 * WHY EXPIRIES ARE NOT BLOCKS, AND WHY THEY ARE ON THE SAME STACK
 *
 * `foreseeableBlocks` returns what WILL stop the member. `expiries` returns
 * what is running out and has not stopped them yet. §6.2's Home asks for
 * "anything expiring within 60 days" alongside the refusals, and P5 is the
 * reason they share a stack: a licence that expires in nine days is a thing to
 * deal with quietly at home, not at the desk in front of a guest.
 *
 * They arrive with different statuses — a block is `blocked`, an expiry is
 * `attention` — so the pill tells the member which is which without the club
 * having to write two headings.
 */

export async function remediesFor(
  db: ArmoryReader,
  member: ArmoryMember,
  now: Date = new Date(),
): Promise<Remedy[]> {
  const [settings] = await db
    .select({
      waiverValidityDays: schema.clubSettings.waiverValidityDays,
      disciplinesRequiringQualification:
        schema.clubSettings.disciplinesRequiringQualification,
    })
    .from(schema.clubSettings)
    .limit(1);

  const [activeWaiver] = await db
    .select({ id: schema.waiverVersions.id })
    .from(schema.waiverVersions)
    .where(eq(schema.waiverVersions.isActive, true))
    .limit(1);

  const firearms = await db
    .select({
      id: schema.firearms.id,
      serialNumber: schema.firearms.serialNumber,
      calibre: schema.firearms.calibre,
      ownership: schema.firearms.ownership,
      ownerPersonId: schema.firearms.ownerPersonId,
      status: schema.firearms.status,
    })
    .from(schema.firearms)
    .where(eq(schema.firearms.ownerPersonId, member.personId));

  const requiring = new Set(
    (settings?.disciplinesRequiringQualification as string[] | undefined) ?? [],
  );

  const blocks = foreseeableBlocks(member.subject, {
    now,
    allowance: {
      includedQuota: member.allowance.includedQuota,
      usedCount: member.allowance.usedCount,
      /* The overage price is not read here. §7.4 forbids surfacing it in
         advance — this stack renders on Today, which is exactly "in advance". */
      overagePriceLabel: null,
    },
    ownFirearms: firearms as FirearmSnapshot[],
    /* The disciplines this member's tier gives them, so a qualification that
       has lapsed on a line they actually shoot is surfaced before they book
       rather than at the lane. */
    disciplines: member.tier.disciplineAccess,
    requiresQualification: (discipline) => requiring.has(discipline),
    /* A club with no active waiver version cannot supersede anybody's
       signature, and passing an empty string would make every signature stale
       — turning the whole roster away over a version the club never published.
       `activeWaiverVersionId` is compared for equality, so the member's own id
       is the value that changes nothing. */
    activeWaiverVersionId:
      activeWaiver?.id ?? member.subject.waiver?.waiverVersionId ?? "",
    waiverValidityDays: settings?.waiverValidityDays ?? null,
  });

  const remedies: Remedy[] = blocks.map((found) => ({
    reason: found.block.message,
    remedy: found.block.remedy,
    status: "blocked",
    action: actionFor(found.block.code),
  }));

  /* §6.2's Home: "anything expiring within 60 days". Only on a warning day and
     beyond — the ladder is 60, 30 and 7, and a card that appeared on day 59 and
     stayed for two months is a card a member stops seeing. */
  const longestWarning = Math.max(...EXPIRY_WARNING_DAYS);

  for (const expiry of expiries(member.subject, now, longestWarning)) {
    remedies.push({
      reason: `${expiry.label} expires ${formatDate(expiry.expiresOn)}.`,
      remedy: remedyForExpiry(expiry.kind),
      status: "attention",
      action: actionForExpiry(expiry.kind),
    });
  }

  return remedies;
}

/**
 * Where a member goes to fix one particular refusal.
 *
 * A partial map on purpose. Most blocks are cleared by an act the club performs
 * — verifying a licence, lifting a suspension — and a link to a page that
 * cannot help is worse than no link, because it costs the member a tap to learn
 * that. Only the codes with a real destination get one.
 */
function actionFor(code: string): Remedy["action"] {
  switch (code) {
    case "MEMBERSHIP_LAPSED":
      return { href: routes.portalAccount, label: "Renew your membership" };
    case "LICENCE_MISSING":
    case "LICENCE_EXPIRED":
      return { href: routes.portalAccount, label: "Your documents" };
    case "ALLOWANCE_EXHAUSTED":
      /* Not a wall. §4.2 blocks only when the allowance is spent AND overage is
         declined, so the destination is the booking flow, where the member can
         accept the charge — not a page telling them they have run out. */
      return { href: routes.portalBookNew, label: "Book anyway" };
    default:
      return undefined;
  }
}

function remedyForExpiry(kind: "licence" | "qualification" | "membership"): string | null {
  switch (kind) {
    case "licence":
      return "Send the club your renewed licence before it lapses.";
    case "membership":
      return "Your renewal is due. Nothing changes until then.";
    case "qualification":
      /* No remedy the member can perform alone — a sign-off is the club's act.
         §4.3's rule about never inventing a remedy applies to expiries too. */
      return null;
  }
}

function actionForExpiry(
  kind: "licence" | "qualification" | "membership",
): Remedy["action"] {
  if (kind === "qualification") return undefined;
  return { href: routes.portalAccount, label: "Your documents" };
}
