"use client";

import { useState } from "react";
import { describeScore, parseScore, type ScoreFormat } from "@/domain/scoring";

/**
 * THE SCORE SCREEN — §6.5.
 *
 *   "Score — Select shooter, enter total, confirm. NO FREE-TEXT ENTRY IN THE
 *    NORMAL PATH. UNDER TWENTY SECONDS. Guests are scored identically to
 *    members."
 *
 * The shooter is already selected — this sheet opens from their row on the
 * relay, which is the "select shooter" step. What is left is two taps and a
 * number: the format, the total, and confirm.
 *
 * ===========================================================================
 * THE KEYPAD IS THE SCREEN, NOT A FIELD ON IT
 *
 * A numeric `<input>` on a tablet raises the system keyboard, which on Android
 * covers the bottom half of the screen, takes a moment to animate in, and puts
 * the digits somewhere different depending on the keyboard the club's tablets
 * shipped with. Twenty seconds does not survive that reliably, and an officer
 * standing on a firing line is not looking down at a keyboard.
 *
 * So the digits are on the page, large and in a fixed place. The field is
 * read-only and shows what has been keyed. No system keyboard is ever raised,
 * which also means no autocorrect and no possibility of a letter in a score.
 *
 * ===========================================================================
 * THE CONFIRMATION IS THE SCORE, READ BACK
 *
 * §6.5 says "confirm", and the only thing an officer can usefully check is
 * whether the number on screen matches the card in their hand. So the confirm
 * button carries the score itself rather than the word "Confirm" — a button
 * that says what it is about to do cannot be pressed by muscle memory into
 * recording the wrong thing.
 */

export function ScoreSheet({
  shooterName,
  formats,
  onRecord,
  onCancel,
}: {
  shooterName: string;
  /** The formats for the bay this shooter is standing on. See buildScore. */
  formats: readonly ScoreFormat[];
  /** Returns a refusal to show, or null on success. */
  onRecord: (input: {
    formatId: string;
    keyed: string;
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [formatId, setFormatId] = useState(formats[0]?.id ?? "");
  const [keyed, setKeyed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const format = formats.find((candidate) => candidate.id === formatId) ?? null;
  const entry = format ? parseScore(format, keyed) : null;
  const ready = entry?.ok === true;

  const press = (key: string) => {
    setError(null);
    if (key === "back") {
      setKeyed((current) => current.slice(0, -1));
      return;
    }
    /* One decimal point, and only where the format has one. The guard is here
       as well as in `parseScore` so the officer cannot key something the parse
       will refuse — a keypad that accepts a second point and then says no is
       four wasted seconds out of twenty. */
    if (key === "." && (format?.scale !== 10 || keyed.includes("."))) return;
    setKeyed((current) => (current.length >= 8 ? current : current + key));
  };

  return (
    <section
      aria-label={`Record a score for ${shooterName}`}
      className="fixed inset-0 z-20 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-medium">{shooterName}</h2>
          <p className="text-[--color-sight-ink]">Record a score</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-[--color-reticle-black] px-4 py-3 font-medium"
        >
          Cancel
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

      {formats.length === 0 ? (
        <p className="mt-6 text-lg text-[--color-sight-ink]">
          This device has no course of fire on file for this bay. Sync while
          there is a connection.
        </p>
      ) : (
        <>
          {/* -------------------------------------------------- THE FORMAT */}

          <h3 className="mt-6 text-sm font-medium tracking-wide uppercase">
            Course of fire
          </h3>

          {/* Buttons rather than a `<select>`. A select is one tap to open, one
              scroll and one tap to choose; these are one tap, and the whole list
              is three or four items. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {formats.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => {
                  setFormatId(candidate.id);
                  /* Cleared, because a total keyed against a 60-shot card is
                     not a total against a 20-shot one and carrying it over is
                     how a 578 lands on a practice card. */
                  setKeyed("");
                  setError(null);
                }}
                aria-pressed={candidate.id === formatId}
                className={`rounded border px-4 py-3 text-base font-medium ${
                  candidate.id === formatId
                    ? "border-[--color-reticle-black] bg-[--color-reticle-black] text-[--color-bone]"
                    : "border-[--color-reticle-black]"
                }`}
              >
                {candidate.label}
              </button>
            ))}
          </div>

          {/* --------------------------------------------------- THE TOTAL */}

          <h3 className="mt-8 text-sm font-medium tracking-wide uppercase">
            Total
          </h3>

          <p
            aria-live="polite"
            className="mt-2 border border-[--color-reticle-black] px-4 py-4 text-right text-5xl leading-none font-semibold tabular-nums"
          >
            {keyed || <span className="text-[--color-sight-grey]">0</span>}
            {format && (
              <span className="ml-3 align-middle text-xl font-normal text-[--color-sight-ink]">
                / {describeScore(format, format.maxTotal)}
              </span>
            )}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => press(digit)}
                className="border border-[--color-reticle-black] py-5 text-3xl font-medium tabular-nums"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => press(".")}
              disabled={format?.scale !== 10}
              className="border border-[--color-reticle-black] py-5 text-3xl font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
            >
              .
            </button>
            <button
              type="button"
              onClick={() => press("0")}
              className="border border-[--color-reticle-black] py-5 text-3xl font-medium tabular-nums"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => press("back")}
              aria-label="Delete the last digit"
              className="border border-[--color-reticle-black] py-5 text-3xl font-medium"
            >
              ←
            </button>
          </div>

          {/* ------------------------------------------------- THE CONFIRM */}

          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => {
              if (busy || !format) return;
              setBusy(true);
              setError(null);
              void onRecord({ formatId: format.id, keyed })
                .then((problem) => {
                  setError(problem);
                  if (!problem) setKeyed("");
                })
                .finally(() => setBusy(false));
            }}
            className="mt-6 w-full border border-[--color-reticle-black] bg-[--color-reticle-black] px-4 py-5 text-2xl font-medium text-[--color-bone] disabled:border-[--color-sight-grey] disabled:bg-transparent disabled:text-[--color-sight-grey]"
          >
            {/* The button says what it is about to record. A button that names
                the number cannot be pressed by muscle memory into the wrong one. */}
            {ready && format && entry?.ok
              ? `Record ${describeScore(format, entry.totalScore)}`
              : "Record"}
          </button>

          {/* The parse's own sentence, shown while keying rather than on
              confirm — the officer finds out the card cannot be a 6000 before
              they reach for the button, not after. */}
          {keyed !== "" && entry?.ok === false && (
            <p className="mt-2 text-lg font-medium">{entry.refusal.reason}</p>
          )}
        </>
      )}
    </section>
  );
}
