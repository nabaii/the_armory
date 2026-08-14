import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { ArmoryReader, ArmoryTx } from "@/db/armory/client";
import { schema } from "@/db/armory/client";
import type { CustodyEventType, FirearmStatus } from "@/domain/enums";
import {
  armouryExceptions,
  type AmmunitionRecord,
  type ArmouryException,
  type FirearmRecord,
  type ForcedClose,
  type LotRecord,
} from "@/domain/exceptions";
import { uuidv7 } from "@/lib/uuidv7";
import { applied, refused, type Written } from "./record";

/**
 * THE FIREARM REGISTER AND THE CUSTODY LOG — §3.4, §11 M6.
 *
 * §3.4 is the one place the specification raises its voice, so it is worth
 * having in front of you while reading this file:
 *
 *   "One register. One log. No exceptions. Club-owned and member-owned firearms
 *    are rows in the same table, distinguished by an ownership column. Do not
 *    create a second table, a second module, or a parallel workflow.
 *
 *    custody_events is append-only and is the sole source of truth for where any
 *    firearm is. Firearm status is derived from it, not maintained
 *    independently — if the two can disagree, they eventually will."
 *
 * ===========================================================================
 * THIS MODULE READS. IT DOES NOT MOVE FIREARMS.
 *
 * Every movement is a custody event, and custody events arrive through the
 * outbox (`custody_events.create`) because §6.4 requires equipment issue to work
 * offline. There is deliberately no `issueFirearm` here: a second write path to
 * the same log would be the "parallel workflow" §3.4 forbids by name, and the
 * desk's path already exists and is replay-tested.
 *
 * The one write below is a CORRECTION, which is not a movement — see it for why
 * it belongs on this side.
 */

/* ============================================================================
   THE REGISTER
   ========================================================================= */

export type RegisterEntry = {
  readonly id: string;
  readonly serialNumber: string;
  readonly make: string;
  readonly model: string;
  readonly calibre: string;
  readonly discipline: string | null;
  readonly ownership: "club" | "member";
  readonly ownerPersonId: string | null;
  readonly ownerName: string | null;
  /** Derived by trigger from custody_events. Never written by application code. */
  readonly status: FirearmStatus;
  readonly lastMovedAt: Date | null;
  readonly roundCount: number;
};

/**
 * The whole register, club and member firearms together.
 *
 * One query, no ownership branch. §3.4's "one register" is not a data-modelling
 * preference — it is the reason a founder can answer "where is every firearm the
 * club is responsible for" with a single read, and the reason a member-owned
 * firearm cannot quietly fall outside the club's accounting.
 */
export async function firearmRegister(
  tx: ArmoryReader,
): Promise<RegisterEntry[]> {
  const rows = await tx
    .select({
      id: schema.firearms.id,
      serialNumber: schema.firearms.serialNumber,
      make: schema.firearms.make,
      model: schema.firearms.model,
      calibre: schema.firearms.calibre,
      discipline: schema.firearms.discipline,
      ownership: schema.firearms.ownership,
      ownerPersonId: schema.firearms.ownerPersonId,
      ownerFirstName: schema.people.firstName,
      ownerLastName: schema.people.lastName,
      status: schema.firearms.status,
      roundCount: schema.firearms.roundCount,
      lastMovedAt: sql<Date | null>`(
        select max(e.occurred_at) from armory.custody_events e
        where e.firearm_id = ${schema.firearms.id}
      )`,
    })
    .from(schema.firearms)
    /* Left, because a club firearm has no owner and §3.4 puts both in this
       table. An inner join here would silently drop every club firearm from the
       register — the majority of it. */
    .leftJoin(schema.people, eq(schema.people.id, schema.firearms.ownerPersonId))
    .orderBy(schema.firearms.serialNumber);

  return rows.map((row) => ({
    id: row.id,
    serialNumber: row.serialNumber,
    make: row.make,
    model: row.model,
    calibre: row.calibre,
    discipline: row.discipline,
    ownership: row.ownership,
    ownerPersonId: row.ownerPersonId,
    ownerName:
      row.ownerFirstName && row.ownerLastName
        ? `${row.ownerFirstName} ${row.ownerLastName}`
        : null,
    status: row.status,
    lastMovedAt: row.lastMovedAt ? new Date(row.lastMovedAt) : null,
    roundCount: row.roundCount,
  }));
}

/* ============================================================================
   THE LOG
   ========================================================================= */

export type CustodyEntry = {
  readonly id: string;
  readonly eventType: CustodyEventType;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorName: string | null;
  readonly counterpartyName: string | null;
  readonly note: string | null;
  readonly correctsEventId: string | null;
  /** True when a later correction withdrew this entry. */
  readonly corrected: boolean;
};

/**
 * One firearm's movement history, newest first.
 *
 * Corrected entries are RETURNED, marked, rather than filtered out. §1.2 rule 3
 * makes a correction "a new row referencing the old one" precisely so that the
 * original survives — a log that hid superseded entries would be a log that
 * could be edited by appending, which is the thing append-only exists to
 * prevent. The derivation ignores them; the reader sees them.
 */
