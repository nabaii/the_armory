import { PRACTICE_ROUND_REQUIRED, type ScoringMode } from "@/content/tournament";

/**
 * TOURNAMENT ENGINE — turn-taking, live totals, and the winner.
 *
 * ===========================================================================
 * TURN-TAKING IS THE MECHANIC
 *
 * §2: "Simultaneous shooting is four people in four lanes doing a private thing
 * beside each other. Turn-taking makes it a spectacle. Everyone watches every
 * shot. Between turns a player is not idle — they are an audience, and the
 * audience is where the banter, the pressure and the drama live."
 *
 * The whole engine exists to produce one thing: "the shot that matters.
 * Someone stands up needing a specific score to win, with three friends
 * watching and a live total on a screen."
 *
 * ===========================================================================
 * EVENT-SOURCED, AND WHY
 *
 * State is DERIVED from an ordered list of completed turns. Nothing is mutated.
 *
 * That is what delivers §5's "simple recovery — a mis-entered score must be
 * correctable without restarting the tournament". A correction is an edit to one
 * entry in the list followed by a recompute; there is no accumulated total to
 * unwind and no way for the screen to drift out of step with the record.
 *
 * It also makes the engine trivially offline-capable (§5: "runs offline"),
 * because replaying a handful of turns costs nothing and needs no server.
 * ===========================================================================
 */

export type TournamentPlayer = {
  id: string;
  /** §5: "No personal data beyond first names or chosen display names." */
  displayName: string;
  teamId: string;
};

export type TournamentTeam = { id: string; name: string };

export type TournamentConfig = {
  teams: readonly TournamentTeam[];
  players: readonly TournamentPlayer[];
  roundCount: number;
  shotsPerTurn: number;
  scoring: ScoringMode;
};

/** One completed turn: a player's total for their shots that round. */
export type Turn = {
  /** 0 = the practice round. Scored rounds are 1-based. */
  round: number;
  playerId: string;
  /** Null for the practice round, which is deliberately unscored. */
  score: number | null;
};

/* ---------------------------------------------------------------------------
   TURN ORDER

   Alternating teams rather than all of team A then all of team B.

   Not cosmetic: the spec's entire argument is that the audience creates the
   drama, and a block order means one team sits through four turns with nothing
   at stake before their first shot. Alternating keeps the lead changing hands
   and keeps everyone watching, which is what "the shot that matters" requires.

   Deterministic, so the screen and the record always agree on who is up.
   -------------------------------------------------------------------------- */

export function turnOrder(config: TournamentConfig): TournamentPlayer[] {
  const byTeam = config.teams.map((team) =>
    config.players.filter((p) => p.teamId === team.id),
  );

  const order: TournamentPlayer[] = [];
  const deepest = Math.max(0, ...byTeam.map((t) => t.length));

  for (let slot = 0; slot < deepest; slot += 1) {
    for (const team of byTeam) {
      const player = team[slot];
      if (player) order.push(player);
    }
  }
  return order;
}

/* ---------------------------------------------------------------------------
   STATE
   -------------------------------------------------------------------------- */

export type Phase = "practice" | "playing" | "complete";

export type TeamStanding = {
  teamId: string;
  name: string;
  /** Gross total across all scored rounds. §1: "Gross, live". */
  total: number;
  /** Rounds this team has won outright. */
  roundsWon: number;
};

export type TournamentState = {
  phase: Phase;
  /** 0 during practice; 1-based once scoring starts. */
  currentRound: number;
  /** Null when complete. §5: the screen must answer "who is up" at a glance. */
  currentPlayer: TournamentPlayer | null;
  /** Shots left in this round across all players. §5: "shots remaining". */
  shotsRemainingInRound: number;
  /** Shots left in the whole tournament. */
  shotsRemainingOverall: number;
  standings: TeamStanding[];
  /** §5: "Last shot value — briefly emphasised after each shot." */
  lastTurn: (Turn & { displayName: string }) | null;
  /** Set only when complete. Null means a draw. */
  winner: TeamStanding | null;
  isDraw: boolean;
};

