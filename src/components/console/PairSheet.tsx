"use client";

import { useState } from "react";

/**
 * PAIR — §6.5.
 *
 *   "Pair — Assign shooter to firearm by serial. CALLS MAY_USE_OWN_FIREARM.
 *    COMPLETABLE IN UNDER TWENTY SECONDS, STANDING, ONE-HANDED."
 *
 * ===========================================================================
 * ONE-HANDED IS A LAYOUT REQUIREMENT, AND IT IS THE WHOLE DESIGN
 *
 * The officer's other hand is holding the firearm. That is not a figure of
 * speech — it is why this sheet has exactly one input, why the confirm sits
 * directly under it rather than in a header, and why there is no lot picker, no
 * quantity and no second step. The desk's EquipmentSheet does all of that
 * (§6.4) because the desk is a counter and the officer can put things down.
 *
 * The keyboard is the system one here, unlike the score keypad, because a
 * serial contains letters and a custom alphanumeric keypad would be a worse
 * keyboard than the one the tablet ships with. Autocorrect and capitalisation
 * are off for the reason EquipmentSheet gives: a serial is not a word, and a
 * keyboard "helpfully" fixing one is a refused pairing and a confused officer.
 *
 * ===========================================================================
 * THE CAPABILITY CALL IS NOT IN THIS FILE
 *
 * §6.5 says this screen calls MAY_USE_OWN_FIREARM, and it does — through
 * `buildFirearmIssue` in src/offline/equipment.ts, which is the same function
 * the desk calls, with the same subject, reaching the same §4 service. Two
 * surfaces asking the same question must not be able to get two answers, and
 * the way to guarantee that is for neither of them to ask it directly.
 *
 * So this component renders a field and shows the sentence that comes back.
 */

export function PairSheet({
  shooterName,
  currentSerial,
  onPair,
  onReturn,
  onCancel,
}: {
  shooterName: string;
  /** What they are already holding, if anything. */
  currentSerial: string | null;
  /** Returns a refusal to show, or null on success. */
  onPair: (serialNumber: string) => Promise<string | null>;
  /** §3.4: a return is a new custody event, never an edit to the issue. */
  onReturn: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void action()
      .then(setError)
      .finally(() => setBusy(false));
  };

  return (
    <section
      aria-label={`Pair a firearm to ${shooterName}`}
      className="fixed inset-0 z-20 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-medium">{shooterName}</h2>
          <p className="text-[--color-sight-ink]">Pair a firearm</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-[--color-reticle-black] px-4 py-3 font-medium"
        >
          Done
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="mt-3 border-l-8 border-[--color-ten-ring-deep] py-2 pl-3 text-lg font-medium"
        >
          {error}
        </p>
      )}

      {currentSerial && (
        <div className="mt-6 border border-[--color-terrazzo] p-4">
          <p className="text-sm tracking-wide text-[--color-sight-ink] uppercase">
            Currently holding
          </p>
          <p className="mt-1 font-mono text-3xl">{currentSerial}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(onReturn)}
            className="mt-3 w-full border border-[--color-reticle-black] px-4 py-4 text-lg font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
          >
            Return to the rack
          </button>
        </div>
      )}

      <label className="mt-6 block space-y-2">
        <span className="text-sm font-medium tracking-wide uppercase">
          {currentSerial ? "Pair a different firearm" : "Serial number"}
        </span>
        <input
          value={serial}
          onChange={(event) => setSerial(event.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          /* Not `autoFocus`. On Android that raises the keyboard before the
             sheet has finished animating, which lands the caret in a field that
             has moved — and the officer types the first two characters into
             nothing. They tap the field; it is the largest target on screen. */
          className="w-full border border-[--color-reticle-black] px-4 py-4 font-mono text-3xl"
          placeholder="AB1234"
        />
      </label>

      <button
        type="button"
        disabled={busy || serial.trim().length === 0}
        onClick={() =>
          run(async () => {
            const problem = await onPair(serial.trim());
            if (!problem) setSerial("");
            return problem;
          })
        }
        className="mt-3 w-full border border-[--color-reticle-black] bg-[--color-reticle-black] px-4 py-5 text-2xl font-medium text-[--color-bone] disabled:border-[--color-sight-grey] disabled:bg-transparent disabled:text-[--color-sight-grey]"
      >
        Pair
      </button>
    </section>
  );
}
