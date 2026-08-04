import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ============================================================================
   PHASE 2 SCHEMA — Leagues and member accounts.

   ===========================================================================
   THE RULE THAT SHAPES THIS ENTIRE FILE

   Design Spec §7, Phase 2 note: "League standings must use display names and
   omit timestamps, so the product does not become a public attendance log."

   And the Brief on why: the site's data is "effectively a list of wealthy Abuja
   residents and where they will be, and when. That is an attractive target."

   Phase 2 makes that worse, not better — we now hold a RECURRING schedule. A
   member who plays Thursday 6pm every week is far more exposed than one who
   booked a single visit.

   So the constraint is structural rather than a view concern:

     · Anything publicly reachable references a ROUND SEQUENCE within a season,
       never a wall-clock time. `rounds` deliberately has no `playedAt`.
     · Wall-clock attendance lives in ONE table — `attendance` — which nothing
       public reads, and which has its own retention.
     · Public identity is `members.displayName`. Real names and emails are never
       joined into a standings query.

   Written this way, a careless `SELECT *` on the standings path cannot leak a
   schedule, because the column does not exist on that table.
   ===========================================================================
   ========================================================================= */

/* ---------------------------------------------------------------------------
   MEMBERS

   The CRM remains the source of truth for membership status and for personal
   data (see src/server/crm.ts — the no-database decision in Phase 1). This
   table holds the MINIMUM the product needs to run a league, plus a reference
   back to the CRM record. We are not rebuilding the CRM here.
   -------------------------------------------------------------------------- */

export const memberStatus = pgEnum("member_status", [
  /* Plays and pays per visit. Can join a league; cannot captain one, hold a
     ladder position, or play beyond the season cap. */
  "non_member",
  /* Full membership. The club. */
  "member",
  /* Founding cohort — permanently and visibly distinguished. */
  "founding_member",
  /* Was a member, lapsed. Retains history, loses privileges. */
  "lapsed",
]);

export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /* Sign-in identity. Lowercased before write — see normaliseEmail(). */
    email: text("email").notNull(),

    /**
     * The ONLY name that may appear on a public or shared surface.
     *
     * Spec §7 requires display names in standings. Members choose this; it is
     * not derived from their real name, so a member can appear on a ladder
     * without being identifiable to other players.
     */
    displayName: text("display_name").notNull(),

    /**
     * Real name. Present because staff need it operationally, and deliberately
     * NEVER selected by any standings or league query. If you find yourself
     * joining this column into a leaderboard, stop.
     */
    fullName: text("full_name"),

    status: memberStatus("status").notNull().default("non_member"),

    /** Reference to the CRM record. The CRM holds phone, address, history. */
    crmContactId: text("crm_contact_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** Soft delete for NDPA erasure — see anonymiseMember(). */
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("members_email_key").on(t.email),
    /* Display names are shown together on a ladder, so collisions are confusing
       rather than dangerous. Unique keeps standings unambiguous. */
    uniqueIndex("members_display_name_key").on(t.displayName),
  ],
);

/* ---------------------------------------------------------------------------
   AUTH — passwordless email link.

   Chosen so there are no password hashes to leak for a named list of wealthy
   individuals, no reset flow to attack, and no credential reuse.

   TOKENS ARE STORED HASHED. The raw token exists only in the email. A dump of
   this table therefore grants nobody a session — which is the entire point of
   hashing something that is functionally a bearer credential.
   -------------------------------------------------------------------------- */

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** SHA-256 of the raw token. The raw value is never persisted. */
    tokenHash: text("token_hash").notNull(),

    /**
     * Requested email, stored separately from `members` so a sign-in attempt
     * for an address that has no account leaves no member row behind — and so
     * the response can be identical either way (no account enumeration).
     */
    email: text("email").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Single use. Set on redemption; a second attempt must fail. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_key").on(t.tokenHash),
    index("auth_tokens_email_idx").on(t.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** SHA-256 of the session secret, for the same reason as above. */
    tokenHash: text("token_hash").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_hash_key").on(t.tokenHash),
    index("sessions_member_idx").on(t.memberId),
  ],
);

/* ---------------------------------------------------------------------------
   SEASONS AND ROUNDS

   The unit of competition, from the Brief: "A standard, repeatable precision
   round: fixed number of shots, fixed distance, machine-scored out of a fixed
   maximum. Resist inventing something clever. The pull to return comes from
   comparability."

   ⚠ `rounds` HAS NO TIMESTAMP, DELIBERATELY.

   A round is identified by its SEQUENCE within a season — "round 4 of 12". That
   is all a standings table needs, and it is what keeps standings from becoming
   an attendance log. When a round was actually shot lives in `attendance`.
   -------------------------------------------------------------------------- */

export const seasons = pgTable("seasons", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** How many rounds make a season. Fixes the shape up front. */
  roundCount: smallint("round_count").notNull(),
  /** Air rifle only in the first version — the discipline that scores itself. */
  disciplineSlug: text("discipline_slug").notNull().default("10m-air-rifle"),
  /** Shots per round and the maximum attainable, for comparability. */
  shotsPerRound: smallint("shots_per_round").notNull(),
  maxScore: smallint("max_score").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    /** 1-based position within the season. NOT a date. */
    sequence: smallint("sequence").notNull(),
  },
  (t) => [uniqueIndex("rounds_season_sequence_key").on(t.seasonId, t.sequence)],
);

