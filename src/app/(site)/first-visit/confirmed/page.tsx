import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Body, Caption, Data, H2, Kicker } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { CallUs } from "@/components/ui/CallUs";
import { SpecificationTable } from "@/components/sections/SpecificationTable";
import { bookingStore } from "@/server/booking-store";
import { humaniseSlotId } from "@/app/api/paystack/webhook/route";
import { formatNaira } from "@/server/paystack";
import { contact, routes, site } from "@/lib/site";

/* ============================================================================
   FLOW B STEP 5 — the on-screen confirmation, reached from Paystack's callback.

   ===========================================================================
   THIS PAGE DOES NOT TREAT THE REDIRECT AS PROOF OF PAYMENT.

   Arriving here proves only that a browser followed a URL. Anyone can type
   `?ref=ARM-XXXX`. Money is confirmed by the signed webhook, so this page reads
   the booking's actual STATUS and reports it honestly:

     confirmed → the deposit arrived. Show the booking.
     held      → payment may have succeeded but the webhook has not landed yet.
                 Say exactly that. Do not claim a booking we cannot see, and do
                 not claim a failure that may be a two-second delay.
     unknown   → no such reference. Do not speculate; point at the phone.

   Claiming success on a redirect is how a visitor turns up to a session that was
   never booked. Claiming failure on a webhook delay is how they pay twice.
   ===========================================================================
   -------------------------------------------------------------------------- */

export const metadata: Metadata = {
  title: "Booking confirmed",
  robots: { index: false, follow: false },
};

/* Reads live booking state, so it must never be cached or prerendered. */
export const dynamic = "force-dynamic";

export default async function BookingConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const record = ref ? await bookingStore.get(ref) : null;

  if (!record) return <NotFound reference={ref} />;
  if (record.status === "held") return <AwaitingPayment reference={record.reference} />;

  return (
    <>
      <PageHeader
        ground="soffit"
        kicker="Booking confirmed"
        title="You are booked in."
        lead="Your deposit has been received and your session is held. A confirmation email with arrival details is on its way."
      />

      <Section ground="chalk" rhythm="default">
        <SpecificationTable
          className="max-w-[46rem]"
          caption="Your booking"
          rows={[
            { label: "When", value: humaniseSlotId(record.slotId) },
            {
              label: "Party size",
              value: `${record.partySize} ${record.partySize === 1 ? "person" : "people"}`,
            },
            { label: "Reference", value: record.reference },
            ...(record.amountKobo
              ? [{ label: "Deposit paid", value: formatNaira(record.amountKobo) }]
              : []),
          ]}
        />
        <Caption className="mt-2">
          Quote your reference{" "}
          <Data muted={false}>{record.reference}</Data> if you need to call us
          about this booking.
        </Caption>
      </Section>

      <Section ground="soffit" rhythm="default">
        <Kicker className="mb-2">Before you come</Kicker>
        <H2>Flat shoes, and nothing else.</H2>
        <Body className="mt-2">
          Wear flat, closed shoes and clothing you can stand still in, with
          nothing loose at the wrist. Tie long hair back. Everything else — the
          rifle, ammunition, eye and ear protection — is provided.
        </Body>
        <Body className="mt-2">
          Please arrive fifteen minutes before your session at{" "}
          {site.location}. Full arrival details are in your email.
        </Body>
        <Button href={routes.firstVisit} variant="secondary" className="mt-3">
          What happens on the day
        </Button>
      </Section>

      <Section ground="chalk" rhythm="tight">
        <Caption>
          Need to change or cancel? Read the{" "}
          <a
            href={routes.refunds}
            className="underline decoration-1 underline-offset-2"
          >
            refund and deposit policy
          </a>{" "}
          — the terms that applied to your booking are version{" "}
          <Data muted={false}>{record.policyVersion}</Data>.
        </Caption>
      </Section>
    </>
  );
}

/**
 * Payment may have gone through moments ago. The webhook usually arrives within
 * seconds, so this is a "check back" state rather than an error — and critically
 * it never invites a second payment attempt.
 */
function AwaitingPayment({ reference }: { reference: string }) {
  return (
    <>
      <PageHeader
        kicker="Confirming your payment"
        title="Nearly there."
        lead="We are waiting for confirmation from our payment provider. This usually takes a few seconds."
      />
      <Section ground="terrazzo" rhythm="default">
        <Body>
          Please refresh this page in a moment. Your reference is{" "}
          <Data muted={false}>{reference}</Data>.
        </Body>
        <Body className="mt-2">
          <strong className="font-bold">Do not pay again.</strong> If your payment
          went through, the booking will appear here shortly and you will receive
          an email. If nothing has changed after a few minutes, call us with your
          reference and we will check it for you.
        </Body>
        <CallUs
          className="mt-3"
          value={contact.bookingsPhone}
          label="Bookings phone number (Founder)"
        />
      </Section>
    </>
  );
}

/**
 * No such reference. Deliberately says nothing about whether a booking with that
 * reference could exist — this page is reachable by anyone typing a URL, so it
 * must not confirm or deny the existence of other people's bookings.
 */
function NotFound({ reference }: { reference?: string }) {
  return (
    <>
      <PageHeader
        kicker="Booking"
        title="We cannot find that booking."
        lead="The link may be incomplete, or the booking may have been made some time ago."
      />
      <Section ground="terrazzo" rhythm="default">
        <Body>
          If you have just paid, give it a moment and try your confirmation link
          again. Otherwise call us{reference ? " with your reference" : ""} and we
          will look it up.
        </Body>
        <CallUs
          className="mt-3"
          value={contact.bookingsPhone}
          label="Bookings phone number (Founder)"
        />
        <Button href={routes.firstVisit} variant="secondary" className="mt-4">
          Back to the first visit
        </Button>
      </Section>
    </>
  );
}
