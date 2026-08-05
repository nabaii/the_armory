"use client";

import type { TournamentConfig, Turn } from "@/server/tournament/engine";

/**
 * LIVE SCREEN STATE — local, durable, and shared between tabs.
 *
 * ===========================================================================
 * §5: "RUNS OFFLINE. Must not depend on internet connectivity to display a
 * live tournament."
 *
 * So the tournament lives entirely in the browser. The engine is pure, so
 * replaying a handful of turns costs nothing and needs no server. Nothing here
 * makes a network request; a dropped connection mid-tournament changes nothing
 * about what the room sees.
 *
 * TWO STORAGE CONCERNS, BOTH REAL:
 *
 * 1. DURABILITY. A tournament that vanishes on a refresh, a browser crash or an
 *    accidental tab close — with eight people watching and four rounds
 *    completed — is the worst failure this product can have. Every change is
 *    written to localStorage synchronously, so recovery is a reload.
 *
 * 2. TWO SCREENS, ONE TRUTH. The usual setup is a laptop driving a television
 *    over HDMI, with the range officer entering scores on the same machine.
 *    `BroadcastChannel` keeps a control tab and a display tab in step without a
 *    server, which keeps the offline guarantee intact.
 *
 *    A separate tablet on the same Wi-Fi would need a LAN service and is out of
 *    scope here — noted in the gate as part of the live-screen decision.
 *
 * ===========================================================================
 * SHAPED AS AN EXTERNAL STORE
 *
 * Exposed as `subscribe` / `getSnapshot` so the component can use
 * `useSyncExternalStore` rather than reading localStorage in an effect. That is
 * the correct primitive for this — it handles the server/client hydration
 * boundary, and it avoids the render-then-correct flash an effect would give on
 * a screen someone is watching.
 *
 * `getSnapshot` MUST be referentially stable between real changes, or React
 * re-renders forever. The raw string is cached and re-parsed only when it
 * actually differs.
 * ===========================================================================
 */

export type ScreenSession = {
  config: TournamentConfig;
  turns: Turn[];
  /** Bumped on every write so a stale tab can tell it is behind. */
  revision: number;
};

const KEY = "armory.tournament.v1";
const CHANNEL = "armory.tournament";

/* ---------------------------------------------------------------------------
   SNAPSHOT
   -------------------------------------------------------------------------- */

let cachedRaw: string | null = null;
let cachedSession: ScreenSession | null = null;

function parse(raw: string | null): ScreenSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ScreenSession;
    /* A shape check rather than blind trust: a half-written or
       previous-version payload must not take the screen down mid-event. */
    if (!parsed?.config?.players || !Array.isArray(parsed.turns)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSnapshot(): ScreenSession | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* Private mode or blocked storage — treated as an empty screen. */
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSession = parse(raw);
  }
  return cachedSession;
}

/** There is no tournament on the server; the screen is a client-only surface. */
export const getServerSnapshot = (): ScreenSession | null => null;

/* ---------------------------------------------------------------------------
   WRITES
   -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function saveSession(session: ScreenSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* Quota or private mode. In-memory state still drives the screen, so the
       tournament continues — it simply will not survive a reload. */
  }
  notify();
  getChannel()?.postMessage(session.revision);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
  getChannel()?.postMessage(0);
}

/* ---------------------------------------------------------------------------
   SUBSCRIPTION — same tab, and across tabs.
   -------------------------------------------------------------------------- */

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

export function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  const ch = getChannel();
  const onMessage = () => onStoreChange();
  ch?.addEventListener("message", onMessage);

  /* `storage` fires for OTHER tabs even where BroadcastChannel is unavailable,
     so the two together cover every browser this will run on. */
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onStoreChange);
    ch?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}
