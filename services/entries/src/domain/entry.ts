import { uuidv7 } from '../shared/uuidv7';
import { DomainError } from '../shared/errors';
import { businessDate, isValidDate } from '../shared/business-date';

export type EntryType = 'CREDIT' | 'DEBIT';
export const ENTRY_TYPES: readonly EntryType[] = ['CREDIT', 'DEBIT'];

/** Sanity cap per entry (R$ 10 million), to catch typos. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;
/** Backdated entries are accepted within this window (configurable business rule). */
export const BACKDATE_WINDOW_DAYS = 30;

export interface NewEntry {
  merchantId: string;
  type: string;
  amountCents: number;
  description?: string;
  entryDate?: string;
  idempotencyKey?: string;
}

/**
 * Entry is immutable. A correction is a new entry in the opposite direction
 * (reversal), which keeps the audit trail intact.
 */
export class Entry {
  private constructor(
    readonly id: string,
    readonly merchantId: string,
    readonly type: EntryType,
    readonly amountCents: number,
    readonly description: string,
    readonly entryDate: string,
    readonly createdAt: Date,
    readonly idempotencyKey?: string,
  ) {}

  static create(input: NewEntry, now: Date, timezone: string): Entry {
    if (!input.merchantId) {
      throw new DomainError('MERCHANT_REQUIRED', 'Merchant is required');
    }
    if (!ENTRY_TYPES.includes(input.type as EntryType)) {
      throw new DomainError('INVALID_TYPE', 'Type must be CREDIT or DEBIT');
    }
    // Money as integer cents, never floating point
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new DomainError('INVALID_AMOUNT', 'Amount must be a positive integer in cents');
    }
    if (input.amountCents > MAX_AMOUNT_CENTS) {
      throw new DomainError('AMOUNT_ABOVE_LIMIT', 'Amount above the allowed limit');
    }
    const description = (input.description ?? '').trim();
    if (description.length > 140) {
      throw new DomainError('DESCRIPTION_TOO_LONG', 'Description must be at most 140 characters');
    }

    const today = businessDate(now, timezone);
    const date = input.entryDate ?? today;
    if (!isValidDate(date)) {
      throw new DomainError('INVALID_DATE', 'Date must be in YYYY-MM-DD format');
    }
    if (date > today) {
      throw new DomainError('FUTURE_DATE', 'Entries cannot be dated in the future');
    }
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - BACKDATE_WINDOW_DAYS);
    if (date < cutoff.toISOString().slice(0, 10)) {
      throw new DomainError('DATE_OUT_OF_WINDOW', `Backdated entries are accepted up to ${BACKDATE_WINDOW_DAYS} days`);
    }

    return new Entry(
      uuidv7(now.getTime()),
      input.merchantId,
      input.type as EntryType,
      input.amountCents,
      description,
      date,
      now,
      input.idempotencyKey,
    );
  }

  static restore(p: {
    id: string;
    merchantId: string;
    type: EntryType;
    amountCents: number;
    description: string;
    entryDate: string;
    createdAt: Date;
    idempotencyKey?: string;
  }): Entry {
    return new Entry(
      p.id,
      p.merchantId,
      p.type,
      p.amountCents,
      p.description,
      p.entryDate,
      p.createdAt,
      p.idempotencyKey,
    );
  }

  /** Integration event published to the other contexts (versioned contract). */
  toEvent(): EntryRecordedEvent {
    return {
      eventId: uuidv7(),
      eventType: 'EntryRecorded',
      eventVersion: 1,
      occurredAt: this.createdAt.toISOString(),
      data: {
        entryId: this.id,
        merchantId: this.merchantId,
        type: this.type,
        amountCents: this.amountCents,
        entryDate: this.entryDate,
      },
    };
  }
}

export interface EntryRecordedEvent {
  eventId: string;
  eventType: 'EntryRecorded';
  eventVersion: 1;
  occurredAt: string;
  data: {
    entryId: string;
    merchantId: string;
    type: EntryType;
    amountCents: number;
    entryDate: string;
  };
}
