import { Entry, EntryRecordedEvent } from '../domain/entry';

/** Persistence port (hexagonal architecture). */
export interface EntryRepository {
  /**
   * Persists the entry AND the outbox event in the SAME transaction.
   * Throws DuplicateIdempotencyKeyError if the key already exists for the merchant.
   */
  saveWithEvent(entry: Entry, event: EntryRecordedEvent): Promise<void>;
  findById(merchantId: string, id: string): Promise<Entry | null>;
  findByIdempotencyKey(merchantId: string, key: string): Promise<Entry | null>;
  listByDate(merchantId: string, date: string, limit: number, afterId?: string): Promise<Entry[]>;
}

export interface OutboxMessage {
  id: string;
  key: string;
  payload: EntryRecordedEvent;
}

export interface OutboxRepository {
  /** Reserves (lock with expiry) a batch of pending events for this worker. */
  reserveBatch(workerId: string, size: number, lockMs: number): Promise<OutboxMessage[]>;
  markPublished(ids: string[]): Promise<void>;
  release(ids: string[]): Promise<void>;
}

/** Messaging port. Pub/Sub today; the application does not know what is behind it. */
export interface EventPublisher {
  publish(messages: OutboxMessage[]): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const ENTRY_REPOSITORY = Symbol('ENTRY_REPOSITORY');
export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
export const CLOCK = Symbol('CLOCK');
