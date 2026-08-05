import type { Metadata } from "next";
import { LegalDocument } from "@/components/sections/LegalDocument";

export const metadata: Metadata = {
  title: "Refund & deposit policy",
  description:
    "Deposit and refund terms for first-visit and group bookings at The Armory Shooting Sports Club.",
};

/**
 * Split out from Terms deliberately.
 *
 * Spec §9, acceptance criterion: "Refund and deposit terms appear before payment
 * is taken." Flow B step 4: "Refund policy shown before payment, not after."
 * That needs a short document the booking flow can link to inline — dropping
 * the full terms and conditions into a payment step guarantees nobody reads it,
 * which defeats the purpose of the requirement.
 *
 * The Brief also names this as a precondition rather than a follow-up:
 * "Deposits require a written refund policy, settled before the booking flow is
 * designed."
 */
export default function RefundsPage() {
  return (
    <LegalDocument
      title="Refund & deposit policy"
      purpose="What you pay to hold a booking, and what happens if you need to change or cancel it."
      requiredContents={[
        "Deposit amount for a first visit, and whether it is a deposit against the price or an additional booking fee.",
        "Whether the deposit is refundable, and within what notice period.",
        "What happens on a no-show. This is a stated success measure for the first-visit page, so the policy needs to be usable rather than punitive.",
        "How to reschedule, and whether a deposit transfers to the new date.",
        "Group and private-hire bookings, which may carry different terms from a single first visit.",
        "What happens if the club cancels — weather on the outdoor lines, or facility closure.",
        "Eligibility and age requirements, and what happens to a deposit if someone turns out to be ineligible on arrival.",
        "How refunds are returned, and the timeframe, given payment is taken in Naira by card or transfer.",
        "A version number and effective date on the document itself.",
      ]}
      note="For the build team: the policy version in force at the time of booking is stored against every booking record. Spec §9 requires these terms to appear before payment, and a dispute weeks later needs to reference the exact wording the customer actually saw — not whatever the page says by then. Wire the version string into the booking write in Workstream 4."
    />
  );
}
