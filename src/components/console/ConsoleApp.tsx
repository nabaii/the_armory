"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveConsoleGate, type ConsoleGate } from "@/offline/boot";
import { buildCheckIn, presentPersonIds } from "@/offline/checkin";
import { DayPackStore } from "@/offline/daypack-store";
import { SessionStore } from "@/offline/session-store";
import { requestPersistence } from "@/offline/db";
import { DeviceStore } from "@/offline/device-store";
import { Outbox } from "@/offline/outbox/outbox";
import { IndexedDbOutboxStore } from "@/offline/outbox/indexeddb-store";
import { REVOKED_MESSAGE, wipeLocalState } from "@/offline/revoke";
import {
  createSender,
  enrolDevice,
  refreshDayPack,
  requestBackgroundSync,
} from "@/offline/sync-client";
import { todayRows, todaySummary, type ArrivalRow } from "@/offline/today";
import { lagosDateKey } from "@/lib/time";
import type { IndexedDayPack } from "@/offline/daypack";
import { personDetail } from "@/offline/person";
import { ConsoleEnrolment } from "./ConsoleEnrolment";
import { PersonDetail } from "./PersonDetail";
import { SyncStatus, type SyncStatusView } from "./SyncStatus";
import { Today } from "./Today";

/**
 * THE CONSOLE — the one client-rendered document behind /console/*.
 *
 * Everything this component decides is decided somewhere else:
 *
 *   · whether the desk may open at all → src/offline/boot.ts
 *   · what each arrival's status is    → src/offline/today.ts
 *   · what becomes of a failed write   → src/offline/outbox/policy.ts
 *
 * What is left here is genuinely the browser's part: opening IndexedDB, registering
 * a service worker, asking for persistent storage, and draining a queue on a timer.
 * That division is why §8 is testable at all — none of the rules above need a
 * browser to exercise, and this file needs no rules to review.
 *
 * ===========================================================================
 * THE ORDER OF THE BOOT, AND WHY IT READS FROM DISK FIRST
 *
 * §2 gives a cold start with no network one second to reach a usable desk screen.
 * So the sequence is: read local state, render, and only then talk to the network.
 * A boot that awaited the server would spend its whole budget discovering the
 * network is gone — and on the morning that matters, it is gone.
 *
 * The server is consulted afterwards, and the only thing it can say that changes
 * what is on screen immediately is "revoked" (§10).
 */

const packStore = new DayPackStore();
const deviceStore = new DeviceStore();
const sessionStore = new SessionStore();
const outbox = new Outbox(new IndexedDbOutboxStore());

/** How often the queue is drained while the desk is open. §8.4. */
const DRAIN_INTERVAL_MS = 30_000;

type Boot =
  | { phase: "reading" }
  /** No credential on this device yet. §3.1 — see ConsoleEnrolment. */
  | { phase: "unenrolled" }
  | { phase: "ready"; gate: ConsoleGate; pack: IndexedDayPack | null }
  | { phase: "wiped" };