/* ---------------------------------------------------------------------------
   LEAGUES

   "Friends form a league" — so a league is a small private group, created and
   captained by a member, joined by invitation code. It is not a public listing.
   -------------------------------------------------------------------------- */

export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "restrict" }),

    /**
     * Members create and captain leagues; non-members cannot. Enforced in
     * src/server/leagues/eligibility.ts, not merely by convention.
     */
    captainId: uuid("captain_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),

    /** Invitation code. Leagues are private and joined by link, not browsed. */
    joinCode: text("join_code").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leagues_join_code_key").on(t.joinCode)],
);

export const leagueRole = pgEnum("league_role", ["captain", "player"]);

export const leaguePlayers = pgTable(
  "league_players",
  {
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    role: leagueRole("role").notNull().default("player"),

    /**
     * Membership status AT THE MOMENT OF JOINING, recorded as a historical
     * fact rather than read live from `members.status`.
     *
     * The non-member season cap depends on knowing how many seasons someone
     * played WHILE a non-member. If they later join the club, reading their
     * current status would erase that history and the cap would silently
     * mis-count. See countNonMemberSeasons().
     */
    statusAtJoin: memberStatus("status_at_join").notNull(),

    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.memberId] }),
    index("league_players_member_idx").on(t.memberId),
  ],
);

/* ---------------------------------------------------------------------------
   SCORES

   "Score integrity is the load-bearing problem. A league collapses the first
   time a member suspects a friend inflated a score."

   Three rules follow, and all three are enforced by shape:

   1. IMMUTABLE. A score row is never updated. A correction inserts a NEW row
      and points `supersedesId` at the old one, so the history is visible and
      an edit cannot be silent.
   2. PROVENANCE ON EVERY ROW. Machine, imported, or entered by a named person.
      A manually entered score is displayed as one — the trust model depends on
      the difference being obvious.
   3. AUTHORSHIP. A manual score records who entered it. "Machine-scored results
      are trusted by default"; human-entered ones are trusted because someone
      put their name to them.
   -------------------------------------------------------------------------- */

export const scoreProvenance = pgEnum("score_provenance", [
  /* Straight from the targeting system. The default, and the reason Leagues
     anchors to the air rifle range. */
  "automatic",
  /* Bulk import — the manual pilot's spreadsheet, or a system export. */
  "imported",
  /* Typed in by a named member of staff. Visibly marked in the UI. */
  "manual",
]);

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),

    /** Points scored, and the maximum attainable, so a round is comparable. */
    value: integer("value").notNull(),
    maxValue: integer("max_value").notNull(),

    provenance: scoreProvenance("provenance").notNull(),

    /** Required when provenance is `manual`. Enforced in the ingestion layer. */
    recordedById: uuid("recorded_by_id").references(() => members.id, {
      onDelete: "set null",
    }),

    /** Set on the REPLACEMENT row, pointing at the row it corrects. */
    supersedesId: uuid("supersedes_id"),

    /** Why a correction was made. Required whenever supersedesId is set. */
    correctionReason: text("correction_reason"),

    /**
     * Bookkeeping only. Never rendered on a standings surface and never used to
     * derive when a member attended — that is `attendance`, deliberately.
     */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One live score per member per round. A correction supersedes rather than
       duplicating, so this must be filtered on the active row in queries. */
    index("scores_round_idx").on(t.roundId),
    index("scores_member_idx").on(t.memberId),
  ],
);

/* ---------------------------------------------------------------------------
   ATTENDANCE — the quarantined table.

   This is the ONLY place a wall-clock time is stored against a person, and
   nothing public reads it. It exists because operations genuinely need it:
   staffing a session, reconciling a booking, confirming someone was on the line.

   It is separate from `scores` so that the standings path physically cannot
   join to a timestamp. Spec §7 asks for standings without timestamps; keeping
   the column out of reach is stronger than remembering not to select it.

   Retention is shorter than scores: a score is a permanent sporting record, an
   attendance time is operational data with no reason to outlive its purpose.
   -------------------------------------------------------------------------- */

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),

    /** The wall clock. Operational only. Never public, never in standings. */
    attendedAt: timestamp("attended_at", { withTimezone: true }).notNull(),

    /** When this row becomes eligible for deletion. Set on write. */
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("attendance_member_round_key").on(t.memberId, t.roundId),
    index("attendance_purge_idx").on(t.purgeAfter),
  ],
);

/* ---------------------------------------------------------------------------
   INGESTION AUDIT

   Every batch of scores that enters the system, whatever the adapter. Needed
   because "machine-verified" is a claim we make to members, and a claim needs
   a record — if a league result is ever disputed, this is what answers it.
   -------------------------------------------------------------------------- */

export const ingestionBatches = pgTable("ingestion_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: scoreProvenance("source").notNull(),
  roundId: uuid("round_id").references(() => rounds.id, { onDelete: "set null" }),
  /** Who ran it, for `imported` and `manual`. Null for `automatic`. */
  actorId: uuid("actor_id").references(() => members.id, { onDelete: "set null" }),
  scoresAccepted: integer("scores_accepted").notNull().default(0),
  scoresRejected: integer("scores_rejected").notNull().default(0),
  /** Rejection reasons, for the operator. No personal data. */
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type League = typeof leagues.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type LeaguePlayer = typeof leaguePlayers.$inferSelect;
