"use client";

/**
 * THE SYNC BAR — §8.4, and not optional.
 *
 *   "Depth and last-sync time are visible on the desk at all times. Silent queues
 *    are how data is lost."
 *
 * So this is a permanent element of the desk chrome, not a diagnostics panel behind
 * a menu. The wording comes from src/offline/outbox/policy.ts, which distinguishes
 * "behind" from "broken" — two conditions that call for completely different
 * responses from an officer at nine in the evening, one a wait and the other a
 * phone call.
 *
 * ===========================================================================
 * WHY THE TONE IS NOT CARRIED BY COLOUR ALONE
 *
 * §6.4, about the Today screen: "Status distinguishable by shape and position as
 * well as colour."
 *
 * That requirement is written about arrival rows and it applies here for the same
 * reason. This bar is read at arm's length, in daylight, on a screen that may be
 * angled away — and one of the three states means "records are not reaching the
 * club and somebody has to act". A red dot is not enough. Each state carries a
 * distinct glyph and a distinct border weight, so the state survives glare,
 * colour-blindness and a photograph of the screen sent to the founder.
 */

export type SyncStatusView = {
  tone: "clear" | "waiting" | "attention";
  line: string;
  lastSync: string;
  depth: number;
};

/** Glyph per state. Shape, not colour. */
const GLYPH: Record<SyncStatusView["tone"], string> = {
  clear: "✓",
  waiting: "↻",
  attention: "!",
};

const TONE: Record<SyncStatusView["tone"], string> = {
  clear: "border-l-2 border-[--color-vip-teal] text-[--color-sight-ink]",
  waiting: "border-l-4 border-[--color-deck-oak] text-[--color-reticle-black]",
  attention:
    "border-l-8 border-[--color-ten-ring-deep] text-[--color-reticle-black] font-semibold",
};

export function SyncStatus({
  status,
  onRetry,
}: {
  status: SyncStatusView;
  /** Absent while a drain is already running. */
  onRetry: (() => void) | null;
}) {
  return (
    <div
      className={`flex items-center gap-3 bg-[--color-terrazzo] px-4 py-2 text-sm ${TONE[status.tone]}`}
      /* `status` rather than `alert`: this updates continuously and an assertive
         live region would interrupt a screen reader mid-check-in. */
      role="status"
      aria-live="polite"
    >
      <span aria-hidden className="font-mono text-base leading-none">
        {GLYPH[status.tone]}
      </span>

      <span className="flex-1">
        {status.line}{" "}
        <span className="text-[--color-sight-grey]">{status.lastSync}</span>
      </span>

      {/* §6.4 puts queue depth on the end-of-day screen; §8.4 wants it visible at
          all times. Shown as a number because "how many records am I waiting on"
          is the question an officer is actually asking before they lock up. */}
      {status.depth > 0 && (
        <span className="font-mono tabular-nums" aria-label={`${status.depth} waiting`}>
          {status.depth}
        </span>
      )}

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-[--color-sight-grey] px-2 py-1 text-xs uppercase tracking-wide"
        >
          Try now
        </button>
      )}
    </div>
  );
}
