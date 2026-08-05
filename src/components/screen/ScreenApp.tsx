"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { LiveScreen } from "@/components/screen/LiveScreen";
import {
  clearSession,
  getServerSnapshot,
  getSnapshot,
  saveSession,
  subscribe,
  type ScreenSession,
} from "@/lib/screen-store";
import {
  computeState,
  correctTurn,
  undoLastTurn,
  validateTurn,
  type TournamentConfig,
  type Turn,
} from "@/server/tournament/engine";
import { findFormat, tournamentFormats } from "@/content/tournament";

/**
 * THE LIVE SCREEN APPLICATION.
 *
 * One page, two modes:
 *   · `display` — what the room sees. The default.
 *   · `control` — the range officer's entry panel (§5 Path B).
 *
 * Both read the same local session, so a laptop driving a television over HDMI
 * can run the display full-screen on the TV and the control panel in a second
 * tab, kept in step by BroadcastChannel. Nothing here touches the network:
 * §5 requires the screen to run offline.
 *
 * PATH A / PATH B. §5: "Build the screen to accept either input source. The
 * interface is identical; only the input differs." `submitTurn` is that seam —
 * an automatic feed calls the same function the operator's keypad does, so the
 * targeting system's export capability never blocks this build.
 */

const MAX_SCORE_PER_TURN_MULTIPLIER = 10; // a 10-ring air rifle target

export function ScreenApp() {
  /* `useSyncExternalStore` rather than reading storage in an effect: it handles
     the hydration boundary properly and avoids the render-then-correct flash an
     effect would produce on a screen a room is watching. It also recovers the
     tournament after a reload, a crash or an accidental tab close — which, with
     eight people watching and four rounds played, has to be a reload rather
     than a restart. */
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [mode, setMode] = useState<"display" | "control">("display");
  const [error, setError] = useState<string | null>(null);

  /* Writes go to the store; the subscription brings them back. One direction,
     so the display tab and the control tab cannot disagree. */
  const commit = useCallback((next: ScreenSession | null) => {
    if (next) saveSession(next);
    else clearSession();
  }, []);

  const state = useMemo(
    () => (session ? computeState(session.config, session.turns) : null),
    [session],
  );

  const maxPerTurn = session
    ? session.config.shotsPerTurn * MAX_SCORE_PER_TURN_MULTIPLIER
    : 0;

  /** The Path A / Path B seam. */
  const submitTurn = useCallback(
    (score: number | null) => {
      if (!session || !state?.currentPlayer) return;
      const turn: Turn = {
        round: state.currentRound,
        playerId: state.currentPlayer.id,
        score,
      };
      const check = validateTurn(session.config, session.turns, turn, maxPerTurn);
      if (!check.ok) {
        setError(check.reason);
        return;
      }
      setError(null);
      commit({
        ...session,
        turns: [...session.turns, turn],
        revision: session.revision + 1,
      });
    },
    [session, state, maxPerTurn, commit],
  );

  if (!session || !state) {
    return <SetUp onStart={(s) => commit(s)} />;
  }

  return (
    <>
      {mode === "display" ? (
        <LiveScreen state={state} />
      ) : (
        <ControlPanel
          session={session}
          state={state}
          error={error}
          maxPerTurn={maxPerTurn}
          onSubmit={submitTurn}
          onUndo={() =>
            commit({
              ...session,
              turns: undoLastTurn(session.turns),
              revision: session.revision + 1,
            })
          }
          onCorrect={(round, playerId, score) =>
            commit({
              ...session,
              turns: correctTurn(session.turns, { round, playerId, score }),
              revision: session.revision + 1,
            })
          }
          onEnd={() => commit(null)}
        />
      )}

      {/* Bottom CENTRE, not bottom-right.

          Measured on a 1920x1080 display: at bottom-right this button sat on
          top of the last-shot score, which is the one element §5 says to
          emphasise after every shot — and the screen gets photographed. The
          bottom band is occupied on both sides (now shooting, last shot) and
          empty in the middle.

          Deliberately small and low-contrast: it is for the operator and must
          not compete with the scores. */}
      <button
        type="button"
        onClick={() => setMode((m) => (m === "display" ? "control" : "display"))}
        className={cn(
          "fixed bottom-1 left-1/2 -translate-x-1/2",
          "rounded-control border border-sight-grey/30 px-2 py-1",
          "text-caption text-terrazzo/50",
          "transition-opacity duration-[var(--duration-fast)]",
          "hover:text-terrazzo focus-visible:text-terrazzo",
        )}
      >
        {mode === "display" ? "Control" : "Display"}
      </button>
    </>
  );
}

