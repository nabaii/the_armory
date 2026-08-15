import { Pool } from "pg";

/**
 * ONE POOL, ONE DATABASE, TWO SCHEMAS.
 *
 * `public` holds the leagues product; `armory` holds the management system.
 * They are separate schemas in one Postgres for the reason
 * src/db/armory/schema.ts sets out at length — both specifications need the
 * table names `rounds` and `sessions` for different things — and they are one
 * DATABASE because `public.members.person_id` is a FOREIGN KEY into
 * `armory.people` (drizzle/0005). That constraint cannot span two databases,
 * and without it the link that makes the member portal work would be an
 * application convention nothing enforces.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS: TWO DRIVERS BECAME ONE
 *
 * The leagues client used to connect over the Neon HTTP driver
 * (`drizzle-orm/neon-http`), and its header argued the case: HTTP speaks over
 * `fetch` rather than holding a socket, so nothing depended on a Node API and
 * the hosting decision stayed late and reversible.
 *
 * That reasoning was sound and it expired. Two things ended it:
 *
 *   · The Neon HTTP driver only speaks to NEON. It posts SQL to an endpoint
 *     derived from the hostname, so the "hosting decision stays open" property
 *     it was chosen for was the opposite of what it delivered — it fixed the
 *     vendor while the management system, on `pg`, could run anywhere.
 *
 *   · The property it bought — an edge-compatible runtime — is not used.
 *     Nothing in this repository sets `runtime = "edge"`, and the deployment
 *     target has no edge tier. It was a cost paid for an option nobody took.
 *
 * So both halves now share this pool. What that buys, beyond portability:
 *
 *   · ONE pool instead of two against the same database. Managed Postgres bills
 *     and caps connections, and two independent pools of ten was twenty
 *     connections for a club with a handful of tablets.
 *
 *   · The leagues half gains real transactions. Its single-statement,
 *     guard-in-the-WHERE-clause workarounds remain correct and are not being
 *     unpicked — they simply stop being forced. `redeemAuthToken` is the one
 *     that most wanted the choice.
 *
 * ===========================================================================
 * WHAT WAS GIVEN UP, PLAINLY
 *
 * Edge deployment. If this ever moves to a runtime without Node sockets, this
 * file is what has to change — and the leagues half would need its HTTP driver
 * back while the management system would need a different answer entirely,
 * because §8.3's allowance transaction cannot be expressed over HTTP at all.
 *
 * That is a real constraint and it is recorded here rather than discovered.
 */

const connectionString = process.env.DATABASE_URL?.trim();

export const isDatabaseUrlSet = (): boolean => Boolean(connectionString);

let pool: Pool | null = null;

/**
 * The pool, created on first use.
 *
 * Lazy so that importing a database module never opens a connection — the
 * static marketing build touches none of this and must not need a database to
 * compile.
 */
export function getPool(): Pool {
  if (pool) return pool;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. The Armory management system requires a " +
        "Postgres connection that supports transactions — see §3.2 and §8.3 " +
        "on the guest allowance. The marketing pages do not need it.",
    );
  }

  pool = new Pool({
    connectionString,
    /**
     * Small on purpose, and now shared.
     *
     * The club has a handful of tablets and one founder; the pool exists for
     * transaction isolation, not for throughput, and a large idle pool against
     * a managed Postgres is just billed connections.
     *
     * Ten covers BOTH products because they are not concurrent with each other
     * in any real way — the desk syncs while the portal is idle, and a hundred
     * members do not book simultaneously. If this ever needs raising, raise it
     * here once rather than growing a second pool.
     */
    max: 10,
    idleTimeoutMillis: 30_000,
    /* §2 asks for hosting with low latency to Nigeria, which in practice means
       the link is sometimes poor rather than absent. A connection attempt that
       hangs is indistinguishable at the desk from one that failed, and the desk
       has an offline path it should be falling back to. */
    connectionTimeoutMillis: 10_000,
    ssl: tlsOptions(connectionString),
  });

  /* An idle client erroring — a managed provider recycling a connection, a
     network blip — reaches the pool as an 'error' event. Unhandled, it is an
     uncaught exception that takes the process down. */
  pool.on("error", (error) => {
    console.error("[db] idle database client error", error);
  });

  return pool;
}

/**
 * Whether to demand TLS.
 *
 * §10 requires "TLS in transit", and this data is identity documents, home
 * addresses and firearm licences. The exception is a local connection during
 * development, where there is no certificate to verify and no network to
 * intercept. Anything else — including a hostname that merely LOOKS local —
 * gets TLS with verification on, rather than the `rejectUnauthorized: false`
 * that turns TLS into decoration.
 */
function needsTls(url: string): boolean {
  if (process.env.NODE_ENV !== "production") {
    return !/@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)[:/]/.test(url);
  }
  return true;
}

/**
 * The TLS configuration, with a supported way to trust a provider's own CA.
 *
 * ===========================================================================
 * WHY THIS EXISTS: THE THING SOMEBODY WOULD OTHERWISE DO AT 2AM
 *
 * `rejectUnauthorized: true` verifies the server's certificate against Node's
 * built-in CA bundle. Several managed Postgres providers — Render among them —
 * present certificates that bundle does not contain, so a correctly configured
 * deployment can fail its first connection with:
 *
 *   SELF_SIGNED_CERT_IN_CHAIN
 *   UNABLE_TO_VERIFY_LEAF_SIGNATURE
 *
 * There is exactly one search result away from that error, and it is
 * `rejectUnauthorized: false`. That does not fix a certificate problem — it
 * removes the check that noticed one, leaves the connection encrypted against
 * a passive listener and wide open to an active one, and does it on the link
 * carrying every member's home address and firearm licence.
 *
 * So the correct fix is available as configuration rather than as a code edit
 * made under deployment pressure: set `DATABASE_CA_CERT` to the provider's CA
 * certificate (PEM), and verification continues against THAT.
 *
 * There is deliberately no environment variable that disables verification. If
 * one is ever genuinely needed, it should be added here, in this file, with a
 * comment arguing for it — not discovered in a dashboard by whoever is on call.
 */
function tlsOptions(url: string) {
  if (!needsTls(url)) return undefined;

  /* Render and several others hand the CA over as a single-line PEM with
     literal `\n`. Both forms are accepted so pasting either into a dashboard
     works. */
  const ca = process.env.DATABASE_CA_CERT?.trim().replace(/\\n/g, "\n");

  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

/**
 * For tests and for graceful shutdown.
 *
 * Both clients' cached drizzle instances are invalidated through the callbacks
 * they register here, so a closed pool cannot leave a live-looking handle
 * behind that fails on its next query.
 */
const onClose: (() => void)[] = [];

export function registerPoolReset(reset: () => void): void {
  onClose.push(reset);
}

export async function closePool(): Promise<void> {
  if (!pool) return;

  await pool.end();
  pool = null;
  for (const reset of onClose) reset();
}
