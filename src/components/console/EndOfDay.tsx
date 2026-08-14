"use client";

import { useState } from "react";
import type {
  EndOfDay as EndOfDayView,
  LocalAmmunitionIssue,
} from "@/offline/close";

/**
 * SESSION CLOSE AND END OF DAY — §6.4.
 *
 *   "Session close — Guarded. Lists everything outstanding. Cannot be forced
 *    without an override carrying a reason."
 *
 *   "End of day — One screen reconciling all sessions: firearms out versus in,
 *    ammunition issued versus fired versus returned, participations without
 *    checkout, sync queue depth. THE RANGE SHOULD NOT BE LOCKED UNTIL IT
 *    CLEARS."
 *
 * One screen for both, because they are the same act from the officer's side:
 * it is nine in the evening, the last shooter has gone, and the question is
 * whether the building can be locked. Splitting the reconciliation from the
 * close would mean reading one screen to find out what is outstanding and a
 * different one to do something about it.
 *
 * ===========================================================================
 * THE LIST IS THE POINT, NOT THE VERDICT
 *
 * §6.4 says the close "lists everything outstanding", and
 * src/domain/state-machines.ts explains why all at once rather than the first
 * problem: "An officer closing down at nine in the evening should get one list
 * and clear it, not discover a second item after fixing the first."
 *
 * So this screen leads with the list. The close button is underneath it and is
 * disabled until either the list is empty or a reason has been written — the
 * button is never the thing the officer reads first.
 */

