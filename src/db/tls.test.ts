/**
 * TLS decisions.
 *
 * This is the one module where a wrong answer is silent: a connection that
 * skips verification looks identical, from the application, to one that
 * verified. The exception for a private host exists because Render's managed
 * Postgres presents a bare self-signed certificate with no published CA — see
 * the argument in tls.ts — and the whole safety of that exception rests on it
 * being unreachable from the internet. So the boundary is tested rather than
 * assumed: every host with a dot must keep full verification.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrivateHost, tlsOptions } from "./tls";

const RENDER_INTERNAL = "postgresql://user:pw@dpg-da078bu1egvs7382lr5g-a/armory";
const RENDER_EXTERNAL =
  "postgresql://user:pw@dpg-da078bu1egvs7382lr5g-a.frankfurt-postgres.render.com/armory";

describe("isPrivateHost", () => {
  it("accepts a single-label hostname", () => {
    assert.equal(isPrivateHost(RENDER_INTERNAL), true);
    assert.equal(isPrivateHost("postgresql://u:p@postgres/db"), true);
  });

  it("rejects every hostname with a dot", () => {
    assert.equal(isPrivateHost(RENDER_EXTERNAL), false);
    assert.equal(isPrivateHost("postgresql://u:p@db.example.com/db"), false);
    /* Looks internal, is not: a dotted name can resolve anywhere. */
    assert.equal(isPrivateHost("postgresql://u:p@dpg-xxx-a.internal.example/db"), false);
  });

  it("rejects a URL it cannot parse a host from", () => {
    assert.equal(isPrivateHost(""), false);
    assert.equal(isPrivateHost("not a url"), false);
  });

  it("reads the host past a password containing an @", () => {
    assert.equal(isPrivateHost("postgresql://u:p%40ss@dpg-xxx-a/db"), true);
    assert.equal(isPrivateHost("postgresql://u:p%40ss@db.example.com/db"), false);
  });
});

describe("tlsOptions in production", () => {
  const previous = { env: process.env.NODE_ENV, ca: process.env.DATABASE_CA_CERT };

  const asProduction = (run: () => void) => {
    /* NODE_ENV is readonly in the Next types but writable at runtime, which is
       how the production branch gets exercised at all. */
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.DATABASE_CA_CERT;
    try {
      run();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previous.env;
      if (previous.ca === undefined) delete process.env.DATABASE_CA_CERT;
      else process.env.DATABASE_CA_CERT = previous.ca;
    }
  };

  it("verifies an external host", () => {
    asProduction(() => {
      assert.deepEqual(tlsOptions(RENDER_EXTERNAL), { rejectUnauthorized: true });
    });
  });

  it("encrypts without verifying a private host", () => {
    asProduction(() => {
      assert.deepEqual(tlsOptions(RENDER_INTERNAL), { rejectUnauthorized: false });
    });
  });

  it("verifies a private host once a certificate is pinned", () => {
    asProduction(() => {
      process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----";
      const options = tlsOptions(RENDER_INTERNAL);
      assert.equal(options?.rejectUnauthorized, true);
      assert.match(String(options?.ca), /BEGIN CERTIFICATE/);
    });
  });

  it("expands a single-line PEM written with literal backslash-n", () => {
    asProduction(() => {
      process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\\nx\\n-----END CERTIFICATE-----";
      assert.match(String(tlsOptions(RENDER_EXTERNAL)?.ca), /\n/);
    });
  });
});
