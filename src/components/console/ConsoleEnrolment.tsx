"use client";

import { useState } from "react";

/**
 * ENROLLING A TABLET — §3.1.
 *
 *   "Desk and lane surfaces load only on a registered, unrevoked device."
 *
 * The screen a device shows before it is one. A founder registers the tablet in the
 * owner dashboard, which issues a token once; it is typed here, exchanged for the
 * device's identity and its first day pack, and stored in IndexedDB where §10's
 * wipe can reach it.
 *
 * The reasoning for typing rather than a one-time link is in `enrolDevice`: a token
 * in a URL lands in browser history and every proxy log between here and the
 * database, and this one opens the whole roster.
 *
 * ===========================================================================
 * WHY THIS EXISTS IN M1 AT ALL
 *
 * The owner dashboard is M9 and device registration is M0's server side. This is
 * the smallest client that turns those into a working tablet, and it is here because
 * §11 requires M1 to be "demonstrated with a real workflow and a real power cut
 * before M2 begins" — which is not possible on a device that has no way to obtain a
 * credential. It is deliberately plain: one field, one button, no branding. A
 * founder sees it once per tablet.
 */
export function ConsoleEnrolment({
  onEnrol,
}: {
  /** Returns a sentence on refusal, or null once the device is enrolled. */
  onEnrol: (token: string) => Promise<string | null>;
}) {
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <form
        className="w-full max-w-md"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;

          setBusy(true);
          setProblem(null);
          try {
            setProblem(await onEnrol(token.trim()));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          This tablet is not registered yet.
        </h1>
        <p className="mt-3 text-[--color-sight-ink]">
          A founder can register it in the owner dashboard, which shows a code once.
          Enter that code and this tablet will download today&rsquo;s information and
          work offline from then on.
        </p>

        <label className="mt-6 block text-sm font-medium" htmlFor="device-token">
          Registration code
        </label>
        <input
          id="device-token"
          name="device-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          /* Not `type="password"`. The founder is typing a long random string on a
             tablet keyboard, in a locked building, and needs to see it — a masked
             field here buys nothing and costs a mistyped character. */
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          className="mt-1 w-full rounded border border-[--color-sight-grey] px-3 py-2 font-mono"
        />

        {problem && (
          <p
            role="alert"
            className="mt-3 border-l-4 border-[--color-ten-ring-deep] pl-3 text-sm font-medium"
          >
            {problem}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || token.trim().length === 0}
          className="mt-6 rounded border border-[--color-reticle-black] px-4 py-2 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
        >
          {busy ? "Registering…" : "Register this tablet"}
        </button>
      </form>
    </div>
  );
}
