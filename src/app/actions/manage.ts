"use server";

import { revalidatePath } from "next/cache";
import { getArmoryDb } from "@/db/armory/client";
import {
  DEGRADATION_CAUSES,
  NEAR_MISS_KINDS,
  OPERATING_LEVELS,
  type DegradationCause,
  type NearMissKind,
  type OperatingLevel,
} from "@/domain/enums";
import { routes } from "@/lib/site";
import { resolveStaff } from "@/server/armory/manage-session";
import {
  assignApplication,
  fileNearMiss,
  setOperatingLevel,
} from "@/server/armory/manage-writes";
import type { ManageFormState } from "@/lib/manage-state";

/**
 * THE MANAGEMENT SURFACE'S WRITES, AS SERVER ACTIONS.
 *
 * ===========================================================================
 * NO STATE TYPE IS EXPORTED FROM THIS MODULE — §14
 *
 * "Server actions must not export their state objects. The defect that took down
 * member sign-in will recur on every new form surface in this document unless it
 * is a lint rule rather than institutional memory."
 *
 * Every `"use server"` export must be an async function, so a type exported
 * alongside them is a build-time failure at best and a broken form at worst.
 * `ManageFormState` therefore lives in src/lib/manage-state.ts, beside
 * `booking-flow-state.ts` and `sign-in-state.ts`, which exist for exactly this.
 *
 * ===========================================================================
 * EVERY ACTION RE-RESOLVES THE PRINCIPAL
 *
 * None of these trusts the form, the referrer or the fact that a button rendered.
 * A server action is a public endpoint; the grant is the control.
 */

const refuse = (message: string): ManageFormState => ({ status: "error", message });

/** Narrow a form value against a closed vocabulary, or fail. */
function oneOf<T extends string>(
  value: FormDataEntryValue | null,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/* ============================================================================
   THE OPERATING LEVEL — §6.2
   ========================================================================= */

export async function moveOperatingLevel(
  _previous: ManageFormState,
  formData: FormData,
): Promise<ManageFormState> {
  const resolution = await resolveStaff();
  if (resolution.state !== "staff") return refuse("You are not signed in as staff.");

  const to = oneOf<OperatingLevel>(formData.get("to"), OPERATING_LEVELS);
  const cause = oneOf<DegradationCause>(formData.get("cause"), DEGRADATION_CAUSES);
  const note = String(formData.get("note") ?? "");

  if (!to) return refuse("Choose which level the club is moving to.");
  if (!cause) return refuse("Choose why the club is moving.");

  const result = await setOperatingLevel(getArmoryDb(), {
    principal: resolution.principal,
    to,
    cause,
    note,
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath(routes.manage, "layout");

  /**
   * The consequences are reported rather than silently performed.
   *
   * §6.2 requires the move to cap guest bookings, close affected slots, notify
   * members and refresh the desk's day pack. None of those is built. Telling the
   * duty manager what the club now owes is honest; a confirmation implying a
   * WhatsApp message went out would be a lie told at the worst possible moment.
   */
  const owed = (result.consequences ?? []).map((consequence) => consequence.kind);

  return {
    status: "ok",
    message: "The operating level is set, and the change is on the record.",
    outstanding: owed,
  };
}

/* ============================================================================
   NEAR-MISSES — §9.2
   ========================================================================= */

export async function reportNearMiss(
  _previous: ManageFormState,
  formData: FormData,
): Promise<ManageFormState> {
  const resolution = await resolveStaff();
  if (resolution.state !== "staff") return refuse("You are not signed in as staff.");

  const kind = oneOf<NearMissKind>(formData.get("kind"), NEAR_MISS_KINDS);
  if (!kind) return refuse("Choose what the near-miss was about.");

  const result = await fileNearMiss(getArmoryDb(), {
    principal: resolution.principal,
    draft: {
      kind,
      whatHappened: String(formData.get("whatHappened") ?? ""),
      /* Unchecked means anonymous. The default is the safer one: a form that
         defaulted to naming somebody would make the choice for them at the
         moment they are least likely to notice it. */
      named: formData.get("named") === "1",
      location: (String(formData.get("location") ?? "").trim() || null) as string | null,
    },
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath(routes.manageSafety, "page");

  return {
    status: "ok",
    /* Thanks rather than a receipt. §9.2 makes the count "a positive signal of
       reporting culture", and the person who just filed one is the culture. */
    message: "Filed. Thank you — a report is worth more than a tidy record.",
  };
}

/* ============================================================================
   THE APPLICATIONS QUEUE — §8.2
   ========================================================================= */

export async function takeApplication(
  _previous: ManageFormState,
  formData: FormData,
): Promise<ManageFormState> {
  const resolution = await resolveStaff();
  if (resolution.state !== "staff") return refuse("You are not signed in as staff.");

  const applicationId = String(formData.get("applicationId") ?? "");
  if (!applicationId) return refuse("Which application?");

  /* Release is expressed by an explicit flag rather than by an absent owner, so
     a form that failed to send the field cannot silently un-own something. */
  const release = formData.get("release") === "1";

  const result = await assignApplication(getArmoryDb(), {
    principal: resolution.principal,
    applicationId,
    ownerStaffId: release ? null : resolution.principal.staffUserId,
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath(routes.managePeople, "page");
  revalidatePath(routes.manage, "page");

  return {
    status: "ok",
    message: release
      ? "Released. It is unowned again, and it will say so until somebody takes it."
      : "Yours. The queue now names you against it.",
  };
}
