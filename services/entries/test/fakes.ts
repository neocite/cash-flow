import { EventPublisher, EntryRepository, OutboxMessage, OutboxRepository } from '../src/application/ports';
import { Entry, EntryRecordedEvent } from '../src/domain/entry';
import { config } from '../src/shared/config';
import { DuplicateIdempotencyKeyError } from '../src/shared/errors';

export const testConfig = () => ({ ...config(), timezone: 'America/Sao_Paulo' });

export class InMemoryRepository implements EntryRepository, OutboxRepository {
  entries: Entry[] = [];
  outbox: (OutboxMessage & { published: boolean; locked: boolean })[] = [];

  async saveWithEvent(entry: Entry, event: EntryRecordedEvent) {
    if (
      entry.idempotencyKey &&
      this.entries.some((x) => x.merchantId === entry.merchantId && x.idempotencyKey === entry.idempotencyKey)
    ) {
      throw new DuplicateIdempotencyKeyError();
    }
    this.entries.push(entry);
    this.outbox.push({
      id: event.eventId,
      key: `${entry.merchantId}:${entry.entryDate}`,
      payload: event,
      published: false,
      locked: false,
    });
  }
  async findById(merchantId: string, id: string) {
    return this.entries.find((e) => e.merchantId === merchantId && e.id === id) ?? null;
  }
  async findByIdempotencyKey(merchantId: string, key: string) {
    return this.entries.find((e) => e.merchantId === merchantId && e.idempotencyKey === key) ?? null;
  }
  async listByDate(merchantId: string, date: string, limit: number, afterId?: string) {
    return this.entries
      .filter((e) => e.merchantId === merchantId && e.entryDate === date && (!afterId || e.id > afterId))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit);
  }
  async reserveBatch(_workerId: string, size: number) {
    const batch = this.outbox.filter((m) => !m.published && !m.locked).slice(0, size);
    batch.forEach((m) => (m.locked = true));
    return batch.map(({ id, key, payload }) => ({ id, key, payload }));
  }
  async markPublished(ids: string[]) {
    this.outbox.filter((m) => ids.includes(m.id)).forEach((m) => ((m.published = true), (m.locked = false)));
  }
  async release(ids: string[]) {
    this.outbox.filter((m) => ids.includes(m.id)).forEach((m) => (m.locked = false));
  }
}

export class FakePublisher implements EventPublisher {
  published: OutboxMessage[] = [];
  down = false;
  async publish(messages: OutboxMessage[]) {
    if (this.down) throw new Error('broker unavailable');
    this.published.push(...messages);
  }
}