export function computeState(
  config: TournamentConfig,
  turns: readonly Turn[],
): TournamentState {
  const order = turnOrder(config);
  const playersById = new Map(config.players.map((p) => [p.id, p]));

  /* ---- Practice round. §4 HARD RULE: unscored, and it happens first. ---- */
  const practiceTurns = turns.filter((t) => t.round === 0);
  const practiceComplete =
    !PRACTICE_ROUND_REQUIRED || practiceTurns.length >= order.length;

  if (!practiceComplete) {
    return {
      phase: "practice",
      currentRound: 0,
      currentPlayer: order[practiceTurns.length] ?? null,
      shotsRemainingInRound:
        (order.length - practiceTurns.length) * config.shotsPerTurn,
      shotsRemainingOverall:
        (order.length - practiceTurns.length) * config.shotsPerTurn +
        order.length * config.roundCount * config.shotsPerTurn,
      standings: emptyStandings(config),
      lastTurn: null,
      winner: null,
      isDraw: false,
    };
  }

  /* ---- Scored rounds -------------------------------------------------- */
  const scored = turns.filter((t) => t.round >= 1);
  const standings = tally(config, scored);

  /* Sudden death ends the moment a round is won outright. */
  const decided =
    config.scoring === "sudden-death"
      ? firstDecisiveRound(config, scored)
      : null;

  const completedRounds = countCompletedRounds(config, scored, order.length);
  const allRoundsDone = completedRounds >= config.roundCount;
  const finished = decided !== null || allRoundsDone;

  const roundsPlayed = decided ?? completedRounds;
  const turnsThisRound = scored.filter((t) => t.round === roundsPlayed + 1).length;

  const last = scored.at(-1) ?? null;

  const remainingRounds = Math.max(0, config.roundCount - roundsPlayed);
  const shotsRemainingOverall = finished
    ? 0
    : (remainingRounds * order.length - turnsThisRound) * config.shotsPerTurn;

  return {
    phase: finished ? "complete" : "playing",
    currentRound: finished ? roundsPlayed : roundsPlayed + 1,
    currentPlayer: finished ? null : (order[turnsThisRound] ?? null),
    shotsRemainingInRound: finished
      ? 0
      : (order.length - turnsThisRound) * config.shotsPerTurn,
    shotsRemainingOverall,
    standings,
    lastTurn: last
      ? { ...last, displayName: playersById.get(last.playerId)?.displayName ?? "" }
      : null,
    winner: finished ? decideWinner(standings, config.scoring) : null,
    isDraw: finished && decideWinner(standings, config.scoring) === null,
  };
}

const emptyStandings = (config: TournamentConfig): TeamStanding[] =>
  config.teams.map((t) => ({ teamId: t.id, name: t.name, total: 0, roundsWon: 0 }));

/** Gross totals and rounds won. */
function tally(
  config: TournamentConfig,
  scored: readonly Turn[],
): TeamStanding[] {
  const teamOf = new Map(config.players.map((p) => [p.id, p.teamId]));
  const standings = emptyStandings(config);
  const byId = new Map(standings.map((s) => [s.teamId, s]));

  for (const turn of scored) {
    const teamId = teamOf.get(turn.playerId);
    const standing = teamId ? byId.get(teamId) : undefined;
    if (standing && turn.score !== null) standing.total += turn.score;
  }

  /* Rounds won, counted only for rounds every player has completed — a
     part-played round has no winner yet. */
  const perTeamPerRound = roundTotals(config, scored);
  for (const [, totals] of perTeamPerRound) {
    const best = Math.max(...totals.values());
    const leaders = [...totals.entries()].filter(([, v]) => v === best);
    /* A tied round is won by nobody. Awarding it to both would let a team
       "win" more rounds than were played. */
    if (leaders.length === 1) {
      const standing = byId.get(leaders[0][0]);
      if (standing) standing.roundsWon += 1;
    }
  }

  return standings;
}

/** round → (teamId → total), for complete rounds only. */
function roundTotals(
  config: TournamentConfig,
  scored: readonly Turn[],
): Map<number, Map<string, number>> {
  const teamOf = new Map(config.players.map((p) => [p.id, p.teamId]));
  const playerCount = config.players.length;
  const out = new Map<number, Map<string, number>>();

  const rounds = new Set(scored.map((t) => t.round));
  for (const round of rounds) {
    const inRound = scored.filter((t) => t.round === round);
    if (inRound.length < playerCount) continue; // still in progress

    const totals = new Map<string, number>(config.teams.map((t) => [t.id, 0]));
    for (const turn of inRound) {
      const teamId = teamOf.get(turn.playerId);
      if (teamId && turn.score !== null) {
        totals.set(teamId, (totals.get(teamId) ?? 0) + turn.score);
      }
    }
    out.set(round, totals);
  }
  return out;
}

