"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveConsoleGate, type ConsoleGate } from "@/offline/boot";
import {
  buildCheckIn,
  presentPersonIds,
  type LocalParticipation,
} from "@/offline/checkin";
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
import { subjectFor, type IndexedDayPack } from "@/offline/daypack";
import { personDetail } from "@/offline/person";
import { lanesFor, noLaneReason, suggestLane } from "@/offline/lanes";
import { OfficerStore } from "@/offline/officer-store";
import { actorFor, shiftIsLive, type OfficerShift } from "@/offline/officer";
import { unlockOfficer } from "@/offline/sync-client";
import {
  buildAmmunitionIssue,
  buildAmmunitionReconcile,
  buildFirearmIssue,
  buildFirearmReturn,
} from "@/offline/equipment";
import {
  buildSessionClose,
  closeStateFor,
  endOfDay,
  type LocalAmmunitionIssue,
  type LocalIssue,
  type SessionLocalState,
} from "@/offline/close";
import {
  buildWaiverSignature,
  signedWaivers,
  NO_WAIVER_TEXT,
  type CapturedSignature,
  type LocalWaiverSignature,
} from "@/offline/waiver";
import {
  mergedParticipations,
  relay,
  relayShooters,
  type LocalRound,
  type RelayShooter,
} from "@/offline/relay";
import { buildScore } from "@/offline/score";
import { buildIncident, type LocalIncident } from "@/offline/incident";
import { formatsFor } from "@/domain/scoring";
import type { DeviceSurface } from "@/domain/enums";
import { CheckInSheet } from "./CheckInSheet";
import { ConsoleEnrolment } from "./ConsoleEnrolment";
import { EndOfDay } from "./EndOfDay";
import { EquipmentSheet } from "./EquipmentSheet";
import { IncidentSheet } from "./IncidentSheet";
import { OfficerUnlock } from "./OfficerUnlock";
import { PairSheet } from "./PairSheet";
import { PersonDetail } from "./PersonDetail";
import { Relay } from "./Relay";
import { ScoreSheet } from "./ScoreSheet";
import { WaiverSheet } from "./WaiverSheet";
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
const officerStore = new OfficerStore();
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

  /**
   * The officer on shift. §10: "Every staff action attributable to a named person."
   *
   * Held here rather than read per write, so a check-in does not wait on IndexedDB
   * inside the fifteen seconds §1.2 gives the whole interaction. The disk copy is
   * the durable one; this is the render's view of it.
   */
  const [shift, setShift] = useState<OfficerShift | null>(null);

  /** The row whose lane is being chosen. §6.4's check-in, tap two of three. */
  const [checkingIn, setCheckingIn] = useState<ArrivalRow | null>(null);

  /** Local participations, for lane occupancy. Re-read after every check-in. */
  const [present, setPresent] = useState<LocalParticipation[]>([]);

  /** What this device has issued today. Feeds §6.4's close guard. */
  const [firearmIssues, setFirearmIssues] = useState<LocalIssue[]>([]);
  const [ammunitionIssues, setAmmunitionIssues] = useState<
    LocalAmmunitionIssue[]
  >([]);

  /** Whose equipment sheet is open, and whether end of day is showing. */
  const [equipping, setEquipping] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  /**
   * Waivers signed at this desk, and whose sheet is open.
   *
   * Held here for the same reason `present` is: these feed a permission decision
   * on every row of Today, and re-reading IndexedDB inside the render would spend
   * the one-second budget §6.4 gives the whole screen. The disk copy is the
   * durable one; this is the render's view of it.
   */
  const [signatures, setSignatures] = useState<LocalWaiverSignature[]>([]);
  const [signing, setSigning] = useState<string | null>(null);

  /**
   * Which of §6.4 and §6.5 this tablet is — the desk, or a lane.
   *
   * §3.1 registers a device against a surface and the day pack returns it
   * (`DayPackResponse.device.surface`), so the tablet is told which it is by the
   * server that registered it rather than by anything a person can change here.
   *
   * That is deliberate. A toggle would mean a lane tablet clamped to a post
   * outside could be switched into the desk, which holds the check-in workflow,
   * the person detail panel and the end-of-day close. §10's whole argument for
   * device-bound sessions is that the device is part of the credential; a
   * surface a user can pick is not.
   *
   * Defaults to `desk` while the registration is being read, because the desk is
   * what every previously-registered device was before lanes existed and the
   * boot below overwrites it within the same tick.
   */
  const [surface, setSurface] = useState<DeviceSurface>("desk");

  /* §6.5's lane state. Cards and incidents this device recorded, and which
     sheet is open over the relay. */
  const [rounds, setRounds] = useState<LocalRound[]>([]);
  const [incidents, setIncidents] = useState<LocalIncident[]>([]);
  const [pairing, setPairing] = useState<RelayShooter | null>(null);
  const [scoring, setScoring] = useState<RelayShooter | null>(null);
  const [reportingIncident, setReportingIncident] = useState(false);

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
      /* §6.5. Read from the credential rather than chosen, so a lane tablet
         cannot be turned into a desk by whoever is holding it. */
      setSurface(registration.surface);
      /* Read at boot with everything else, so the desk knows within its
         one-second budget whether it is showing Today or the unlock. */
      setShift(await officerStore.load());
      setPresent(await sessionStore.participations());
      setFirearmIssues(await sessionStore.firearmIssues());
      setAmmunitionIssues(await sessionStore.ammunitionIssues());
      /* §8.5 step 17, for step 9's record: a waiver signed before the power was
         pulled is still signed afterwards, and the row it cleared is still clear. */
      setSignatures(await sessionStore.waiverSignatures());
      /* §8.5 step 12, and the same requirement: two scores recorded before the
         cut are still on the relay after it, read from disk and not from the
         queue — otherwise an officer re-enters a card the club already holds. */
      setRounds(await sessionStore.rounds());
      setIncidents(await sessionStore.incidents());
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
    async (
      personId: string,
      laneId: string,
      override: { reason: string } | null,
    ) => {
      setRefusal(null);

      const current = boot.phase === "ready" ? boot.pack : null;
      if (!current) return;

      const arrival = current.pack.arrivals.find(
        (candidate) => candidate.personId === personId,
      );
      if (!arrival) return;

      const registration = await deviceStore.loadRegistration();
      if (!registration) return;

      /* §10. Null only when no shift is live, and the desk does not render
         Today in that state — so in practice this names a person. `actorFor`
         re-checks expiry rather than trusting the render's copy, because a
         shift can lapse between a screen being drawn and a button being
         pressed at the end of a long evening. */
      const actorStaffId = actorFor(shift, new Date());

      const result = buildCheckIn(current, arrival, {
        /* §10: "Every staff action attributable to a named person." Closed at
           M5 — see src/offline/officer.ts. */
        actorStaffId,
        now: new Date(),
        override,
        /* §6.4: "checked in WITH A LANE ASSIGNED." Chosen by the officer in
           CheckInSheet, defaulted to the lowest free bay. */
        laneId,
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
          actorStaffId,
        });
      }

      /* Re-read presence from disk rather than adding to the set in memory, so what
         is on screen is what survived the write. The full list feeds lane
         occupancy as well as the checked-in set. */
      const participations = await sessionStore.participations();
      setPresent(participations);
      setCheckedIn(presentPersonIds(participations));
      setCheckingIn(null);
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
    [boot, refreshStatus, shift],
  );

  /* ---------------------------------------------------------------------------
     THE WAIVER — §3.1, and step 9 of §8.5's protocol
     -------------------------------------------------------------------------- */

  const signWaiver = useCallback(
    async (
      personId: string,
      captured: CapturedSignature,
    ): Promise<string | null> => {
      const current = boot.phase === "ready" ? boot.pack : null;
      if (!current) return "This tablet has no information to sign against.";

      const registration = await deviceStore.loadRegistration();
      if (!registration) return "This device is not registered.";

      const result = buildWaiverSignature(
        current,
        {
          personId,
          /* The signature the capability service itself would see — the later of
             the pack's and this desk's. Read through `subjectFor` rather than
             recomputed, so the guard against a second row cannot disagree with
             the block the officer is looking at. */
          alreadySigned:
            subjectFor(current, personId, signedWaivers(signatures))?.waiver ??
            null,
        },
        {
          actorStaffId: actorFor(shift, new Date()),
          now: new Date(),
          captured,
        },
      );

      if (!result.ok) {
        return result.refusal.remedy
          ? `${result.refusal.reason} ${result.refusal.remedy}`
          : result.refusal.reason;
      }

      /* Local record first, queue second — the same order and the same reasoning
         as a check-in and an equipment issue. An interruption between the two
         leaves a signature on disk that can be re-queued; the other order leaves
         a queued write for a signature the desk has no memory of, and the member
         is asked to sign again for a record the club already holds. */
      await sessionStore.recordWaiverSignature(result.writes.signature);

      for (const item of result.writes.queue) {
        await outbox.enqueue({
          id: item.id,
          operation: item.operation,
          payload: item.payload,
          deviceId: registration.deviceId,
          actorStaffId: result.writes.signature.witnessedByStaffId,
        });
      }

      setSignatures(await sessionStore.waiverSignatures());
      setSigning(null);
      await refreshStatus();

      /* §2: hand it to the platform as well, so it still reaches the server if
         the desk is closed before the link returns. */
      void requestBackgroundSync();
      void syncRef.current?.();
      return null;
    },
    [boot, refreshStatus, shift, signatures],
  );

  /* ---------------------------------------------------------------------------
     THE LANE — §6.5, and step 12 of §8.5's protocol
     -------------------------------------------------------------------------- */

  /**
   * Record a card.
   *
   * The same order as every other write on this surface: the local record
   * first, the queue second. An interruption between the two leaves a card on
   * disk that can be re-queued; the other order leaves a queued write for a
   * score the lane has no memory of, and the officer enters it again.
   */
  const recordScore = useCallback(
    async (
      participationId: string,
      input: { formatId: string; keyed: string },
    ): Promise<string | null> => {
      const current = boot.phase === "ready" ? boot.pack : null;
      if (!current) return "This tablet has no information to score against.";

      const registration = await deviceStore.loadRegistration();
      if (!registration) return "This device is not registered.";

      /* Merged, not local-only: a lane tablet takes no check-ins, so the
         shooter it is scoring was almost always checked in on the desk and
         reached this device through the pack. See `mergedParticipations`. */
      const participation = mergedParticipations(current, present).find(
        (row) => row.id === participationId,
      );
      if (!participation) return "That shooter is not checked in.";

      const actorStaffId = actorFor(shift, new Date());

      const built = buildScore(
        current,
        { participation, ...input, corrects: null },
        {
          actorStaffId,
          now: new Date(),
          sessionId: participation.sessionId,
        },
      );

      if (!built.ok) {
        return built.refusal.remedy
          ? `${built.refusal.reason} ${built.refusal.remedy}`
          : built.refusal.reason;
      }

      await sessionStore.recordRound(built.writes.round);

      for (const item of built.writes.queue) {
        await outbox.enqueue({
          id: item.id,
          operation: item.operation,
          payload: item.payload,
          deviceId: registration.deviceId,
          actorStaffId,
        });
      }

      setRounds(await sessionStore.rounds());
      await refreshStatus();
      void requestBackgroundSync();
      void syncRef.current?.();
      return null;
    },
    [boot, present, refreshStatus, shift],
  );

  /**
   * Record an incident.
   *
   * Deliberately does not require a pack, a session or a live shift to have
   * been read successfully. §6.5 wants this reachable in every state the tablet
   * can be in, and the builder in src/offline/incident.ts refuses on exactly two
   * things — a category and an account of what happened. Everything else this
   * function would have insisted on is a way for a safety record not to exist.
   */
  const recordIncident = useCallback(
    async (input: {
      category: string;
      narrative: string;
      persons: readonly { personId: string; involvement: string }[];
    }): Promise<string | null> => {
      const registration = await deviceStore.loadRegistration();
      if (!registration) return "This device is not registered.";

      const actorStaffId = actorFor(shift, new Date());

      const built = buildIncident(input, {
        actorStaffId,
        now: new Date(),
        /* Null when no session is open, which §3.3 permits and which is the
           case for anything that happens before the range opens. */
        sessionId: present.find((row) => row.sessionId)?.sessionId ?? null,
      });

      if (!built.ok) {
        return built.refusal.remedy
          ? `${built.refusal.reason} ${built.refusal.remedy}`
          : built.refusal.reason;
      }

      await sessionStore.recordIncident(built.writes.incident);

      for (const item of built.writes.queue) {
        await outbox.enqueue({
          id: item.id,
          operation: item.operation,
          payload: item.payload,
          deviceId: registration.deviceId,
          actorStaffId,
        });
      }

      setIncidents(await sessionStore.incidents());
      setReportingIncident(false);
      await refreshStatus();
      void requestBackgroundSync();
      void syncRef.current?.();
      return null;
    },
    [present, refreshStatus, shift],
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
    /* §6.5. The server that issued the credential decides which surface this
       tablet is; see the note on `surface` above. */
    setSurface(result.surface);

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

  /**
   * The session this desk is working in.
   *
   * Read off an arrival rather than held separately: the pack carries
   * `sessionId` on arrivals whose session is already open, and M1's note stands
   * — a session cannot be OPENED offline, so this is the one the club opened
   * while online. See buildCheckIn.
   */
  const sessionId =
    boot.phase === "ready"
      ? (boot.pack?.pack.arrivals.find((a) => a.sessionId)?.sessionId ?? null)
      : null;

  const equipmentContext = (id: string) => ({
    actorStaffId: actorFor(shift, new Date()),
    now: new Date(),
    sessionId: id,
    override: null,
  });

  /** Enqueue a built set of writes, then re-read what is on disk. */
  const enqueueAll = async (
    queue: readonly { id: string; operation: string; payload: unknown }[],
  ) => {
    const registration = await deviceStore.loadRegistration();
    if (!registration) return;

    for (const item of queue) {
      await outbox.enqueue({
        id: item.id,
        operation: item.operation as never,
        payload: item.payload,
        deviceId: registration.deviceId,
        actorStaffId: actorFor(shift, new Date()),
      });
    }

    await refreshStatus();
    void syncRef.current?.();
  };

  /**
   * §10's gate. No live shift, no desk.
   *
   * Placed after the device gate and before Today, in that order deliberately:
   * a revoked tablet must be told it is revoked (§10) rather than asked for a
   * PIN it could never satisfy, and an unenrolled one has no officer list to
   * offer because it has no pack.
   *
   * `navigator.onLine` decides which unlock is shown. It is famously unreliable
   * — it reports a captive portal as online — and that is tolerable here because
   * the online path FAILING falls back to the same screen with the same PIN
   * already typed. The cost of guessing wrong is one refused attempt, not a
   * locked-out officer.
   */
  if (!shiftIsLive(shift, new Date())) {
    return (
      <OfficerUnlock
        staff={boot.pack?.pack.staff ?? []}
        shift={shift}
        mode={
          typeof navigator !== "undefined" && navigator.onLine
            ? "online"
            : "offline"
        }
        onSignedIn={async ({ staffUserId, pin }) => {
          const registration = await deviceStore.loadRegistration();
          const token = await deviceStore.loadToken();
          if (!registration || !token) {
            return { ok: false as const, reason: "This device is not registered." };
          }
          return unlockOfficer(token, { staffUserId, pin });
        }}
        onShiftChanged={async (next) => {
          /* Persisted before the render updates. A shift that existed only in
             memory would vanish on the force-quit an attacker would try first,
             taking the attempt count with it. */
          if (next) await officerStore.save(next);
          else await officerStore.clear();
          setShift(next);
        }}
      />
    );
  }

  /**
   * What this device did in the current session.
   *
   * Assembled once per render rather than per consumer: `closeStateFor` and
   * `endOfDay` both read it, and building it twice would let the two disagree
   * about the same evening.
   */
  const sessionState: SessionLocalState = {
    sessionId: sessionId ?? "",
    participations: present,
    firearmIssues,
    ammunitionIssues,
  };

  /**
   * Waivers signed at this desk, as the capability service reads them.
   *
   * Derived on render rather than held in state, so every decision below — the
   * Today rows, the Person detail panel, the guard inside `signWaiver` — is made
   * against one value. Two of them computing it separately is how the panel ends
   * up disagreeing with the row behind it.
   */
  const locallySigned = signedWaivers(signatures);

  const rows: ArrivalRow[] = boot.pack
    ? todayRows(
        boot.pack,
        lagosDateKey(new Date()),
        new Date(),
        checkedIn,
        locallySigned,
      )
    : [];

  /* The close guard's list, computed once. §6.4: "lists everything
     outstanding" — one list, so the officer clears it in a single pass rather
     than discovering a second item after fixing the first. */
  const outstandingItems = boot.pack
    ? outstandingList(closeStateFor(boot.pack, sessionState))
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
      ? personDetail(boot.pack, opened, new Date(), checkedIn, locallySigned)
      : null;

  /* ---------------------------------------------------------------------------
     THE LANE SURFACE — §6.5

     A different screen on the same app, chosen by the device's registration and
     not by anything on screen. It shares the boot, the device gate, the officer
     unlock, the outbox and the sync loop above, because all of those are
     properties of a registered tablet rather than of the desk — and a second
     application would have been a second copy of §10's revocation path.

     What it does NOT share is the desk's workflows. There is no check-in here,
     no person detail and no end-of-day close: §6.4 puts those at the counter,
     and a lane tablet on a post outside is not a counter.
     -------------------------------------------------------------------------- */

  if (surface === "lane") {
    const relayLanes = boot.pack
      ? relay(boot.pack, {
          participations: present,
          firearmIssues,
          rounds,
        })
      : [];

    /* The relay's own view of who is present — the pack's rows and this
       device's, merged the same way the relay merged them, so a sheet cannot
       open on a shooter the screen behind it can see and this branch cannot. */
    const laneParticipations = boot.pack
      ? mergedParticipations(boot.pack, present)
      : present;

    const pairedParticipation = pairing
      ? laneParticipations.find((row) => row.id === pairing.participationId)
      : null;

    const scoredParticipation = scoring
      ? laneParticipations.find((row) => row.id === scoring.participationId)
      : null;

    /* The bay decides the course of fire. `buildScore` refuses a mismatch, and
       offering only the right formats means the officer never meets that
       refusal in the normal path. */
    const scoreFormats = scoredParticipation
      ? formatsFor(
          boot.pack?.pack.lanes.find(
            (lane) => lane.id === scoredParticipation.laneId,
          )?.discipline ?? "",
        )
      : [];

    return (
      <div className="flex min-h-full flex-col">
        {status && (
          <SyncStatus status={status} onRetry={draining ? null : () => void sync()} />
        )}

        <header className="flex items-start gap-3 border-b border-[--color-terrazzo] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Relay</h1>
            {shift && (
              <p className="text-sm text-[--color-sight-ink]">
                {shift.displayName} on shift
              </p>
            )}
            {incidents.length > 0 && (
              <p className="text-sm text-[--color-sight-ink]">
                {incidents.length}{" "}
                {incidents.length === 1 ? "incident" : "incidents"} recorded
                today
              </p>
            )}
          </div>

          {/**
           * §6.5: "always reachable, NEVER MORE THAN ONE TAP AWAY".
           *
           * In the header, on every screen of this surface, never inside a menu
           * and never conditional on a session being open. The one control on
           * the lane that is always in the same place.
           */}
          <button
            type="button"
            onClick={() => setReportingIncident(true)}
            className="shrink-0 rounded border-2 border-[--color-ten-ring-deep] px-4 py-3 font-medium"
          >
            Incident
          </button>
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

        <Relay lanes={relayLanes} onPair={setPairing} onScore={setScoring} />

        {pairing && pairedParticipation && boot.pack && (
          <PairSheet
            shooterName={pairing.name}
            currentSerial={pairing.firearmSerial}
            onPair={async (serialNumber) => {
              const built = buildFirearmIssue(
                boot.pack!,
                { serialNumber, participation: pairedParticipation },
                equipmentContext(pairedParticipation.sessionId),
              );

              if (!built.ok) {
                return built.refusal.remedy
                  ? `${built.refusal.reason} ${built.refusal.remedy}`
                  : built.refusal.reason;
              }

              await sessionStore.recordFirearmIssue({
                custodyEventId: built.writes.custodyEventId,
                firearmId: built.writes.firearmId,
                serialNumber: built.writes.serialNumber,
                personId: pairedParticipation.personId,
                sessionId: pairedParticipation.sessionId,
                returnedAt: null,
              });
              await enqueueAll(built.writes.queue);
              setFirearmIssues(await sessionStore.firearmIssues());
              setPairing(null);
              return null;
            }}
            onReturn={async () => {
              const issue = firearmIssues.find(
                (row) =>
                  row.personId === pairing.personId && row.returnedAt === null,
              );
              if (!issue) return "This device has no firearm out to them.";

              const built = buildFirearmReturn(
                {
                  firearmId: issue.firearmId,
                  serialNumber: issue.serialNumber,
                  fromPersonId: issue.personId,
                },
                equipmentContext(issue.sessionId),
              );

              await sessionStore.markFirearmReturned(
                issue.custodyEventId,
                new Date(),
              );
              await enqueueAll(built.queue);
              setFirearmIssues(await sessionStore.firearmIssues());
              setPairing(null);
              return null;
            }}
            onCancel={() => setPairing(null)}
          />
        )}

        {scoring && scoredParticipation && (
          <ScoreSheet
            shooterName={scoring.name}
            formats={scoreFormats}
            onRecord={(input) => recordScore(scoredParticipation.id, input)}
            onCancel={() => setScoring(null)}
          />
        )}

        {reportingIncident && (
          <IncidentSheet
            shooters={relayShooters(relayLanes)}
            onRecord={recordIncident}
            onCancel={() => setReportingIncident(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* §8.4: at all times, not behind a menu. */}
      {status && (
        <SyncStatus status={status} onRetry={draining ? null : () => void sync()} />
      )}

      <header className="flex items-start gap-3 border-b border-[--color-terrazzo] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-[--color-sight-ink]">{todaySummary(rows)}</p>
          {/* §10: the officer's name is on screen while they are on shift, so
              anyone can see whose name is going on tonight's custody events. */}
          {shift && (
            <p className="text-sm text-[--color-sight-ink]">
              {shift.displayName} on shift
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setClosing(true)}
          className="shrink-0 rounded border border-[--color-reticle-black] px-3 py-2 text-sm font-medium"
        >
          End of day
        </button>
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
        /* Tap one of §6.4's three. Opens the lane sheet rather than checking in
           directly, because a check-in without a lane is the gap M1 recorded. */
        onCheckIn={(personId) =>
          setCheckingIn(rows.find((row) => row.personId === personId) ?? null)
        }
        onOpen={setOpened}
        onIssue={setEquipping}
        /* §3.1's waiver. Offered on rows where `today.ts` decided a signature is
           what stands in the way — never as a general action, because signing
           does not admit somebody blocked for another reason.
           A pack too old to carry the waiver text says so here rather than
           opening a sheet onto a blank document and refusing at the end of it. */
        onSignWaiver={(personId) => {
          if (!boot.pack?.pack.activeWaiverBody) {
            setRefusal(`${NO_WAIVER_TEXT.reason} ${NO_WAIVER_TEXT.remedy}`);
            return;
          }
          setRefusal(null);
          setSigning(personId);
        }}
      />

      {checkingIn && boot.pack && (
        <CheckInSheet
          name={checkingIn.name}
          lanes={lanesFor(boot.pack, checkingIn.discipline, present)}
          suggested={suggestLane(
            lanesFor(boot.pack, checkingIn.discipline, present),
          )}
          noLaneReason={
            suggestLane(lanesFor(boot.pack, checkingIn.discipline, present))
              ? null
              : noLaneReason(
                  lanesFor(boot.pack, checkingIn.discipline, present),
                  checkingIn.discipline,
                )
          }
          overridable={checkingIn.overridable}
          blockedLine={checkingIn.line || null}
          onConfirm={({ laneId, override }) =>
            void checkIn(checkingIn.personId, laneId, override)
          }
          onCancel={() => setCheckingIn(null)}
        />
      )}

      {/**
       * §3.1's waiver, signed at the desk.
       *
       * Rendered only when the pack carries the text. `buildWaiverSignature`
       * refuses in that case too — a document cannot be signed without being
       * shown — but a sheet that opened onto an empty page and then refused on
       * Confirm would waste a member's time to say what the row can say now.
       */}
      {signing && boot.pack?.pack.activeWaiverBody && (
        <WaiverSheet
          name={
            rows.find((row) => row.personId === signing)?.name ?? "This person"
          }
          version={boot.pack.pack.activeWaiverVersion ?? "current"}
          body={boot.pack.pack.activeWaiverBody}
          onSign={(captured) => signWaiver(signing, captured)}
          onCancel={() => setSigning(null)}
        />
      )}

      {detail && <PersonDetail view={detail} onClose={() => setOpened(null)} />}

      {equipping && boot.pack && sessionId && (
        <EquipmentSheet
          name={
            rows.find((row) => row.personId === equipping)?.name ?? "This shooter"
          }
          lots={boot.pack.pack.ammunitionLots}
          issued={firearmIssues.filter((row) => row.personId === equipping)}
          ammunition={ammunitionIssues.filter((row) =>
            present.some(
              (p) => p.id === row.participationId && p.personId === equipping,
            ),
          )}
          onIssueFirearm={async (serialNumber) => {
            const participation = present.find(
              (p) => p.personId === equipping && p.checkedOutAt === null,
            );
            if (!participation) return "That shooter is not checked in.";

            const built = buildFirearmIssue(
              boot.pack!,
              { serialNumber, participation },
              equipmentContext(sessionId),
            );
            if (!built.ok) {
              return built.refusal.remedy
                ? `${built.refusal.reason} ${built.refusal.remedy}`
                : built.refusal.reason;
            }

            /* Local record first, queue second — the same order and the same
               reasoning as a check-in. An interruption between them leaves a
               record that can be re-queued; the other order leaves a queued
               write for something the desk has no memory of. */
            await sessionStore.recordFirearmIssue({
              custodyEventId: built.writes.custodyEventId,
              firearmId: built.writes.firearmId,
              serialNumber: built.writes.serialNumber,
              personId: participation.personId,
              sessionId,
              returnedAt: null,
            });
            await enqueueAll(built.writes.queue);
            setFirearmIssues(await sessionStore.firearmIssues());
            return null;
          }}
          onReturnFirearm={(issue) => {
            void (async () => {
              const built = buildFirearmReturn(
                {
                  firearmId: issue.firearmId,
                  serialNumber: issue.serialNumber,
                  fromPersonId: issue.personId,
                },
                equipmentContext(sessionId),
              );
              await sessionStore.markFirearmReturned(
                issue.custodyEventId,
                new Date(),
              );
              await enqueueAll(built.queue);
              setFirearmIssues(await sessionStore.firearmIssues());
            })();
          }}
          onIssueAmmunition={async ({ lotId, qty }) => {
            const participation = present.find(
              (p) => p.personId === equipping && p.checkedOutAt === null,
            );
            if (!participation) return "That shooter is not checked in.";

            const built = buildAmmunitionIssue(
              boot.pack!,
              { lotId, participation, qtyIssued: qty },
              equipmentContext(sessionId),
            );
            if (!built.ok) {
              return built.refusal.remedy
                ? `${built.refusal.reason} ${built.refusal.remedy}`
                : built.refusal.reason;
            }

            await sessionStore.recordAmmunitionIssue({
              issueId: built.writes.issueId,
              participationId: participation.id,
              lotId: built.writes.lotId,
              qtyIssued: built.writes.qtyIssued,
              qtyFired: null,
              qtyReturned: null,
            });
            await enqueueAll(built.writes.queue);
            setAmmunitionIssues(await sessionStore.ammunitionIssues());
            return null;
          }}
          onClose={() => setEquipping(null)}
        />
      )}

      {closing && boot.pack && sessionId && (
        <EndOfDay
          view={endOfDay(boot.pack, [sessionState], status?.depth ?? 0)}
          outstanding={outstandingItems}
          unreconciled={ammunitionIssues.filter(
            (row) => row.qtyFired === null || row.qtyReturned === null,
          )}
          shooterFor={(participationId) => {
            const participation = present.find((p) => p.id === participationId);
            const person = participation
              ? boot.pack!.personById.get(participation.personId)
              : undefined;
            return person
              ? `${person.firstName} ${person.lastName}`
              : "This shooter";
          }}
          onReconcile={async ({ issue, qtyFired, qtyReturned }) => {
            const built = buildAmmunitionReconcile({
              issueId: issue.issueId,
              qtyIssued: issue.qtyIssued,
              qtyFired,
              qtyReturned,
            });

            if (!built.ok) {
              /* Refused for not balancing. The counts are NOT stored — an
                 unbalanced figure recorded as final is the one thing §3.4 is
                 written to prevent, and the officer is told which way it is
                 out so they can count again. */
              return built.refusal.remedy
                ? `${built.refusal.reason} ${built.refusal.remedy}`
                : built.refusal.reason;
            }

            await sessionStore.reconcileAmmunition(issue.issueId, {
              qtyFired,
              qtyReturned,
            });
            await enqueueAll(built.writes.queue);
            setAmmunitionIssues(await sessionStore.ammunitionIssues());
            return null;
          }}
          onClose={(override) => {
            void (async () => {
              const built = buildSessionClose(boot.pack!, sessionState, {
                actorStaffId: actorFor(shift, new Date()),
                now: new Date(),
                override,
              });

              if (!built.ok) {
                setRefusal(built.refusal.reason);
                return;
              }

              await enqueueAll(built.queue);
              setClosing(false);
            })();
          }}
          onDismiss={() => setClosing(false)}
        />
      )}
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


/**
 * Flatten a close state into the sentences §6.4 asks the screen to list.
 *
 * The same three groups `sessionTransition` produces, in the same order, so an
 * officer sees the identical wording whether the close was attempted or the
 * screen is merely showing what stands in the way.
 */
function outstandingList(state: {
  unreturnedFirearms: readonly string[];
  unreconciledAmmunition: readonly string[];
  missingCheckouts: readonly string[];
}): string[] {
  return [
    ...state.unreturnedFirearms.map((serial) => `Firearm ${serial} is still out`),
    ...state.unreconciledAmmunition.map((item) => `${item} is unreconciled`),
    ...state.missingCheckouts.map((name) => `${name} has not checked out`),
  ];
}