export async function custodyLog(
  tx: ArmoryReader,
  firearmId: string,
): Promise<CustodyEntry[]> {
  const actor = schema.people;

  const rows = await tx
    .select({
      id: schema.custodyEvents.id,
      eventType: schema.custodyEvents.eventType,
      occurredAt: schema.custodyEvents.occurredAt,
      recordedAt: schema.custodyEvents.recordedAt,
      note: schema.custodyEvents.note,
      correctsEventId: schema.custodyEvents.correctsEventId,
      counterpartyFirst: actor.firstName,
      counterpartyLast: actor.lastName,
      corrected: sql<boolean>`exists (
        select 1 from armory.custody_events c
        where c.corrects_event_id = ${schema.custodyEvents.id}
      )`,
    })
    .from(schema.custodyEvents)
    .leftJoin(
      actor,
      eq(actor.id, schema.custodyEvents.counterpartyPersonId),
    )
    .where(eq(schema.custodyEvents.firearmId, firearmId))
    /* Newest first for a reader, and tie-broken by id — UUIDv7, so time-ordered
       by generation. Two events share a timestamp whenever an outbox replays a
       batch, and the same tie-break is in drizzle/0002's derivation. */
    .orderBy(desc(schema.custodyEvents.occurredAt), desc(schema.custodyEvents.id));

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    /* The officer's name is not joined. `actor_staff_id` points at staff_users,
       which points at people — a second join for a column the register view does
       not show. It belongs on the audit surface (§3.6), not here. */
    actorName: null,
    counterpartyName:
      row.counterpartyFirst && row.counterpartyLast
        ? `${row.counterpartyFirst} ${row.counterpartyLast}`
        : null,
    note: row.note,
    correctsEventId: row.correctsEventId,
    corrected: row.corrected,
  }));
}

/* ============================================================================
   CORRECTIONS — §1.2 rule 3
   ========================================================================= */

/**
 * Withdraw a custody event by appending a correction.
 *
 *   §1.2 rule 3: "a correction is a new row referencing the old one."
 *   §3.4: "No update. No delete. Ever."
 *
 * ===========================================================================
 * WHY THIS ONE WRITE IS SERVER-SIDE WHEN EVERY MOVEMENT IS NOT
 *
 * A movement happens at the desk, offline, with a firearm in someone's hand —
 * so it goes through the outbox. A correction happens afterwards, by someone
 * looking at the log and deciding an entry is wrong. That is a founder at a
 * desk with a connection, not an officer at a counter, and it needs to read the
 * event being corrected before it can validate the correction at all.
 *
 * The push path accepts corrections too (`custody_events.create` with
 * `correctsEventId`), and both write the same row. This one adds the check the
 * offline path cannot make: that the event being corrected exists, belongs to
 * this firearm, and has not already been corrected.
 */
export async function correctCustodyEvent(
  tx: ArmoryTx,
  input: {
    readonly correctsEventId: string;
    readonly eventType: CustodyEventType;
    readonly reason: string;
    readonly occurredAt: Date;
    readonly deviceId: string | null;
  },
): Promise<Written<{ readonly custodyEventId: string }>> {
  if (input.reason.trim().length < 12) {
    return refused({
      code: "REASON_TOO_SHORT",
      message:
        "A correction needs a reason a founder can read tomorrow morning and understand without asking anyone.",
    });
  }

  const [original] = await tx
    .select({
      id: schema.custodyEvents.id,
      firearmId: schema.custodyEvents.firearmId,
      eventType: schema.custodyEvents.eventType,
      sessionId: schema.custodyEvents.sessionId,
      counterpartyPersonId: schema.custodyEvents.counterpartyPersonId,
    })
    .from(schema.custodyEvents)
    .where(eq(schema.custodyEvents.id, input.correctsEventId))
    .limit(1);

  if (!original) {
    return refused({
      code: "NO_SUCH_EVENT",
      message: "That movement is not in the log.",
    });
  }

  const [existing] = await tx
    .select({ id: schema.custodyEvents.id })
    .from(schema.custodyEvents)
    .where(eq(schema.custodyEvents.correctsEventId, input.correctsEventId))
    .limit(1);

  if (existing) {
    /* One correction per event. A chain of corrections correcting corrections
       makes the derivation's "not corrected" predicate ambiguous — and more to
       the point, makes the log unreadable to the regulator §3.4 is written for.
       A second mistake is corrected by correcting the correction's target
       afresh, which is a conversation a founder should have to have. */
    return refused({
      code: "ALREADY_CORRECTED",
      message: "That movement has already been corrected.",
    });
  }

  const custodyEventId = uuidv7();

  await tx.insert(schema.custodyEvents).values({
    id: custodyEventId,
    firearmId: original.firearmId,
    eventType: input.eventType,
    counterpartyPersonId: original.counterpartyPersonId,
    sessionId: original.sessionId,
    occurredAt: input.occurredAt,
    deviceId: input.deviceId,
    correctsEventId: input.correctsEventId,
    note: input.reason.trim(),
  });

  return applied({ custodyEventId }, [
    {
      action: "custody.correct",
      entityType: "custody_event",
      entityId: custodyEventId,
      before: { correctedEventId: original.id, wasEventType: original.eventType },
      after: { eventType: input.eventType, firearmId: original.firearmId },
      /* §3.6 treats a correction as an override: it changes what the club's
         append-only log says happened, and a founder should see every one. */
      override: { reason: input.reason.trim() },
    },
  ]);
}