/** How many rounds every player has finished. */
function countCompletedRounds(
  config: TournamentConfig,
  scored: readonly Turn[],
  playersPerRound: number,
): number {
  let complete = 0;
  for (let round = 1; round <= config.roundCount; round += 1) {
    if (scored.filter((t) => t.round === round).length >= playersPerRound) {
      complete += 1;
    } else {
      break;
    }
  }
  return complete;
}

/** Sudden death: the first complete round with an outright winner. */
function firstDecisiveRound(
  config: TournamentConfig,
  scored: readonly Turn[],
): number | null {
  const totals = roundTotals(config, scored);
  for (let round = 1; round <= config.roundCount; round += 1) {
    const t = totals.get(round);
    if (!t) continue;
    const best = Math.max(...t.values());
    if ([...t.values()].filter((v) => v === best).length === 1) return round;
  }
  return null;
}

/**
 * The winner.
 *
 * `rounds-won` is the literal reading of §4's "best of three rounds", with the
 * gross total as the tiebreak — which is also the number the live screen shows
 * largest, so a tie-break never looks arbitrary to the room.
 *
 * SETTLED by the founder: best of three rounds. §1's "gross, live" describes
 * what the screen shows throughout; §4's "best of three rounds" decides the
 * result. Both figures are computed and both are displayed — the aggregate is
 * the live drama, the rounds won are the outcome.
 */
function decideWinner(
  standings: readonly TeamStanding[],
  scoring: ScoringMode,
): TeamStanding | null {
  const ranked = [...standings].sort(
    (a, b) => b.roundsWon - a.roundsWon || b.total - a.total,
  );
  const [first, second] = ranked;
  if (!first) return null;
  if (!second) return first;

  const tied =
    first.roundsWon === second.roundsWon && first.total === second.total;
  if (tied) return null;

  /* Sudden death cannot end tied — the round that decided it had an outright
     winner by construction. */
  if (scoring === "sudden-death") return first;
  return first;
}

/* ---------------------------------------------------------------------------
   RECOVERY — §5: "A mis-entered score must be correctable without restarting."

   Returns a NEW turn list. The caller recomputes state from it, so a correction
   can never leave the screen and the record disagreeing.
   -------------------------------------------------------------------------- */

export function correctTurn(
  turns: readonly Turn[],
  { round, playerId, score }: { round: number; playerId: string; score: number },
): Turn[] {
  return turns.map((t) =>
    t.round === round && t.playerId === playerId ? { ...t, score } : t,
  );
}

/** Undo the most recent turn — the other half of "simple recovery". */
export function undoLastTurn(turns: readonly Turn[]): Turn[] {
  return turns.slice(0, -1);
}

/* ---------------------------------------------------------------------------
   VALIDATION
   -------------------------------------------------------------------------- */

export function validateTurn(
  config: TournamentConfig,
  turns: readonly Turn[],
  turn: Turn,
  maxScorePerTurn: number,
): { ok: true } | { ok: false; reason: string } {
  const state = computeState(config, turns);

  if (state.phase === "complete") {
    return { ok: false, reason: "the tournament is already decided" };
  }
  if (state.currentPlayer?.id !== turn.playerId) {
    /* Turn order is the mechanic; accepting out-of-order turns would quietly
       dissolve it and desynchronise the screen from the line. */
    return {
      ok: false,
      reason: `it is ${state.currentPlayer?.displayName ?? "nobody"}'s turn`,
    };
  }
  if (turn.round === 0 && turn.score !== null) {
    return { ok: false, reason: "the practice round is not scored" };
  }
  if (turn.round >= 1) {
    if (turn.score === null || !Number.isInteger(turn.score)) {
      return { ok: false, reason: "a scored turn needs a whole number" };
    }
    if (turn.score < 0 || turn.score > maxScorePerTurn) {
      /* Rejected, never clamped — the same rule as league ingestion, and for
         the same reason: a clamped score is a wrong score that looks right. */
      return { ok: false, reason: `outside 0–${maxScorePerTurn}` };
    }
  }
  return { ok: true };
}
