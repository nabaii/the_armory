import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  leaguePlayers,
  leagues,
  members,
  rounds,
  scores,
  seasons,
  type League,
  type Member,
  type Season,
} from "@/db/schema";
import { generateJoinCode } from "@/server/leagues/join-code";
import {
  canCaptainLeague,
  canJoinLeague,
  countNonMemberSeasons,
  type JoinEligibility,
} from "@/server/leagues/eligibility";

/**
 * LEAGUE PERSISTENCE.
 *
 * Every privilege check happens HERE, on the server, immediately before the
 * write. The UI also checks — it must, or a non-member would be shown a
 * "create a league" button that fails — but the UI check is a courtesy and
 * this one is the rule. A server action is a public endpoint; anything that
 * only guards the button guards nothing.
 */

/* ---------------------------------------------------------------------------
   SEASONS
   -------------------------------------------------------------------------- */

export async function currentSeason(): Promise<Season | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isCurrent, true))
    .limit(1);
  return row ?? null;
}

/* ---------------------------------------------------------------------------
   CREATING A LEAGUE
   -------------------------------------------------------------------------- */

export type CreateLeagueResult =
  | { ok: true; league: League }
  | { ok: false; reason: "not-a-member" | "no-season" | "code-collision" };

export async function createLeague({
  name,
  captain,
  anchorWeekday,
}: {
  name: string;
  captain: Member;
  /** Advisory night, not a deadline. See the note on `leagues.anchorWeekday`. */
  anchorWeekday: number;
}): Promise<CreateLeagueResult> {
  /* "Members can create and captain leagues." Checked here, not in the form. */
  if (!canCaptainLeague(captain.status)) return { ok: false, reason: "not-a-member" };

  const season = await currentSeason();
  if (!season) return { ok: false, reason: "no-season" };

  const db = getDb();

  /* Join codes are random, so a collision is possible though vanishingly
     unlikely (1 in ~1.07 billion per attempt). Retrying a few times is far
     cheaper than a unique-violation surfacing to a member as an error. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const joinCode = generateJoinCode();

    const [created] = await db
      .insert(leagues)
      .values({
        name,
        seasonId: season.id,
        captainId: captain.id,
        joinCode,
        anchorWeekday,
      })
      .onConflictDoNothing({ target: leagues.joinCode })
      .returning();

    if (!created) continue; // collision — try another code

    /* The captain is a player in their own league. Without this they would
       captain a league they are not in, and their scores would not count. */
    await db.insert(leaguePlayers).values({
      leagueId: created.id,
      memberId: captain.id,
      role: "captain",
      statusAtJoin: captain.status,
    });

    return { ok: true, league: created };
  }

  return { ok: false, reason: "code-collision" };
}

/* ---------------------------------------------------------------------------
   JOINING A LEAGUE
   -------------------------------------------------------------------------- */

export type JoinLeagueResult =
  | { ok: true; league: League; payPerVisit: boolean }
  | { ok: false; reason: "no-such-code" | "already-in" | "league-full" }
  | { ok: false; reason: "not-eligible"; eligibility: JoinEligibility };

/**
 * §6: "Unit — The foursome. Leagues are formed by members inviting three
 * others." And team scoring is "the best three of four scores in the foursome".
 *
 * Four is therefore structural, not a preference: best-three-of-four only means
 * anything in a group of four. It is also what gives the weakest member
 * permission to shoot badly, which §3 identifies as the point of team scoring.
 *
 * (The Tournament takes 4-8 — that is a different product, in a different
 * table. Do not reconcile the two numbers.)
 */
export const MAX_LEAGUE_PLAYERS = 4;

export async function joinLeagueByCode({
  joinCode,
  member,
}: {
  joinCode: string;
  member: Member;
}): Promise<JoinLeagueResult> {
  const db = getDb();

  const [league] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.joinCode, joinCode))
    .limit(1);

  if (!league) return { ok: false, reason: "no-such-code" };

  const existing = await db
    .select({ memberId: leaguePlayers.memberId })
    .from(leaguePlayers)
    .where(
      and(
        eq(leaguePlayers.leagueId, league.id),
        eq(leaguePlayers.memberId, member.id),
      ),
    )
    .limit(1);

  if (existing.length > 0) return { ok: false, reason: "already-in" };

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leaguePlayers)
    .where(eq(leaguePlayers.leagueId, league.id));

  if (count >= MAX_LEAGUE_PLAYERS) return { ok: false, reason: "league-full" };

  /* THE SEASON CAP.

     Derived from statusAtJoin across the member's whole history, never from
     their current status — see the note on that column. Someone who played a
     season as a non-member and has since joined the club must not be blocked
     by their own history. */
  const history = await nonMemberHistory(member.id);
  const eligibility = canJoinLeague({
    status: member.status,
    nonMemberSeasonsPlayed: countNonMemberSeasons(history),
  });

  if (!eligibility.ok) return { ok: false, reason: "not-eligible", eligibility };

  await db.insert(leaguePlayers).values({
    leagueId: league.id,
    memberId: member.id,
    role: "player",
    /* The historical fact, frozen at this moment. */
    statusAtJoin: member.status,
  });

  return { ok: true, league, payPerVisit: eligibility.payPerVisit };
}

