import type { OutboxItem, OutboxStore } from "./outbox";

/**
 * IN-MEMORY OUTBOX STORE — TESTS ONLY.
 *
 * ⚠ This store is not durable and must never be wired to the desk or the lane.
 * §8.4 requires the queue to survive "tab close, app close, device restart and
 * power loss", and this survives none of them. It exists so the ordering,
 * backoff and quarantine rules can be tested by calling functions rather than
 * by driving a browser.
 *
 * The name says `memory` and this comment says the rest, because the failure
 * mode of picking the wrong store is silent: everything works in development,
 * on a desk with mains power and wifi, right up until the afternoon it does
 * not.
 *
 * Structured-clones on the way in and out, so a test cannot accidentally hold
 * a live reference into the store and mutate an item the queue believes it
 * owns — which a real IndexedDB would never allow either.
 */
export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, OutboxItem>();
  private lastSyncAt: Date | null = null;

  private static clone(item: OutboxItem): OutboxItem {
    return {
      ...item,
      createdAt: new Date(item.createdAt),
      nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt) : null,
    };
  }

  async put(item: OutboxItem): Promise<void> {
    this.items.set(item.id, MemoryOutboxStore.clone(item));
  }

  async get(id: string): Promise<OutboxItem | null> {
    const found = this.items.get(id);
    return found ? MemoryOutboxStore.clone(found) : null;
  }

  async all(): Promise<OutboxItem[]> {
    return [...this.items.values()].map(MemoryOutboxStore.clone);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  async getLastSyncAt(): Promise<Date | null> {
    return this.lastSyncAt ? new Date(this.lastSyncAt) : null;
  }

  async setLastSyncAt(at: Date): Promise<void> {
    this.lastSyncAt = new Date(at);
  }
}
