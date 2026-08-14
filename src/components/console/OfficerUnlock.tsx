"use client";

import { useState } from "react";
import type { PackStaff } from "@/offline/daypack";
import {
  MAX_LOCAL_ATTEMPTS,
  beginShift,
  unlockLocally,
  type OfficerShift,
} from "@/offline/officer";

/**
 * THE OFFICER SIGN-IN — §10, §7's `/auth/staff/unlock`.
 *
 *   §10: "No shared logins. Every staff action attributable to a named person.
 *         Device-bound sessions with a short local unlock."
 *
 * Two paths to the same place, and which one runs depends only on whether the
 * tablet has a connection:
 *
 *   ONLINE   the PIN goes to the server, which knows the truth. On success the
 *            browser derives a local verifier from that same PIN and keeps it
 *            for the shift.
 *   OFFLINE  the PIN is checked against that local verifier. No network, no
 *            server, and no PIN hash was ever shipped to this device.
 *
 * ===========================================================================
 * WHY THE OFFICER LIST IS SHOWN AND THE PIN IS NOT A PASSWORD
 *
 * The desk lists the club's officers by name. That looks like an information
 * leak and is not: anyone holding this tablet is standing in the club, and the
 * roster is on the wall. What the list buys is that an officer taps their own
 * name rather than typing an identifier, which is the difference between a
 * six-second unlock and a fifteen-second one at the start of a shift.
 *
 * The PIN is the second factor, not the credential. The first is the device
 * itself (drizzle/0003), and neither works alone — see
 * src/server/armory/staff-session.ts.
 *
 * ===========================================================================
 * A FAILED OFFLINE UNLOCK IS RECOVERABLE ONLY BY RECONNECTING
 *
 * Three wrong PINs and this screen stops accepting them. There is deliberately
 * no way out from here: offline there is nobody to appeal to, and a local escape
 * hatch would be an escape hatch for whoever stole the tablet too. Reconnecting
 * is the recovery, and the message says so.
 */

export type UnlockMode = "online" | "offline";

export function OfficerUnlock({
  staff,
  shift,
  mode,
  onSignedIn,
  onShiftChanged,
}: {
  /** From the day pack. Active officers only — see the filter below. */
  staff: readonly PackStaff[];
  /** The shift already on this device, if any. Null before the first sign-in. */
  shift: OfficerShift | null;
  mode: UnlockMode;
  /** Called with the PIN so the caller can hit the server and persist. */
  onSignedIn: (input: {
    staffUserId: string;
    pin: string;
  }) => Promise<
    /* The staff session, so §6.6's dashboard read has a credential. Null when
       the server answered without one — see `sessionToken` in officer.ts. */
    | { ok: true; token: string | null; expiresAt: Date | null }
    | { ok: false; reason: string }
  >;
  onShiftChanged: (shift: OfficerShift | null) => Promise<void>;
}) {
  /* An officer whose account has been deactivated must not be offered. The pack
     carries `active` for exactly this, and a name on this list is a name that
     will appear on custody events. */
  const officers = staff.filter((member) => member.active);

  /* Offline, only the officer whose verifier this device holds can unlock —
     there is nothing to check anyone else against. Showing the full list would
     invite an officer to tap their own name and be refused for a reason that
     sounds like their PIN was wrong. */
  const choices =
    mode === "offline" && shift
      ? officers.filter((member) => member.id === shift.staffUserId)
      : officers;

  const [staffUserId, setStaffUserId] = useState(choices[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remedy, setRemedy] = useState<string | null>(null);

  const spent =
    mode === "offline" &&
    shift !== null &&
    shift.failedAttempts >= MAX_LOCAL_ATTEMPTS;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setRemedy(null);

    try {
      if (mode === "online") {
        const result = await onSignedIn({ staffUserId, pin });

        if (!result.ok) {
          setError(result.reason);
          return;
        }

        /* Derived only AFTER the server said yes. Deriving it first would let
           anyone holding the tablet mint a shift for any officer they could
           name — the shared login §10 forbids, wearing a disguise. */
        const member = officers.find((row) => row.id === staffUserId);
        await onShiftChanged(
          await beginShift({
            staffUserId,
            displayName: member?.displayName ?? "Officer",
            role: member?.role ?? "range_officer",
            pin,
            now: new Date(),
            /* Carried from the unlock response. Null on an offline unlock,
               which never spoke to a server — see `sessionToken`. */
            sessionToken: result.token,
            sessionExpiresAt: result.expiresAt,
          }),
        );
        return;
      }

      const outcome = await unlockLocally(shift, pin, new Date());

      /* The shift is persisted on failure too — that is what makes the attempt
         count survive a force-quit, which is the first thing anyone would try. */
      await onShiftChanged(outcome.shift);

      if (!outcome.ok) {
        setError(outcome.reason);
        setRemedy(outcome.remedy);
      }
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "online" ? "Sign in to the desk" : "Unlock the desk"}
          </h1>
          <p className="mt-1 text-sm text-[--color-sight-ink]">
            {mode === "online"
              ? "Your PIN, on a tablet the club has registered."
              : "No connection. Your PIN is checked on this tablet."}
          </p>
        </div>

        {choices.length === 0 ? (
          <p className="border-l-4 border-[--color-ten-ring-deep] py-2 pl-3 text-sm font-medium">
            {mode === "offline"
              ? "No officer has signed in on this tablet. Sign in once while there is a connection."
              : "This device has no officers on file. Sync while there is a connection."}
          </p>
        ) : (
          <>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Officer</legend>
              {choices.map((member) => (
                <label
                  key={member.id}
                  className="flex items-center gap-3 border border-[--color-terrazzo] p-3"
                >
                  <input
                    type="radio"
                    name="officer"
                    value={member.id}
                    checked={staffUserId === member.id}
                    onChange={() => setStaffUserId(member.id)}
                    className="size-4 shrink-0"
                  />
                  <span className="flex-1">{member.displayName}</span>
                  <span className="text-sm text-[--color-sight-ink]">
                    {member.role.replace("_", " ")}
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="block space-y-1">
              <span className="text-sm font-medium">PIN</span>
              <input
                type="password"
                /* Numeric keypad, and never remembered. A stored PIN on a shared
                   tablet is the shared login §10 forbids. */
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                disabled={spent}
                required
                className="w-full border border-[--color-reticle-black] px-3 py-2 text-lg tracking-widest"
              />
            </label>

            {error && (
              <p
                role="alert"
                className="border-l-4 border-[--color-ten-ring-deep] py-2 pl-3 text-sm font-medium"
              >
                {error}
                {remedy && (
                  <span className="mt-1 block font-normal">{remedy}</span>
                )}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || spent || pin.length === 0}
              className="w-full border border-[--color-reticle-black] px-4 py-3 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
            >
              {busy ? "Checking…" : mode === "online" ? "Sign in" : "Unlock"}
            </button>
          </>
        )}

        {shift && mode === "offline" && !spent && (
          <p className="text-sm text-[--color-sight-ink]">
            {shift.displayName}&rsquo;s shift, until{" "}
            {shift.expiresAt.toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </p>
        )}
      </form>
    </div>
  );
}