export function ConsoleApp() {
  const [boot, setBoot] = useState<Boot>({ phase: "reading" });
  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [draining, setDraining] = useState(false);

  /**
   * People on the premises.
   *
   * Derived from participations on disk, not from the outbox — see the header of
   * src/offline/session-store.ts for why those are different questions. This is what
   * makes a guest's row clear when their host checks in (§12.1) and what makes it
   * still clear after the power has been pulled and the tablet rebooted (§8.5).
   */
  const [checkedIn, setCheckedIn] = useState<ReadonlySet<string>>(new Set());

  /** The last refusal from a check-in attempt, shown next to the row. §4.3. */
  const [refusal, setRefusal] = useState<string | null>(null);

  /** Whose Person detail is open, if any. §6.4 — "only when the officer needs it". */
  const [opened, setOpened] = useState<string | null>(null);

  /** The fingerprint of the pack on disk, for the conditional refresh. */
  const etag = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  /** The current `sync`, so a check-in can trigger one without depending on it. */
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatus(await outbox.status());
  }, []);

  /**
   * §10, and the only irreversible thing this component does.
   *
   * Kept as one function called from exactly two places — the boot gate and a
   * server verdict — so that the destructive path is easy to find and impossible to
   * reach by accident.
   */
  const wipe = useCallback(async () => {
    await wipeLocalState();
    setBoot({ phase: "wiped" });
  }, []);

  /* ---------------------------------------------------------------------------
     BOOT
     -------------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      /* Persistent storage first, because it is the promise everything below
         depends on and Chrome grants it to an installed PWA without prompting. */
      const storagePersistent = await requestPersistence().catch(() => false);

      const now = new Date();

      /* The clock high-water mark. Advanced on every launch — see the header of
         src/offline/device.ts for why the bound cannot be measured against the raw
         clock on a device that may be in the wrong hands. */
      const clock = await deviceStore.stampClock(now).catch(() => ({
        now,
        highWaterAt: null,
      }));

      const registration = await deviceStore.loadRegistration().catch(() => null);
      const pack = await packStore.loadIndexed().catch(() => null);
      token.current = await deviceStore.loadToken().catch(() => null);

      /* §8.5: "Restore power. Reopen. Every record must be present." This read is
         that requirement — presence comes back off the disk, so a host checked in
         before the cut is still checked in, and their guest's row is still clear. */
      const present = await sessionStore
        .participations()
        .then(presentPersonIds)
        .catch(() => new Set<string>());

      if (cancelled) return;

      /**
       * A device with no credential has never been registered, and §3.1 says the
       * desk does not load on one.
       *
       * Checked before the trust gate rather than left to it, because the two
       * answers are different: `evaluateDeviceTrust` refuses an unregistered device
       * with "a founder can register it from the owner dashboard", which is correct
       * and unhelpful on the tablet the founder is holding. This offers the field
       * instead.
       */
      if (!token.current || !registration) {
        setBoot({ phase: "unenrolled" });
        return;
      }

      /* Decided with `reachable: false`: nothing has been asked of the server yet,
         and this is the render that has to happen inside one second. */
      const gate = resolveConsoleGate({
        registration,
        verdict: { reachable: false },
        clock,
        packPulledAt: pack?.pulledAt ?? null,
        storagePersistent,
      });

      if (!gate.open && gate.wipe) {
        await wipe();
        return;
      }

      etag.current = null;
      setCheckedIn(present);
      setBoot({ phase: "ready", gate, pack });
      await refreshStatus();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshStatus, wipe]);

  /* ---------------------------------------------------------------------------
     CHECK-IN — §6.4, and the workflow §8.5 pulls the power on
     -------------------------------------------------------------------------- */

  const checkIn = useCallback(
    async (personId: string) => {
      setRefusal(null);

      const current = boot.phase === "ready" ? boot.pack : null;
      if (!current) return;

      const arrival = current.pack.arrivals.find(
        (candidate) => candidate.personId === personId,
      );
      if (!arrival) return;

      const registration = await deviceStore.loadRegistration();
      const shift = await sessionStore.currentShift();
      if (!registration) return;

      const result = buildCheckIn(current, arrival, {
        /**
         * §10: "Every staff action attributable to a named person."
         *
         * Null until a shift has been started, which M1 has no screen for — the
         * officer sign-in and its short local unlock are M5's, and inventing a
         * dropdown of officers here would be the shared login §10 forbids by another
         * name. The column is nullable and the audit row still records the device, so
         * an M1 demonstration write is attributable to a tablet and honestly not to a
         * person. That is a named gap, not a silent one — see
         * docs/M1_offline_acceptance.md.
         */
        actorStaffId: shift?.staffId ?? null,
        now: new Date(),
        override: null,
        laneId: null,
      });

      if (!result.ok) {
        setRefusal(result.refusal.remedy
          ? `${result.refusal.reason} ${result.refusal.remedy}`
          : result.refusal.reason);
        return;
      }

      /**
       * Local record first, queue second.
       *
       * The order matters for the power cut. Written this way, an interruption
       * between the two leaves a participation on disk that no queue item will
       * deliver — recoverable, because the record exists and can be re-queued. The
       * other order leaves a queued write for a check-in the desk has no memory of,
       * so the officer sees an empty row and checks the person in again.
       */
      await sessionStore.recordParticipation(result.writes.participation);

      for (const item of result.writes.queue) {
        await outbox.enqueue({
          id: item.id,
          operation: item.operation,
          payload: item.payload,
          deviceId: registration.deviceId,
          actorStaffId: shift?.staffId ?? null,
        });
      }

      /* Re-read presence from disk rather than adding to the set in memory, so what
         is on screen is what survived the write. */
      setCheckedIn(presentPersonIds(await sessionStore.participations()));
      await refreshStatus();

      /* §2: hand the queue to the platform as well, so these records still reach the
         server if the officer closes the desk before the link comes back. */
      void requestBackgroundSync();

      /* Send immediately if there is a link. The queue would pick it up within
         thirty seconds anyway; this is so an officer watching the bar sees it clear. */
      /* Through a ref because `sync` is declared below this and is rebuilt on every
         drain-state change. Capturing it directly would either need a lint
         suppression or would rebuild this callback mid-check-in. */
      void syncRef.current?.();
    },
    [boot, refreshStatus],
  );

  /* ---------------------------------------------------------------------------
     ENROLMENT — §3.1
     -------------------------------------------------------------------------- */

  const enrol = useCallback(async (deviceToken: string): Promise<string | null> => {
    const result = await enrolDevice({ deviceToken });

    if (result.kind === "refused") return result.reason;
    if (result.kind === "unavailable") {
      /* Registration is the one thing on this surface that genuinely cannot be done
         offline: the credential has to be checked against the server that issued it.
         Said plainly rather than as a network error. */
      return "This tablet could not reach the club's system. Registration needs one connection.";
    }

    const now = new Date();

    /* The pack is stored before the credential. If the power fails between the two,
       the device is unenrolled and has a pack it will replace on the next
       registration — harmless. The other order leaves a device holding a credential
       and no data, which reads at the desk as a registered tablet that shows
       nothing. */
    await packStore.save(result.pack);
    await deviceStore.saveToken(deviceToken);
    await deviceStore.saveRegistration({
      deviceId: result.deviceId,
      label: result.label,
      surface: result.surface,
      registeredAt: now,
      lastVerifiedAt: now,
    });

    token.current = deviceToken;
    etag.current = result.etag;

    const clock = await deviceStore.stampClock(now);
    const pack = await packStore.loadIndexed();

    setBoot({
      phase: "ready",
      /* `reachable: true, revoked: false` — the enrolment response IS the server
         confirming this device, so the gate is decided on live information rather
         than on a grace period the device has not needed yet. */
      gate: resolveConsoleGate({
        registration: {
          deviceId: result.deviceId,
          label: result.label,
          surface: result.surface,
          registeredAt: now,
          lastVerifiedAt: now,
        },
        verdict: { reachable: true, revoked: false },
        clock,
        packPulledAt: pack?.pulledAt ?? null,
        storagePersistent: await requestPersistence().catch(() => false),
      }),
      pack,
    });

    await refreshStatus();
    return null;
  }, [refreshStatus]);

  /* ---------------------------------------------------------------------------
     SYNC — after the screen exists, never before it
     -------------------------------------------------------------------------- */

  const sync = useCallback(async () => {
    if (draining) return;
    setDraining(true);

    try {
      const deviceToken = token.current;
      if (!deviceToken) return;

      const onRevoked = () => void wipe();

      /* The queue first. A day pack that overwrote local state before an
         afternoon's custody events had been delivered would be this system losing
         the records it exists to keep — and the pack cannot contain them, because
         they have not reached the server yet. */
      await outbox.drain(createSender({ deviceToken, onRevoked }));
      await refreshStatus();

      const refreshed = await refreshDayPack({
        deviceToken,
        onRevoked,
        etag: etag.current,
      });

      if (refreshed.kind === "pack") {
        await packStore.save(refreshed.pack);
        etag.current = refreshed.etag;
        await deviceStore.markVerified(new Date());

        const pack = await packStore.loadIndexed();
        setBoot((current) =>
          current.phase === "ready" ? { ...current, pack } : current,
        );
      }
    } finally {
      setDraining(false);
    }
  }, [draining, refreshStatus, wipe]);

  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    if (boot.phase !== "ready") return;

    /* Drain on a timer AND on `online`. The timer covers a link that comes back
       without the browser noticing — common behind a captive portal, which is
       exactly the network public/console/sw.js describes. */
    const timer = setInterval(() => void sync(), DRAIN_INTERVAL_MS);
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [boot.phase, sync]);

  /* ---------------------------------------------------------------------------
     RENDER
     -------------------------------------------------------------------------- */

  if (boot.phase === "reading") {
    /* Deliberately not a spinner. This state lasts as long as an IndexedDB read and
       a spinner that flashes for 40ms is noise; if it lasts longer than that, the
       officer is looking at a device with a real problem and "Opening the desk"
       tells them more than an animation. */
    return <Shell>Opening the desk…</Shell>;
  }

  if (boot.phase === "unenrolled") {
    return <ConsoleEnrolment onEnrol={enrol} />;
  }

  if (boot.phase === "wiped") {
    return (
      <Refused heading={REVOKED_MESSAGE.heading} body={REVOKED_MESSAGE.body} remedy={null} />
    );
  }

  if (!boot.gate.open) {
    return (
      <Refused
        heading={boot.gate.heading}
        body={boot.gate.body}
        remedy={boot.gate.remedy}
      />
    );
  }

  const rows: ArrivalRow[] = boot.pack
    ? todayRows(boot.pack, lagosDateKey(new Date()), new Date(), checkedIn)
    : [];

  /**
   * §6.4: Person detail is "opened only when the officer needs it".
   *
   * Derived on render rather than held in state, so it re-computes for free when
   * a check-in changes `checkedIn` — the panel showing a member's blocks updates
   * as their host arrives, for the same reason and by the same route as the
   * Today row behind it (§12.1: "no retry needed").
   */
  const detail =
    boot.pack && opened
      ? personDetail(boot.pack, opened, new Date(), checkedIn)
      : null;

  return (
    <div className="flex min-h-full flex-col">
      {/* §8.4: at all times, not behind a menu. */}
      {status && (
        <SyncStatus status={status} onRetry={draining ? null : () => void sync()} />
      )}

      <header className="border-b border-[--color-terrazzo] px-4 py-3">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-[--color-sight-ink]">{todaySummary(rows)}</p>
      </header>

      {boot.gate.notices.map((notice) => (
        <p
          key={notice.line}
          className={`px-4 py-2 text-sm ${
            notice.tone === "warning"
              ? "border-l-4 border-[--color-ten-ring-deep] bg-[--color-terrazzo] font-medium"
              : "text-[--color-sight-ink]"
          }`}
        >
          {notice.line}
        </p>
      ))}

      {/* A refusal from the last attempt. §4.3: one line, and it names what to do. */}
      {refusal && (
        <p
          role="alert"
          className="border-l-4 border-[--color-ten-ring-deep] bg-[--color-terrazzo] px-4 py-2 text-sm font-medium"
        >
          {refusal}
        </p>
      )}

      <Today
        rows={rows}
        canRunSession={boot.gate.canRunSession}
        onCheckIn={(personId) => void checkIn(personId)}
        onOpen={setOpened}
      />

      {detail && <PersonDetail view={detail} onClose={() => setOpened(null)} />}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-8 text-[--color-sight-ink]">
      {children}
    </div>
  );
}

/**
 * The screen a device gets when it may not open the desk.
 *
 * One heading, one explanation, one route back — §4.3's shape applied to the device
 * rather than to a person. It never says "error" and never blames whoever is
 * holding the tablet, who may be a range officer looking at a device the founder
 * revoked an hour ago after a scare.
 */
function Refused({
  heading,
  body,
  remedy,
}: {
  heading: string;
  body: string;
  remedy: string | null;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-3 text-[--color-sight-ink]">{body}</p>
        {remedy && <p className="mt-2 text-[--color-sight-ink]">{remedy}</p>}
      </div>
    </div>
  );
}
