import {
  evaluateDeviceTrust,
  isDayPackUsable,
  type DeviceClock,
  type DeviceRegistration,
  type ServerVerdict,
} from "./device";
import { REVOKED_MESSAGE } from "./revoke";

/**
 * WHAT THE CONSOLE DOES WHEN IT OPENS — §3.1, §8, §10.
 *
 * Three facts arrive at launch and have to be turned into one screen:
 *
 *   · whether this device is still trusted (§3.1, §10)
 *   · whether its day pack is fresh enough to run a session from (§8.1)
 *   · whether the browser has agreed to keep any of it (§2)
 *
 * They pull in different directions and the order matters, so the decision is a
 * pure function here rather than a sequence of `if` statements inside a component.
 * The alternative puts §10's revocation logic in a React effect, where it is
 * reachable only by rendering, and where the case that matters most — a stolen
 * tablet opened by someone who should not have it — is the hardest to test.
 *
 * ===========================================================================
 * THE ORDER IS THE POLICY
 *
 * 1. TRUST, first and alone. A revoked device is wiped before anything else is
 *    read, and a refused device is told why and shown nothing. Checking pack
 *    freshness first would mean a stolen tablet with a stale pack got the friendly
 *    "download today's information" screen.
 *
 * 2. Then freshness. A trusted device with a pack from last week may open — an
 *    officer needs to see the sync status and press retry — but it must not be
 *    able to run a session from data that predates whatever has been issued since.
 *
 * 3. Then storage. A device the browser has not granted persistent storage to is
 *    working without the guarantee §8 makes, and the officer is told, because the
 *    failure mode is silent and total: the browser clears the origin under
 *    pressure and the queue goes with it.
 */

/** One line of chrome. §4.3: never a code, never a stack of conditions. */
export type Notice = {
  tone: "warning" | "info";
  line: string;
};

export type ConsoleGate =
  /**
   * The console does not open.
   *
   * `wipe` distinguishes the two reasons. §10's revocation destroys local state;
   * a merely stale device keeps everything, because it may be perfectly legitimate
   * and simply cut off, and wiping it would throw away an unsynced afternoon of
   * custody events.
   */
  | {
      open: false;
      wipe: boolean;
      heading: string;
      body: string;
      remedy: string | null;
    }
  | {
      open: true;
      /**
       * Whether a session may be run from what is on disk.
       *
       * False still opens the console: the officer has to be able to see why and
       * retry. It gates the workflows, not the screen.
       */
      canRunSession: boolean;
      /** Always shown, in order. §8.4: "Silent queues are how data is lost." */
      notices: readonly Notice[];
    };

export type BootFacts = {
  registration: DeviceRegistration | null;
  verdict: ServerVerdict;
  clock: DeviceClock;
  /** When the pack on this device was produced, per its own `pulledAt`. */
  packPulledAt: Date | null;
  /** Whether `navigator.storage.persist()` was granted. §2. */
  storagePersistent: boolean;
};

export function resolveConsoleGate(facts: BootFacts): ConsoleGate {
  const trust = evaluateDeviceTrust(facts.registration, facts.verdict, facts.clock);

  if (trust.action === "wipe") {
    return {
      open: false,
      wipe: true,
      heading: REVOKED_MESSAGE.heading,
      body: REVOKED_MESSAGE.body,
      remedy: null,
    };
  }

  if (trust.action === "refuse") {
    return {
      open: false,
      wipe: false,
      heading: "This device cannot open the desk.",
      body: trust.reason,
      remedy: trust.remedy,
    };
  }

  const pack = isDayPackUsable(facts.packPulledAt, facts.clock.now);
  const notices: Notice[] = [];

  /* The device's own standing first: an officer who is about to lose the desk in
     two days needs that before anything about today's data. */
  if (trust.warning) notices.push({ tone: "warning", line: trust.warning });

  notices.push({ tone: pack.usable ? "info" : "warning", line: pack.line });

  if (!facts.storagePersistent) {
    /**
     * §2: "Survives tab close, app close, device restart and power loss."
     *
     * Without persistent storage the browser may evict this origin whenever it
     * wants the space, taking the day pack and every queued custody event with it
     * and telling nobody. That is not a degraded mode of the offline guarantee —
     * it is the absence of one, and an officer working a range floor on a device
     * in that state should know before they rely on it.
     */
    notices.push({
      tone: "warning",
      line:
        "This device has not promised to keep information offline. Install the " +
        "app to the home screen, or work online today.",
    });
  }

  return { open: true, canRunSession: pack.usable, notices };
}
