"use client";

import type { ArrivalRow, ArrivalStatus } from "@/offline/today";

/**
 * THE TODAY SCREEN — §6.4.
 *
 *   "The default and dominant screen. Expected arrivals in time order: name,
 *    photograph, tier or host, discipline, and ONE status indicator — clear,
 *    attention, blocked. Renders in under one second from cold, with no network.
 *    Status distinguishable by shape and position as well as colour."
 *
 * Renders and nothing else. Every status on screen was decided by
 * src/offline/today.ts, which decided it by calling the same capability service the
 * server calls (§4). There is no condition in this file.
 *
 * ===========================================================================
 * SHAPE AND POSITION, NOT JUST COLOUR
 *
 * The last sentence of §6.4 is an accessibility requirement and also a daylight
 * requirement — this is a tablet on a range floor, often angled, often in sun. Each
 * state is carried three ways:
 *
 *   · a glyph        (✓ · ! · ✕) — survives greyscale and colour-blindness
 *   · a border weight (2px · 4px · 8px on the leading edge) — survives glare
 *   · a colour                    — the fastest read when conditions allow
 *
 * Any one of the three is sufficient to tell the states apart, which is the actual
 * test: photograph the screen in black and white and it still reads.
 */

const GLYPH: Record<ArrivalStatus, string> = {
  clear: "✓",
  attention: "!",
  blocked: "✕",
};

const EDGE: Record<ArrivalStatus, string> = {
  clear: "border-l-2 border-[--color-vip-teal]",
  attention: "border-l-4 border-[--color-deck-oak]",
  blocked: "border-l-8 border-[--color-ten-ring-deep]",
};

/** What each state means, for a screen reader. Never a colour name. */
const LABEL: Record<ArrivalStatus, string> = {
  clear: "Clear",
  attention: "Needs attention",
  blocked: "Blocked",
};

export function Today({
  rows,
  canRunSession,
  onCheckIn,
  onOpen,
  onIssue,
  onSignWaiver,
}: {
  rows: readonly ArrivalRow[];
  canRunSession: boolean;
  onCheckIn: (personId: string) => void;
  /** §6.4: open Person detail. Never on the path to a check-in. */
  onOpen: (personId: string) => void;
  /** §6.4's Issue equipment. Only reachable once somebody is on the premises. */
  onIssue: (personId: string) => void;
  /** §3.1's waiver, taken at the desk. Offered only where it clears the row. */
  onSignWaiver: (personId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="p-4 text-[--color-sight-ink]">
        Nothing is expected today on this device&rsquo;s information.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[--color-terrazzo]">
      {rows.map((row) => (
        <li
          key={`${row.personId}-${row.time}`}
          className={`flex items-center gap-3 px-4 py-3 ${EDGE[row.status]} ${
            row.checkedIn ? "opacity-60" : ""
          }`}
        >
          <span
            aria-hidden
            className="w-5 shrink-0 font-mono text-lg leading-none"
          >
            {GLYPH[row.status]}
          </span>
          <span className="sr-only">{LABEL[row.status]}.</span>

          {/**
           * §6.4 asks for a photograph. §2 makes it "a signed, expiring URL", which
           * means it is not available offline unless it was fetched while online —
           * so the initials are the offline state rather than a placeholder for a
           * missing image. An officer recognising a member by name is the normal
           * case; the photograph is for the one they do not.
           */}
          {row.photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a signed,
               expiring URL from object storage; next/image would proxy and cache it,
               which is the one thing §10 does not want done with a member's face. */
            <img
              src={row.photoUrl}
              alt=""
              className="size-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[--color-terrazzo] text-sm font-medium"
            >
              {row.name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
          )}

          {/**
           * The name opens Person detail (§6.4).
           *
           * Deliberately a separate control from "Check in" rather than a tap on
           * the row: §6.4 budgets "three taps maximum from Today to checked in",
           * and a row that opened a panel would spend one of them on a screen the
           * officer did not ask for. The common case — a clear row, checked in
           * without looking at anything — must not pass through here.
           */}
          <button
            type="button"
            onClick={() => onOpen(row.personId)}
            className="min-w-0 flex-1 text-left"
            aria-label={`Open detail for ${row.name}`}
          >
            <span className="block truncate font-medium underline decoration-[--color-terrazzo] underline-offset-4">
              {row.name}
            </span>
            <span className="block truncate text-sm text-[--color-sight-ink]">
              {row.subtitle} · {row.purpose} · {row.time}
            </span>
            {/* The one line. §4.3 forbids a stack of conditions, so there is room
                for exactly this. */}
            {row.line && (
              <span className="mt-1 block text-sm font-medium">{row.line}</span>
            )}
          </button>

          {row.checkedIn ? (
            /**
             * §6.4: "Issue equipment — firearm by serial and ammunition by
             * quantity, written as custody and ammunition rows AGAINST THE
             * PARTICIPATION."
             *
             * Against the participation is why this appears only once they are
             * checked in: there is no participation to write against before
             * that, and §3.3 makes the column NOT NULL. An issue button on a
             * row that has not arrived would be a button that cannot work.
             */
            <button
              type="button"
              onClick={() => onIssue(row.personId)}
              className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
            >
              Issue
            </button>
          ) : row.needsWaiver ? (
            /**
             * §3.1's waiver, and the one action that changes a `blocked` row.
             *
             * A waiver block is not overridable — reasons.ts: "the waiver is the
             * club's legal position if someone is injured on a live range" — so
             * the check-in button below is disabled for these rows and always
             * was. Until this existed the row was a dead end: an unwaivable block
             * whose stated remedy is "at the desk when you arrive", on a desk
             * that could not take one.
             *
             * It replaces the check-in button rather than sitting beside it,
             * because there is exactly one thing to do here and a disabled
             * control next to an enabled one is a question the officer has to
             * answer at the busiest moment of the evening. Signing re-evaluates
             * the row (§12.1's mechanism), and the check-in button comes back by
             * itself.
             */
            <button
              type="button"
              onClick={() => onSignWaiver(row.personId)}
              disabled={!canRunSession}
              className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
            >
              Sign waiver
            </button>
          ) : (
            /**
             * §6.4: "Three taps maximum from Today to checked in with a lane
             * assigned." This is tap one.
             *
             * Disabled when the pack is too old to work from (§8.1) or when the
             * block is not overridable (§4.3) — an officer may let an `attention`
             * row through with a recorded reason, and may not waive a `blocked` one.
             */
            <button
              type="button"
              onClick={() => onCheckIn(row.personId)}
              disabled={!canRunSession || row.status === "blocked"}
              className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium disabled:border-[--color-sight-grey] disabled:text-[--color-sight-grey]"
            >
              {row.status === "attention" ? "Check in anyway" : "Check in"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