export function EndOfDay({
  view,
  outstanding,
  unreconciled,
  shooterFor,
  onReconcile,
  onClose,
  onDismiss,
}: {
  view: EndOfDayView;
  /** From the close guard. Empty when the session may close cleanly. */
  outstanding: readonly string[];
  /** Issues still waiting to be counted back in. §3.4. */
  unreconciled: readonly LocalAmmunitionIssue[];
  shooterFor: (participationId: string) => string;
  onReconcile: (input: {
    issue: LocalAmmunitionIssue;
    qtyFired: number;
    qtyReturned: number;
  }) => Promise<string | null>;
  onClose: (override: { reason: string } | null) => void;
  onDismiss: () => void;
}) {
  const [reason, setReason] = useState("");

  const blocked = outstanding.length > 0;
  /* The same twelve characters as every other override in the system. §3.6:
     "An override is permitted but never silent", and a mandatory field that
     accepts "ok" is not mandatory. */
  const reasonReady = reason.trim().length >= 12;

  return (
    <section
      aria-label="End of day"
      className="fixed inset-0 z-20 overflow-y-auto bg-[--color-bone] p-4"
    >
      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium">End of day</h2>
          <p className="text-sm text-[--color-sight-ink]">
            {view.clear
              ? "Everything is accounted for."
              : "Something is still outstanding."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          Back
        </button>
      </header>

      {/* The reconciliation. Four lines, always the same four, in the same
          order — an officer doing this every night should be able to read it
          without looking for anything. */}
      <ul className="mt-4 divide-y divide-[--color-terrazzo]">
        {view.lines.map((line) => (
          <li
            key={line.label}
            className={`flex items-baseline gap-3 py-3 pl-3 ${
              line.outstanding
                ? "border-l-8 border-[--color-ten-ring-deep]"
                : "border-l-2 border-[--color-vip-teal]"
            }`}
          >
            <span aria-hidden className="w-4 shrink-0 font-mono">
              {line.outstanding ? "!" : "✓"}
            </span>
            <span className="sr-only">
              {line.outstanding ? "Outstanding." : "Clear."}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{line.label}</span>
              <span className="block text-sm text-[--color-sight-ink]">
                {line.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* §3.4: "Reconciled per participation, not per day." Per participation is
          why this is a list of shooters rather than one box for the evening —
          when the figures do not balance, the club needs to know WHOSE rounds
          are missing, not only that some are. */}
      {unreconciled.length > 0 && (
        <>
          <h3 className="mt-8 text-sm font-medium tracking-wide uppercase">
            Count rounds back in
          </h3>
          <ul className="mt-2 space-y-3">
            {unreconciled.map((issue) => (
              <ReconcileRow
                key={issue.issueId}
                issue={issue}
                shooter={shooterFor(issue.participationId)}
                onReconcile={onReconcile}
              />
            ))}
          </ul>
        </>
      )}

      {blocked && (
        <>
          <h3 className="mt-8 text-sm font-medium tracking-wide uppercase">
            Before this session can close
          </h3>
          <ul className="mt-2 space-y-1">
            {outstanding.map((item) => (
              <li
                key={item}
                className="border-l-4 border-[--color-ten-ring-deep] py-1 pl-3"
              >
                {item}
              </li>
            ))}
          </ul>

          <label className="mt-6 block space-y-1">
            <span className="text-sm font-medium">
              Or force the close, with a reason
            </span>
            {/* §12: "Override requires a reason and appears on the dashboard."
                The reason is stored with the whole outstanding list, because by
                the time a founder reads it the session is closed and the list
                is gone — see buildSessionClose. */}
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="w-full border border-[--color-reticle-black] p-2 text-sm"
              placeholder="Something a founder can read tomorrow morning and understand without asking anyone."
            />
          </label>
        </>
      )}

      <button
        type="button"
        disabled={blocked && !reasonReady}
        onClick={() => onClose(blocked ? { reason: reason.trim() } : null)}
        className="mt-6 w-full border border-[--color-reticle-black] px-4 py-3 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
      >
        {blocked ? "Force the close" : "Close the session"}
      </button>

      {/* Said plainly rather than implied by a disabled button. §4.3's rule
          about blocks: never leave someone guessing what would change it. */}
      {blocked && !reasonReady && (
        <p className="mt-2 text-sm text-[--color-sight-ink]">
          Clear the list above, or write a reason, to close.
        </p>
      )}
    </section>
  );
}


/**
 * One shooter's ammunition, counted back in.
 *
 * Only `fired` is typed. `returned` is derived, because the officer is holding a
 * tin and counting what came back — asking for both invites a mistyped pair that
 * happens to add up, which is the one error the §3.4 arithmetic cannot catch.
 *
 * It is still shown, so the officer can check the number against the tin before
 * committing.
 */
function ReconcileRow({
  issue,
  shooter,
  onReconcile,
}: {
  issue: LocalAmmunitionIssue;
  shooter: string;
  onReconcile: (input: {
    issue: LocalAmmunitionIssue;
    qtyFired: number;
    qtyReturned: number;
  }) => Promise<string | null>;
}) {
  const [fired, setFired] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = Number(fired);
  const usable = fired.trim().length > 0 && Number.isInteger(parsed) && parsed >= 0;
  const returned = usable ? issue.qtyIssued - parsed : null;

  return (
    <li className="border border-[--color-terrazzo] p-3">
      <p className="font-medium">{shooter}</p>
      <p className="text-sm text-[--color-sight-ink]">
        {issue.qtyIssued} rounds issued
      </p>

      <div className="mt-2 flex items-end gap-2">
        <label className="flex-1 space-y-1">
          <span className="block text-sm font-medium">Fired</span>
          <input
            value={fired}
            onChange={(event) => setFired(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            className="w-full border border-[--color-reticle-black] px-3 py-2 text-lg"
          />
        </label>

        <p className="flex-1 pb-2 text-sm text-[--color-sight-ink]">
          {returned === null
            ? "Returned: —"
            : returned < 0
              ? `That is more than were issued.`
              : `Returned: ${returned}`}
        </p>

        <button
          type="button"
          disabled={busy || !usable || (returned ?? -1) < 0}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                setError(
                  await onReconcile({
                    issue,
                    qtyFired: parsed,
                    qtyReturned: returned ?? 0,
                  }),
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
          className="shrink-0 border border-[--color-reticle-black] px-4 py-2 font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
        >
          Record
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium">
          {error}
        </p>
      )}
    </li>
  );
}
