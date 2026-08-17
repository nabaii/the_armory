"use server";

import { revalidatePath } from "next/cache";
import { getArmoryDb } from "@/db/armory/client";
import { routes } from "@/lib/site";
import { resolveStaff } from "@/server/armory/manage-session";
import { publishServiceHours } from "@/server/armory/manage-writes";
import type { ManageFormState } from "@/lib/manage-state";

/**
 * PUBLISH WHEN THE KITCHEN SERVES — Management §7.1, finding F3.
 *
 * The surface that settles `kitchen-hours`. Until it is used, `service_hours` is
 * empty, no cover is bookable, and the member Diary says which decision is
 * outstanding rather than rendering an empty grid.
 *
 * ===========================================================================
 * IT TAKES THE WHOLE WEEK, NOT A ROW
 *
 * The opposite of `opening_hours`, which is edited one period at a time by
 * somebody correcting a Thursday. Kitchen hours arrive as a decision ABOUT THE
 * WEEK — "we serve lunch every day and dinner on Fridays" — and a row-at-a-time
 * editor would make that seven separate acts, six of which leave the club in a
 * state nobody chose.
 *
 * One form, one transaction, and a half-published week never exists.
 */
export async function saveServiceHours(
  _previous: ManageFormState,
  formData: FormData,
): Promise<ManageFormState> {
  const resolution = await resolveStaff();
  if (resolution.state !== "staff") {
    return { status: "error", message: "You are not signed in as staff." };
  }

  const opens = String(formData.get("opens") ?? "");
  const closes = String(formData.get("closes") ?? "");
  const label = String(formData.get("label") ?? "").trim() || null;
  const days = formData.getAll("weekday").map((value) => Number(value));

  const opensMinute = toMinutes(opens);
  const closesMinute = toMinutes(closes);

  if (opensMinute === null || closesMinute === null) {
    return { status: "error", message: "Give a start and an end time." };
  }
  if (days.length === 0) {
    /* Clearing the week is a legitimate act — the kitchen closes for a
       refurbishment — but it must be deliberate rather than the result of an
       unticked form. */
    return {
      status: "error",
      message:
        "Choose at least one day. To stop serving entirely, use Clear the week.",
    };
  }

  const result = await publishServiceHours(getArmoryDb(), {
    principal: resolution.principal,
    periods: days.map((weekday) => ({
      weekday,
      opensMinute,
      closesMinute,
      label,
    })),
  });

  if (!result.ok) return { status: "error", message: result.reason };

  revalidatePath(routes.manageDiary, "page");
  /* The member Diary reads the same rows, and a founder who published hours and
     found the portal unchanged would reasonably conclude it had not worked. */
  revalidatePath(routes.portalBook, "page");

  return {
    status: "ok",
    message: `Published. The kitchen serves on ${days.length} day${days.length === 1 ? "" : "s"}.`,
    outstanding:
      /* Covers are the other half. Both must be answered before a table can be
         sold, and answering one leaves the surface still saying so. */
      ["table_capacity_outstanding"],
  };
}

/**
 * Stop serving entirely.
 *
 * The two parameters are unused and cannot be dropped: `useActionState` calls
 * every action with (previousState, formData), and an action taking fewer
 * arguments would still be called with both. Named rather than omitted so the
 * signature reads as the contract it is.
 */
export async function clearServiceHours(
  previous: ManageFormState,
  formData: FormData,
): Promise<ManageFormState> {
  /* Neither argument is needed — clearing the week takes no input and does not
     depend on what happened last time. Declared and discarded rather than
     omitted, because the signature is the contract `useActionState` calls. */
  void previous;
  void formData;

  const resolution = await resolveStaff();
  if (resolution.state !== "staff") {
    return { status: "error", message: "You are not signed in as staff." };
  }

  const result = await publishServiceHours(getArmoryDb(), {
    principal: resolution.principal,
    periods: [],
  });

  if (!result.ok) return { status: "error", message: result.reason };

  revalidatePath(routes.manageDiary, "page");
  revalidatePath(routes.portalBook, "page");

  return {
    status: "ok",
    message:
      "Cleared. No cover is bookable, and the Diary says the club has not published kitchen hours.",
  };
}

/** "12:30" to 750. Null on anything that is not a time. */
function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
