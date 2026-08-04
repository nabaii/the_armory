/**
 * SLOT GENERATION.
 *
 * Turns the weekly session templates in src/content/booking.ts into concrete,
 * dated slots over a rolling horizon. Pure and deterministic — given the same
 * `now`, it returns the same slots, which is what makes it testable and what
 * makes slot IDs stable between the page render and the submission.
 *
 * Slot IDs are the local WAT date and time, e.g. `2026-08-07T18:00`. Chosen
 * deliberately over an opaque identifier: it is human-readable in a calendar
 * entry, in an email, and in a support conversation, and it cannot drift from
 * the time it represents.
 */

import {
  WAT_OFFSET_HOURS,
  bookingConfig,
  type SessionTemplate,
} from "@/content/booking";

/**
 * Exactly what slot generation needs — not the whole booking config.
 *
 * Narrowed deliberately: pricing and the refund-policy version have nothing to
 * do with when sessions fall, and demanding them would make this function
 * impossible to test against a fixed schedule without also inventing a price.
 */
export type SlotConfig = {
  readonly sessions: readonly SessionTemplate[];
  readonly leadTimeHours: number;
  readonly horizonDays: number;
};

export type Slot = {
  /** `YYYY-MM-DDTHH:MM` in WAT. Stable and meaningful. */
  id: string;
  /** Absolute instant, for calendars and reminders. */
  startsAt: Date;
  /** "Thursday 7 August, 6:00 pm" */
  label: string;
  /** Date part only, for grouping in the picker. */
  dateLabel: string;
  /** "6:00 pm" */
  timeLabel: string;
  capacity: number;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Local WAT calendar parts for an instant.
 *
 * Uses UTC getters against a shifted timestamp rather than the host's local
 * getters. The server's timezone is not the club's, and on a Vercel or
 * Cloudflare deployment it is almost certainly UTC or a US region — reading
 * `getHours()` there would generate sessions in the wrong hours entirely.
 */
function watParts(instant: Date) {
  const shifted = new Date(instant.getTime() + WAT_OFFSET_HOURS * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** Absolute instant for a WAT wall-clock time. */
function watInstant(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  return new Date(
    Date.UTC(year, month, day, hours - WAT_OFFSET_HOURS, minutes, 0, 0),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function formatTime(hours: number, minutes: number): string {
  const period = hours >= 12 ? "pm" : "am";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${twelve}:00 ${period}`
    : `${twelve}:${pad(minutes)} ${period}`;
}

export function generateSlots(
  now: Date = new Date(),
  config: SlotConfig = bookingConfig,
): Slot[] {
  const earliest = now.getTime() + config.leadTimeHours * 3_600_000;
  const latest = now.getTime() + config.horizonDays * 86_400_000;

  const slots: Slot[] = [];
  const today = watParts(now);

  /* Walk forward day by day in WAT and emit any session matching that weekday.
     Iterating days rather than weeks keeps month and year rollover correct
     without arithmetic on week numbers. */
  for (let offset = 0; offset <= config.horizonDays; offset += 1) {
    const dayCursor = watInstant(
      today.year,
      today.month,
      today.day + offset,
      12,
      0,
    );
    const parts = watParts(dayCursor);

    for (const session of config.sessions) {
      if (session.weekday !== parts.weekday) continue;

      const [hours, minutes] = parseStart(session);
      const startsAt = watInstant(
        parts.year,
        parts.month,
        parts.day,
        hours,
        minutes,
      );
      const time = startsAt.getTime();

      if (time < earliest || time > latest) continue;

      const dateLabel = `${WEEKDAYS[parts.weekday]} ${parts.day} ${MONTHS[parts.month]}`;
      const timeLabel = formatTime(hours, minutes);

      slots.push({
        id: `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(hours)}:${pad(minutes)}`,
        startsAt,
        label: `${dateLabel}, ${timeLabel}`,
        dateLabel,
        timeLabel,
        capacity: session.capacity,
      });
    }
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function parseStart(session: SessionTemplate): [number, number] {
  const [h, m] = session.start.split(":");
  return [Number.parseInt(h, 10), Number.parseInt(m ?? "0", 10)];
}

/** Look up a slot by id, so a submitted slot is always re-derived, never trusted. */
export function findSlot(
  slotId: string,
  now: Date = new Date(),
  config: SlotConfig = bookingConfig,
): Slot | null {
  return generateSlots(now, config).find((s) => s.id === slotId) ?? null;
}

/** Grouped by date, for the picker UI. */
export function groupSlotsByDate(slots: readonly Slot[]) {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const existing = groups.get(slot.dateLabel);
    if (existing) existing.push(slot);
    else groups.set(slot.dateLabel, [slot]);
  }
  return [...groups.entries()].map(([dateLabel, items]) => ({
    dateLabel,
    slots: items,
  }));
}