/* ---------------------------------------------------------------------------
   CONTROL PANEL — §5 Path B, "a range officer enters scores on a tablet after
   each turn. Entirely acceptable, adds a few seconds per turn."
   -------------------------------------------------------------------------- */

function ControlPanel({
  session,
  state,
  error,
  maxPerTurn,
  onSubmit,
  onUndo,
  onCorrect,
  onEnd,
}: {
  session: ScreenSession;
  state: ReturnType<typeof computeState>;
  error: string | null;
  maxPerTurn: number;
  onSubmit: (score: number | null) => void;
  onUndo: () => void;
  onCorrect: (round: number, playerId: string, score: number) => void;
  onEnd: () => void;
}) {
  const [value, setValue] = useState("");
  const practice = state.phase === "practice";

  return (
    <div className="min-h-dvh bg-chalk p-3 text-reticle-black">
      <p className="u-kicker text-sight-ink">
        {practice ? "Practice round — not scored" : `Round ${state.currentRound}`}
      </p>

      <h1 className="mt-1 font-display text-display font-bold leading-none">
        {state.currentPlayer?.displayName ?? "Complete"}
      </h1>

      {error && (
        <p className="mt-2 text-body font-bold text-ten-ring-deep">{error}</p>
      )}

      {state.phase !== "complete" && (
        <div className="mt-4 max-w-[30rem]">
          {practice ? (
            /* §4 HARD RULE. The practice round cannot be scored and cannot be
               skipped — the button records that they shot, nothing more. */
            <button
              type="button"
              onClick={() => onSubmit(null)}
              className="min-h-8 w-full rounded-control bg-reticle-black px-3 text-h2 font-bold text-chalk"
            >
              Shot — next player
            </button>
          ) : (
            <>
              <label htmlFor="score" className="u-kicker">
                Score out of {maxPerTurn}
              </label>
              <input
                id="score"
                type="number"
                inputMode="numeric"
                min={0}
                max={maxPerTurn}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                /* Large target: this is a tablet, held, in a busy room. */
                className="mt-1 min-h-8 w-full rounded-control border-2 border-sight-grey bg-white px-2 text-display font-bold tabular-nums"
              />
              <button
                type="button"
                onClick={() => {
                  const parsed = Number.parseInt(value, 10);
                  if (Number.isInteger(parsed)) {
                    onSubmit(parsed);
                    setValue("");
                  }
                }}
                className="mt-2 min-h-8 w-full rounded-control bg-ten-ring-deep px-3 text-h2 font-bold text-white"
              >
                Record
              </button>
            </>
          )}
        </div>
      )}

      {/* §5: "Simple recovery — a mis-entered score must be correctable without
          restarting the tournament." */}
      <div className="mt-6 border-t border-sight-grey/40 pt-3">
        <p className="u-kicker text-sight-ink">Corrections</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={session.turns.length === 0}
            className="min-h-6 rounded-control border border-sight-grey px-3 text-body font-bold disabled:opacity-50"
          >
            Undo last turn
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("End this tournament and clear the screen?")) onEnd();
            }}
            className="min-h-6 rounded-control border border-sight-grey px-3 text-body"
          >
            End tournament
          </button>
        </div>

        <ul className="mt-3 flex flex-col gap-1">
          {session.turns
            .filter((t) => t.round >= 1)
            .slice(-8)
            .reverse()
            .map((turn) => {
              const player = session.config.players.find((p) => p.id === turn.playerId);
              return (
                <li
                  key={`${turn.round}-${turn.playerId}`}
                  className="flex items-center gap-2 text-body"
                >
                  <span className="u-kicker w-12 text-sight-ink">R{turn.round}</span>
                  <span className="flex-1">{player?.displayName}</span>
                  <input
                    type="number"
                    defaultValue={turn.score ?? 0}
                    min={0}
                    max={maxPerTurn}
                    onBlur={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      if (Number.isInteger(parsed) && parsed !== turn.score) {
                        onCorrect(turn.round, turn.playerId, parsed);
                      }
                    }}
                    className="w-16 rounded-control border border-sight-grey px-1 py-1 text-right tabular-nums"
                  />
                </li>
              );
            })}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   SET UP — §4 flow steps 2 and 3: format chosen at check-in, teams set,
   names entered.

   Presets first, custom underneath. §4: "A group who have never shot cannot
   meaningfully choose between formats, and choice paralysis at the start kills
   momentum."
   -------------------------------------------------------------------------- */

