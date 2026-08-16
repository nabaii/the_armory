import { format, fromStorage } from "@/lib/money";

/**
 * THE GUEST OVERAGE PRICE, AS A MEMBER READS IT.
 *
 * §14: "Guest overage price — Blocks charging logic. Configurable, so not
 * structurally blocking. Needed by: Before M8."
 *
 * Not settled, so this returns null and the surfaces say "the guest rate"
 * rather than inventing a number. §12 requires the price be SHOWN, and a
 * made-up figure shown to a member is worse than a vaguer sentence — they would
 * hold the club to it, and they would be right to.
 *
 * ===========================================================================
 * WHY THIS MOVED OUT OF THE ACTIONS FILE
 *
 * It lived in src/app/actions/hosting.ts, which is a `"use server"` module. It
 * was a private function there so it was never registered as an endpoint and
 * nothing was broken — but the booking flow's confirm step needs the same
 * label, and the only ways to share it from there are to export it (which
 * §13.2's named risk forbids: every export of a "use server" module becomes a
 * client-callable endpoint) or to write it twice.
 *
 * A price formatted in two places is a price formatted differently in two
 * places, and this one appears on a screen where a member is agreeing to pay
 * it. So it lives here, in an ordinary module both can import.
 */
export function overagePriceLabel(): string | null {
  const kobo = process.env.GUEST_OVERAGE_KOBO;
  if (!kobo) return null;
  return format(fromStorage(kobo));
}
