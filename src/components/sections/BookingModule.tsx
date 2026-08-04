import { connection } from "next/server";
import { Body, Caption, Kicker } from "@/components/ui/Text";
import { Pending } from "@/components/ui/Pending";
import { Button } from "@/components/ui/Button";
import { BookingForm, type SlotGroup } from "@/components/sections/BookingForm";
import { generateSlots, groupSlotsByDate } from "@/server/slots";
import { bookingStore } from "@/server/booking-store";
import { bookingConfig, bookingIsLive } from "@/content/booking";
import { formatNaira, nairaToKobo } from "@/server/paystack";
import { isConfigured } from "@/server/env";
import { contact, routes } from "@/lib/site";

/* ============================================================================
   BOOKING MODULE — the server half of Flow B.

   Generates the bookable sessions, reads live remaining capacity for each, and
   hands a plain data structure to the client form. Availability is computed
   here rather than in the browser so a stale tab cannot show places that are
   already gone — and the action re-derives the slot again at submission, because
   even a fresh render is a snapshot.

   ----------------------------------------------------------------------------
   IT REFUSES TO RENDER A PAYMENT FORM IT CANNOT HONOUR

   Three preconditions, and it degrades to a phone number rather than a broken
   form if any are missing:

     · price and deposit          — outstanding from the Founder (spec §8)
     · a published policy version — "Deposits require a written refund policy,
                                    settled before the booking flow is designed"
     · Paystack credentials

   Showing a payment form without these would either take money against terms
   that do not exist, or fail at the last step of the site's second most
   important flow. A visible phone number is a worse conversion path and an
   honest one.
   ========================================================================= */

export async function BookingModule() {
  /* ---------------------------------------------------------------------
     STEP 1 — the CONTENT check, which is safe to answer at build time.

     Price, deposit and the refund-policy version live in src/content. They are
     baked into the build by definition, so deciding on them during prerender is
     correct: while booking is closed the page has no per-request content and
     should stay static, which is free.
     ------------------------------------------------------------------ */
  if (!bookingIsLive()) return <NotYetOpen />;

  /* ---------------------------------------------------------------------
     STEP 2 — go dynamic BEFORE reading anything from the environment.

     Two separate hazards, and the ordering here handles both:

     a) STALE AVAILABILITY. Without this the page prerenders and every visitor
        sees the capacity that existed when the build ran — sessions offering
        places taken days ago, and a rejection at the last step of the flow.

     b) BAKED-IN CONFIGURATION. This one was found by running the audit.
        `isConfigured.payments()` reads PAYSTACK_SECRET_KEY, and if that check
        runs during prerender it is answered with the BUILD environment. A host
        that injects the key at runtime would still serve a permanently
        "booking is closed" page, because the closed branch was baked in — and
        nothing would look broken. Reading env only after `connection()`
        guarantees the answer comes from the running server.
     ------------------------------------------------------------------ */
  await connection();

  if (!isConfigured.payments()) return <NotYetOpen />;

  const slots = generateSlots();

  /* Remaining capacity per slot. Sequential rather than parallel is fine at
     this scale — a 28-day horizon over four weekly sessions is ~16 slots, and
     the in-memory store answers instantly. A calendar-backed store should batch
     this into a single date-range query instead. */
  const groups: SlotGroup[] = [];
  for (const group of groupSlotsByDate(slots)) {
    const withCapacity = await Promise.all(
      group.slots.map(async (slot) => ({
        id: slot.id,
        dateLabel: slot.dateLabel,
        timeLabel: slot.timeLabel,
        remaining: await bookingStore.remainingCapacity(slot.id, slot.capacity),
      })),
    );
    groups.push({ dateLabel: group.dateLabel, slots: withCapacity });
  }

  const anyAvailable = groups.some((g) => g.slots.some((s) => s.remaining > 0));
  if (!anyAvailable) return <FullyBooked />;

  return (
    <BookingForm
      groups={groups}
      policyVersion={bookingConfig.policyVersion}
      priceLabel={formatNaira(nairaToKobo(bookingConfig.pricing.perPersonNaira!))}
      depositLabel={formatNaira(nairaToKobo(bookingConfig.pricing.depositNaira!))}
      maxPartySize={bookingConfig.maxPartySize}
    />
  );
}

function NotYetOpen() {
  return (
    <div>
      {bookingConfig.pricing.perPersonNaira === null && (
        <Pending label="First-visit price (Founder)" />
      )}
      {bookingConfig.pricing.depositNaira === null && (
        <Pending label="Deposit amount (Founder)" />
      )}
      {bookingConfig.policyVersion === "unpublished" && (
        <Pending label="Refund and deposit policy wording, and its version (Legal)" />
      )}
      {!isConfigured.payments() && (
        <Pending label="Paystack credentials (Build team — PAYSTACK_SECRET_KEY)" />
      )}

      {/* The copy adapts to whether a phone number actually exists.
          `Pending` renders nothing in production, so "please call us" followed
          by an empty space would instruct the visitor to do something the page
          cannot help them do — an untrue claim by omission. Until the number
          lands, the enquiry form is the honest route, because it exists. */}
      {contact.bookingsPhone ? (
        <>
          <Body className="mt-3">
            Online booking opens once our deposit terms are published. Until
            then, please call us and we will arrange your first visit directly.
          </Body>
          <Caption className="mt-2">
            <PhoneLink value={contact.bookingsPhone} />
          </Caption>
        </>
      ) : (
        <>
          <Body className="mt-3">
            Online booking opens once our deposit terms are published. Until
            then, send us an enquiry and we will arrange your first visit
            directly.
          </Body>
          <Button href={routes.enquire} variant="primary" className="mt-3">
            Enquire about a first visit
          </Button>
        </>
      )}
    </div>
  );
}

function PhoneLink({ value }: { value: string }) {
  return (
    <a
      href={`tel:${value.replace(/\s/g, "")}`}
      className="underline decoration-1 underline-offset-2"
    >
      Call {value}
    </a>
  );
}

function FullyBooked() {
  return (
    <div>
      <Kicker className="mb-2">Fully booked</Kicker>
      {contact.bookingsPhone ? (
        <>
          <Body>
            Every session in the next {bookingConfig.horizonDays} days is taken.
            New dates open regularly — or call us and we will find you a place.
          </Body>
          <Caption className="mt-2">
            <PhoneLink value={contact.bookingsPhone} />
          </Caption>
        </>
      ) : (
        <>
          <Body>
            Every session in the next {bookingConfig.horizonDays} days is taken.
            New dates open regularly — or send us an enquiry and we will find you
            a place.
          </Body>
          <Button href={routes.enquire} variant="secondary" className="mt-3">
            Enquire about a first visit
          </Button>
        </>
      )}
    </div>
  );
}
