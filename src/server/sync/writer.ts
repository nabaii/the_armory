import { getArmoryDb, schema } from "@/db/armory/client";
import type { AppendOnlyWriter } from "@/sync/push";
import type { AppendOnlyInsert } from "@/sync/operations";

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
export class PostgresAppendOnlyWriter implements AppendOnlyWriter {
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
}