/** Every season this member has played in, with the status they held then. */
async function nonMemberHistory(
  memberId: string,
): Promise<{ seasonId: string; statusAtJoin: Member["status"] }[]> {
  const db = getDb();
  return db
    .select({
      seasonId: leagues.seasonId,
      statusAtJoin: leaguePlayers.statusAtJoin,
    })
    .from(leaguePlayers)
    .innerJoin(leagues, eq(leaguePlayers.leagueId, leagues.id))
    .where(eq(leaguePlayers.memberId, memberId));
}

/* ---------------------------------------------------------------------------
   READING

   Note what these SELECT: `members.displayName`, never `fullName` and never
   `email`. Spec §7 requires standings to use display names, and the safest way
   to honour that is for the query that feeds them to be incapable of returning
   anything else.
   -------------------------------------------------------------------------- */

export type LeagueSummary = {
  league: League;
  season: Season;
  playerCount: number;
  roundsPlayed: number;
};

export async function leaguesForMember(memberId: string): Promise<LeagueSummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      league: leagues,
      season: seasons,
      playerCount: sql<number>`(
        select count(*)::int from ${leaguePlayers}
        where ${leaguePlayers.leagueId} = ${leagues.id}
      )`,
      /* Rounds this league has actually shot: distinct rounds with any score
         from one of its players. A league that misses a week is behind, and
         this is what makes that visible. */
      roundsPlayed: sql<number>`(
        select count(distinct ${scores.roundId})::int
        from ${scores}
        join ${leaguePlayers} lp on lp.member_id = ${scores.memberId}
        where lp.league_id = ${leagues.id}
      )`,
    })
    .from(leaguePlayers)
    .innerJoin(leagues, eq(leaguePlayers.leagueId, leagues.id))
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(leaguePlayers.memberId, memberId))
    .orderBy(desc(leagues.createdAt));

  return rows;
}

export type LeaguePlayerView = {
  memberId: string;
  /** The only name that leaves this query. */
  displayName: string;
  role: "captain" | "player";
};

/**
 * A league's players.
 *
 * Scoped by membership: the caller must already be in the league. A league is
 * private, and its roster is not a public fact — the layout guard proves who
 * you are, and this proves you belong here.
 */
export async function leagueWithPlayers({
  leagueId,
  viewerId,
}: {
  leagueId: string;
  viewerId: string;
}): Promise<{ league: League; season: Season; players: LeaguePlayerView[] } | null> {
  const db = getDb();

  const [viewer] = await db
    .select({ memberId: leaguePlayers.memberId })
    .from(leaguePlayers)
    .where(
      and(eq(leaguePlayers.leagueId, leagueId), eq(leaguePlayers.memberId, viewerId)),
    )
    .limit(1);

  /* Not a player here. Indistinguishable from "no such league", so this cannot
     be used to discover which league ids exist. */
  if (!viewer) return null;

  const [row] = await db
    .select({ league: leagues, season: seasons })
    .from(leagues)
    .innerJoin(seasons, eq(leagues.seasonId, seasons.id))
    .where(eq(leagues.id, leagueId))
    .limit(1);

  if (!row) return null;

  const players = await db
    .select({
      memberId: leaguePlayers.memberId,
      displayName: members.displayName,
      role: leaguePlayers.role,
    })
    .from(leaguePlayers)
    .innerJoin(members, eq(leaguePlayers.memberId, members.id))
    .where(eq(leaguePlayers.leagueId, leagueId))
    .orderBy(desc(leaguePlayers.role));

  return { league: row.league, season: row.season, players };
}

/** Rounds this league has shot, for the fixture calculation. */
export async function roundsPlayedByLeague(leagueId: string): Promise<number> {
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(distinct ${scores.roundId})::int` })
    .from(scores)
    .innerJoin(leaguePlayers, eq(leaguePlayers.memberId, scores.memberId))
    .innerJoin(rounds, eq(rounds.id, scores.roundId))
    .where(eq(leaguePlayers.leagueId, leagueId));
  return count ?? 0;
}