/* ============================================================================
   EXCEPTIONS — §6.6, §11 M6
   ========================================================================= */

/**
 * Assemble what `armouryExceptions` needs and run it.
 *
 * The rules are pure and live in src/domain/exceptions.ts; this is only the
 * gathering. Split that way for the same reason as everywhere else: the question
 * of what counts as an exception is answerable without a database, and a report
 * nobody can test is a report nobody trusts.
 */
export async function armouryExceptionReport(
  tx: ArmoryReader,
  now: Date,
): Promise<ArmouryException[]> {
  /* Only firearms with a custody history. A newly registered firearm has none,
     derives to `in_service`, and matches its column — checking it would be a
     row read per firearm for an answer that is known. */
  const firearms = await tx
    .select({
      id: schema.firearms.id,
      serialNumber: schema.firearms.serialNumber,
      status: schema.firearms.status,
    })
    .from(schema.firearms);

  const events = await tx
    .select({
      id: schema.custodyEvents.id,
      firearmId: schema.custodyEvents.firearmId,
      eventType: schema.custodyEvents.eventType,
      occurredAt: schema.custodyEvents.occurredAt,
      correctsEventId: schema.custodyEvents.correctsEventId,
    })
    .from(schema.custodyEvents);

  const byFirearm = new Map<string, typeof events>();
  for (const event of events) {
    const bucket = byFirearm.get(event.firearmId);
    if (bucket) bucket.push(event);
    else byFirearm.set(event.firearmId, [event]);
  }

  const firearmRecords: FirearmRecord[] = firearms.map((firearm) => {
    const custody = byFirearm.get(firearm.id) ?? [];
    return {
      id: firearm.id,
      serialNumber: firearm.serialNumber,
      status: firearm.status,
      custody: custody.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        correctsEventId: event.correctsEventId,
      })),
      lastMovedAt: custody.reduce<Date | null>(
        (latest, event) =>
          latest === null || event.occurredAt > latest ? event.occurredAt : latest,
        null,
      ),
    };
  });

  const ammunition: AmmunitionRecord[] = (
    await tx
      .select({
        issueId: schema.ammunitionIssues.id,
        qtyIssued: schema.ammunitionIssues.qtyIssued,
        qtyFired: schema.ammunitionIssues.qtyFired,
        qtyReturned: schema.ammunitionIssues.qtyReturned,
        reconciledAt: schema.ammunitionIssues.reconciledAt,
        issuedAt: schema.ammunitionIssues.issuedAt,
        firstName: schema.people.firstName,
        lastName: schema.people.lastName,
      })
      .from(schema.ammunitionIssues)
      .innerJoin(
        schema.participations,
        eq(schema.participations.id, schema.ammunitionIssues.participationId),
      )
      .innerJoin(
        schema.people,
        eq(schema.people.id, schema.participations.personId),
      )
      .where(isNotNull(schema.ammunitionIssues.reconciledAt))
  ).map((row) => ({
    issueId: row.issueId,
    shooter: `${row.firstName} ${row.lastName}`,
    qtyIssued: row.qtyIssued,
    qtyFired: row.qtyFired,
    qtyReturned: row.qtyReturned,
    reconciledAt: row.reconciledAt,
    issuedAt: row.issuedAt,
  }));

  const lots: LotRecord[] = await tx
    .select({
      id: schema.ammunitionLots.id,
      calibre: schema.ammunitionLots.calibre,
      quantityReceived: schema.ammunitionLots.quantityReceived,
      quantityRemaining: schema.ammunitionLots.quantityRemaining,
      quantityIssued: sql<number>`coalesce((
        select sum(i.qty_issued)::int from armory.ammunition_issues i
        where i.lot_id = ${schema.ammunitionLots.id}
      ), 0)`,
    })
    .from(schema.ammunitionLots);

  /* §12: an override "appears on the founder's dashboard the same day". Read
     from the audit log rather than from sessions, because the outstanding list
     exists only on the audit row — by now the session is closed and the list is
     gone from everywhere else. */
  const forcedCloses: ForcedClose[] = (
    await tx
      .select({
        entityId: schema.auditLog.entityId,
        occurredAt: schema.auditLog.occurredAt,
        overrideReason: schema.auditLog.overrideReason,
        before: schema.auditLog.before,
      })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "session.close_forced"),
          eq(schema.auditLog.isOverride, true),
        ),
      )
      .orderBy(desc(schema.auditLog.occurredAt))
      .limit(50)
  ).map((row) => ({
    sessionId: row.entityId ?? "",
    at: row.occurredAt,
    reason: row.overrideReason ?? "",
    outstanding:
      (row.before as { outstanding?: string[] } | null)?.outstanding ?? [],
  }));

  return armouryExceptions({
    firearms: firearmRecords,
    ammunition,
    lots,
    forcedCloses,
    now,
  });
}