function SetUp({ onStart }: { onStart: (session: ScreenSession) => void }) {
  const [formatId, setFormatId] = useState(tournamentFormats[0].id);
  const [names, setNames] = useState<string[]>([]);

  const format = findFormat(formatId)!;
  const slots = format.players;

  const start = () => {
    const teams = Array.from({ length: format.teamCount }, (_, i) => ({
      id: `T${i + 1}`,
      name: `Team ${String.fromCharCode(65 + i)}`,
    }));

    const players = Array.from({ length: slots }, (_, i) => ({
      id: `P${i + 1}`,
      /* §5: "No personal data beyond first names or chosen display names."
         The screen is photographed; a surname must not be on it. */
      displayName: (names[i] ?? "").trim() || `Player ${i + 1}`,
      teamId: teams[i % format.teamCount].id,
    }));

    const config: TournamentConfig = {
      teams,
      players,
      roundCount: format.roundCount,
      shotsPerTurn: format.shotsPerTurn,
      scoring: format.scoring,
    };
    onStart({ config, turns: [], revision: 1 });
  };

  return (
    <div className="min-h-dvh bg-chalk p-3 text-reticle-black">
      <p className="u-kicker text-sight-ink">Set up</p>
      <h1 className="mt-1 font-display text-h1 font-bold">Choose a format</h1>

      <div className="mt-4 flex flex-col gap-2">
        {tournamentFormats.map((f) => (
          <label
            key={f.id}
            className={cn(
              "flex cursor-pointer items-baseline gap-3 rounded-control border p-3",
              formatId === f.id
                ? "border-reticle-black bg-terrazzo"
                : "border-sight-grey",
            )}
          >
            <input
              type="radio"
              name="format"
              checked={formatId === f.id}
              onChange={() => setFormatId(f.id)}
              className="sr-only"
            />
            <span className="font-display text-h2 font-bold">{f.name}</span>
            <span className="flex-1 text-body text-sight-ink">{f.shape}</span>
            <span className="text-caption tabular-nums text-sight-ink">
              {f.players} players · ~{f.durationMinutes} min
            </span>
          </label>
        ))}
      </div>

      <p className="u-kicker mt-6 text-sight-ink">First names</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Array.from({ length: slots }, (_, i) => (
          <input
            key={i}
            aria-label={`Player ${i + 1} name`}
            placeholder={`Player ${i + 1}`}
            value={names[i] ?? ""}
            onChange={(e) => {
              const next = [...names];
              next[i] = e.target.value;
              setNames(next);
            }}
            maxLength={16}
            className="min-h-6 rounded-control border border-sight-grey bg-white px-2 text-body"
          />
        ))}
      </div>

      <button
        type="button"
        onClick={start}
        className="mt-6 min-h-8 rounded-control bg-ten-ring-deep px-4 text-h2 font-bold text-white"
      >
        Start with a practice round
      </button>

      <p className="mt-2 max-w-[46rem] text-caption text-sight-ink">
        Everyone shoots an unscored practice round before anything counts. It is
        not optional, and it is not dropped when a session runs late — a
        first-timer failing publicly on their first attempt is the fastest way to
        lose them.
      </p>
    </div>
  );
}
