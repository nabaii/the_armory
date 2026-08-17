/**
 * FORM STATE FOR THE MANAGEMENT SURFACE — and why it is not in the action file.
 *
 * §14: "Server actions must not export their state objects. The defect that took
 * down member sign-in will recur on every new form surface in this document
 * unless it is a lint rule rather than institutional memory."
 *
 * ===========================================================================
 * WHAT THE DEFECT WAS, BECAUSE THE RULE READS LIKE STYLE UNTIL YOU KNOW
 *
 * Every export from a `"use server"` module is treated as a server action, and an
 * action must be an async function. A type export is erased at build time and
 * causes nothing to fail loudly — but a CONST or an object export is not, and
 * Next registers it as an action with a generated id that nothing calls. Member
 * sign-in shipped that way and the form silently did nothing.
 *
 * The fix is structural rather than remembered: shared shapes live in `src/lib`,
 * beside `sign-in-state.ts` and `booking-flow-state.ts`, and the action module
 * exports functions and nothing else.
 */

export type ManageFormState =
  | { readonly status: "idle" }
  | { readonly status: "ok"; readonly message: string;
      /**
       * What the club now owes, where an action's effects are not built.
       *
       * §6.2's operating level is meant to cap guest bookings, close slots,
       * notify members and refresh the desk's day pack. It records the change and
       * performs none of them, so the successful result carries the list.
       *
       * A confirmation that implied a WhatsApp message had gone out would be a
       * lie told at the worst possible moment — an understaffed evening, to the
       * person who now believes the members have been told.
       */
      readonly outstanding?: readonly string[];
    }
  | { readonly status: "error"; readonly message: string };

export const MANAGE_FORM_IDLE: ManageFormState = { status: "idle" };

/**
 * What each unperformed consequence means, in words a duty manager can act on.
 *
 * Keyed by the `Consequence["kind"]` values in src/domain/operating.ts. A key
 * missing from here renders its own id, which is ugly and truthful — better than
 * silently dropping an obligation the club has just incurred.
 */
export const CONSEQUENCE_LINES: Readonly<Record<string, string>> = {
  cap_guest_bookings: "Guest bookings are not capped automatically yet — check the book.",
  close_shooting_slots: "Affected shooting slots are still open. Close them in the Diary.",
  notify_affected_members: "Members have NOT been told. Send the WhatsApp message.",
  refresh_day_pack: "The desk console still holds the old level until it next syncs.",
  reopen_availability: "Availability does not reopen by itself. Check the Diary.",
  /* Not a consequence of the ladder — the other half of F3. Both kitchen hours
     and a cover count must exist before a table can be sold, and answering one
     leaves the surface still explaining itself. */
  table_capacity_outstanding:
    "Covers are still uncounted, so no table is bookable yet. That is `table-capacity` on the register.",
};
