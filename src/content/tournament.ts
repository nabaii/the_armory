/**
 * TOURNAMENT FORMATS — Leagues Specification §4.
 *
 * ===========================================================================
 * NAMED FORMATS SELL; CONFIGURATION OPTIONS DO NOT
 *
 * §4: "A group asks for 'the Shootout', not 'a best-of-three with two teams of
 * two.' Three presets, with custom underneath."
 *
 * And the design rule behind that: "Full configurability is right for autonomy
 * and wrong for a first-timer. A group who have never shot cannot meaningfully
 * choose between formats, and choice paralysis at the start kills momentum."
 *
 * So the presets are the product and `custom` is the escape hatch, not the
 * other way round.
 * ===========================================================================
 */

export type ScoringMode =
  /**
   * Rounds are won individually; the team winning most rounds wins.
   * The literal reading of "best of three rounds" (§4).
   */
  | "rounds-won"
  /** Play continues until a round is won outright. The Decider. */
  | "sudden-death";

export type TournamentFormat = {
  id: string;
  /** The name a group asks for. */
  name: string;
  /** "2 v 2, best of three rounds" */
  shape: string;
  teamCount: number;
  playersPerTeam: number;
  /** Total players. Derived, but stated because §4 tabulates it. */
  players: number;
  roundCount: number;
  /** Shots each player takes per turn. */
  shotsPerTurn: number;
  scoring: ScoringMode;
  /** Indicative, for the booking page. §4 gives these. */
  durationMinutes: number;
};

/**
 * Shots per turn is not given in §4 — the spec fixes formats, players, rounds
 * and duration but leaves the shot count open. Five is chosen to fit the stated
 * durations and registered as an open item for Operations rather than presented
 * as settled.
 */
const SHOTS_PER_TURN = 5;

export const tournamentFormats: readonly TournamentFormat[] = [
  {
    id: "duel",
    name: "The Duel",
    shape: "2 v 2, best of three rounds",
    teamCount: 2,
    playersPerTeam: 2,
    players: 4,
    roundCount: 3,
    shotsPerTurn: SHOTS_PER_TURN,
    scoring: "rounds-won",
    durationMinutes: 45,
  },
  {
    id: "shootout",
    name: "The Shootout",
    shape: "4 v 4, best of four rounds",
    teamCount: 2,
    playersPerTeam: 4,
    players: 8,
    roundCount: 4,
    shotsPerTurn: SHOTS_PER_TURN,
    scoring: "rounds-won",
    durationMinutes: 90,
  },
  {
    id: "decider",
    name: "The Decider",
    shape: "Head-to-head, sudden death",
    teamCount: 2,
    playersPerTeam: 1,
    players: 2,
    /* Sudden death: a cap so a session cannot run indefinitely, but the
       tournament ends the moment a round is won outright. */
    roundCount: 5,
    shotsPerTurn: SHOTS_PER_TURN,
    scoring: "sudden-death",
    durationMinutes: 20,
  },
];

export const findFormat = (id: string): TournamentFormat | undefined =>
  tournamentFormats.find((f) => f.id === id);

/**
 * Custom limits. §9 lists "custom format limits — maximum players, rounds and
 * shots per round, to keep sessions within a bookable slot" as an OPEN ITEM.
 *
 * These are provisional bounds that keep a session inside a bookable slot, and
 * they are registered in the content gate as outstanding from Operations.
 */
export const CUSTOM_LIMITS = {
  minPlayers: 2,
  maxPlayers: 12,
  minRounds: 1,
  maxRounds: 6,
  minShotsPerTurn: 3,
  maxShotsPerTurn: 10,
} as const;

/* ---------------------------------------------------------------------------
   THE PRACTICE ROUND — §4, HARD RULE.

   "Never let a first-timer shoot a scored round first. Public failure at the
   first attempt is the fastest way to lose someone. The unscored practice round
   is not optional and must not be dropped when a session runs late."

   Encoded as a constant rather than a configuration flag, deliberately: a flag
   is something a range officer can switch off at 9pm when a session is running
   over, which is precisely the moment the rule exists to survive.
   -------------------------------------------------------------------------- */
export const PRACTICE_ROUND_REQUIRED = true;
