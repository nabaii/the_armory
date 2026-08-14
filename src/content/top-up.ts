import { naira, type Kobo } from "@/lib/money";

/**
 * WHAT A MEMBER MAY TOP UP BY — §9's account top-up.
 *
 * ===========================================================================
 * A FIXED LIST IS THE SECURITY CONTROL, NOT A CONVENIENCE
 *
 * §9's first rule and src/server/paystack.ts's first non-negotiable: "the amount
 * never originates in the browser. A client-supplied amount is a
 * client-controlled price."
 *
 * The form posts an INDEX into this array and the server action reads the
 * amount from it. A member cannot top up ₦1 and cannot top up ₦0, and neither
 * refusal has to be written as a validation rule — there is no path that carries
 * an arbitrary number.
 *
 * It is also the better screen. A member choosing between three buttons decides
 * faster than one facing an empty box, and the club would rather they topped up
 * than abandoned it.
 *
 * ===========================================================================
 * WHY THIS IS NOT IN src/app/actions/money.ts
 *
 * It was, and the production build refused it: a `"use server"` module may only
 * export async functions, because everything else it exports would become a
 * client-callable endpoint. That constraint is doing real work here — it is the
 * framework refusing to let a price list masquerade as a server action — so the
 * list lives with the club's other content and the action imports it.
 */
export const TOP_UP_AMOUNTS: readonly Kobo[] = [
  naira(25_000),
  naira(50_000),
  naira(100_000),
];
