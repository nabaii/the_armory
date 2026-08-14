import { and, eq, isNull } from "drizzle-orm";
import { getArmoryDb, schema } from "@/db/armory/client";
import type { PushWriter } from "@/sync/push";
import type {
  AmmunitionReconcile,
  AppendOnlyInsert,
  IncidentWrite,
} from "@/sync/operations";

/**
 * THE APPEND-ONLY WRITER — §7's idempotency, in one statement.
 *
 *   INSERT INTO armory.custody_events (…) VALUES (…)
 *   ON CONFLICT (id) DO NOTHING
 *   RETURNING id
 *
 * Every property §7 asks for falls out of that:
 *
 *   · IDEMPOTENT. The primary key is the client-generated UUIDv7, so a replay
 *     conflicts with the row it created and changes nothing. `returning` is empty on
 *     a replay and holds the id on a first insert, which is how the endpoint tells
 *     `applied` from `duplicate` without a second query.
 *
 *   · ATOMIC. A single statement, so no transaction is needed to make the write and
 *     its own idempotency inseparable — they are the same statement. (The armoury
 *     client does have real transactions, and §8.3's allowance write will need them.
 *     This particular write does not, which is the point of §8.2's append-only
 *     class: "These records CANNOT conflict, which is precisely why the records that
 *     matter most were designed this way.")
 *
 *   · ATTRIBUTED. The device, the officer and the device's own clock are columns in
 *     the row, put there by src/sync/operations.ts. `recordedAt` is left to the
 *     column default so the server's clock stays the server's — §2: "Client-generated
 *     timestamps are recorded alongside server receipt time, never instead of it."
 *
 * ===========================================================================
 * WHY THERE IS NO SQL IN THIS FILE
 *
 * There was. It built the statement as text, interpolated the table and column names,
 * and carried a regex to check that the identifiers it was interpolating looked safe.
 * That was written on the mistaken belief that the armoury schema had no Drizzle
 * definitions; src/db/armory/schema.ts defines all thirty-four tables.
 *
 * The switch below is longer than the string-building version and strictly better in
 * the way that matters here: a column name that does not exist is a compile error, not
 * a Postgres error discovered inside a queued custody event on a range floor. There is
 * also no longer an identifier to validate, because there is no identifier — the target
 * resolves to a table object.
 *
 * It is a switch rather than a lookup table so that each branch's `values` is checked
 * against its own table. A `Record<target, PgTable>` would erase exactly the type
 * information this refactor exists to gain.
 */
export class PostgresAppendOnlyWriter implements PushWriter {
  async insert(row: AppendOnlyInsert): Promise<{ created: boolean }> {
    const db = getArmoryDb();

    switch (row.target) {
      case "participations": {
        const inserted = await db
          .insert(schema.participations)
          .values(row.values)
          .onConflictDoNothing({ target: schema.participations.id })
          .returning({ id: schema.participations.id });
        return { created: inserted.length > 0 };
      }

      case "waiverSignatures": {
        const inserted = await db
          .insert(schema.waiverSignatures)
          .values(row.values)
          .onConflictDoNothing({ target: schema.waiverSignatures.id })
          .returning({ id: schema.waiverSignatures.id });
        return { created: inserted.length > 0 };
      }

      case "custodyEvents": {
        const inserted = await db
          .insert(schema.custodyEvents)
          .values(row.values)
          .onConflictDoNothing({ target: schema.custodyEvents.id })
          .returning({ id: schema.custodyEvents.id });
        return { created: inserted.length > 0 };
      }

      case "ammunitionIssues": {
        const inserted = await db
          .insert(schema.ammunitionIssues)
          .values(row.values)
          .onConflictDoNothing({ target: schema.ammunitionIssues.id })
          .returning({ id: schema.ammunitionIssues.id });
        return { created: inserted.length > 0 };
      }

      case "rounds": {
        const inserted = await db
          .insert(schema.rounds)
          .values(row.values)
          .onConflictDoNothing({ target: schema.rounds.id })
          .returning({ id: schema.rounds.id });
        return { created: inserted.length > 0 };
      }

      case "auditLog": {
        const inserted = await db
          .insert(schema.auditLog)
          .values(row.values)
          .onConflictDoNothing({ target: schema.auditLog.id })
          .returning({ id: schema.auditLog.id });
        return { created: inserted.length > 0 };
      }
    }
  }

  /**
   * §3.3's incident — the one push that is two rows, in one transaction.
   *
   * The armoury client holds a pooled TCP connection with real transactions
   * (src/db/armory/client.ts), which exists for §8.3's allowance write and is
   * what makes this possible at all. The Neon HTTP driver the leagues product
   * uses could not do it: two statements, no transaction, and an incident that
   * can land with nobody attached to it.
   *
   * `created` is read from the incident insert only. The join's key is
   * (incident_id, person_id) and conflicts there are ordinary — the same person
   * listed twice by two devices reporting the same event — so a `created` read
   * from the join would report a new incident as a replay and the outbox would
   * mark a record delivered that was not.
   */
  async insertIncident(write: IncidentWrite): Promise<{ created: boolean }> {
    const db = getArmoryDb();

    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.incidents)
        .values(write.incident)
        .onConflictDoNothing({ target: schema.incidents.id })
        .returning({ id: schema.incidents.id });

      /* Written on every delivery, not only the first. A second delivery that
         carries a person the first did not — an officer who added a witness
         before the queue drained — must still attach them, and `DO NOTHING`
         makes re-writing the others free. */
      if (write.persons.length > 0) {
        await tx
          .insert(schema.incidentPersons)
          .values([...write.persons])
          .onConflictDoNothing({
            target: [
              schema.incidentPersons.incidentId,
              schema.incidentPersons.personId,
            ],
          });
      }

      return { created: inserted.length > 0 };
    });
  }

  /**
   * §3.4's reconciliation — the one push that is an UPDATE.
   *
   * The guarantee is carried entirely by the WHERE clause. `reconciled_at IS
   * NULL` means the first delivery does the work and every later one matches no
   * rows, so `applied` is false and the endpoint answers `duplicate` — the same
   * two outcomes as every insert, reached by a different route.
   *
   * Dropping that predicate would leave a statement that still looks idempotent
   * because it writes the same values. It is not: a redelivered reconciliation
   * arriving after a correction would overwrite the correction, silently, in the
   * one number nobody would think to re-check. The arithmetic guard installed in
   * drizzle/0002 permits the transition exactly once for the same reason.
   *
   * `reconciled_at` is the server's clock, not the device's — §2 keeps both, and
   * the issue row already carries the device's `issued_at`.
   */
  async reconcile(values: AmmunitionReconcile): Promise<{ applied: boolean }> {
    const db = getArmoryDb();

    const updated = await db
      .update(schema.ammunitionIssues)
      .set({
        qtyFired: values.qtyFired,
        qtyReturned: values.qtyReturned,
        reconciledAt: new Date(),
      })
      .where(
        and(
          eq(schema.ammunitionIssues.id, values.issueId),
          isNull(schema.ammunitionIssues.reconciledAt),
        ),
      )
      .returning({ id: schema.ammunitionIssues.id });

    return { applied: updated.length > 0 };
  }
}
