import { isValidDate } from '../shared/business-date';
import { DomainError } from '../shared/errors';

/** Consumed contract: mirror of the event published by the Entries context. */
export interface EntryRecordedEvent {
  eventId: string;
  eventType: 'EntryRecorded';
  eventVersion: number;
  occurredAt: string;
  data: {
    entryId: string;
    merchantId: string;
    type: 'CREDIT' | 'DEBIT';
    amountCents: number;
    entryDate: string;
  };
}

export interface DailyBalance {
  merchantId: string;
  date: string;
  totalCreditsCents: number;
  totalDebitsCents: number;
  balanceCents: number;
  entryCount: number;
  updatedAt: Date | null;
}

/** Delta to apply to a day's balance. Commutative, so arrival order does not matter. */
export interface BalanceDelta {
  eventId: string;
  merchantId: string;
  date: string;
  creditsCents: number;
  debitsCents: number;
}

/** An invalid event is not worth retrying. */
export class InvalidEventError extends DomainError {}

export function parseEvent(raw: unknown): BalanceDelta {
  const e = raw as Partial<EntryRecordedEvent> | null;
  const d = e?.data;
  if (!e || e.eventType !== 'EntryRecorded' || typeof e.eventId !== 'string' || !d) {
    throw new InvalidEventError('INVALID_EVENT', 'Unknown or malformed event');
  }
  if (e.eventVersion !== 1) {
    throw new InvalidEventError('UNSUPPORTED_VERSION', `Version ${e.eventVersion} is not supported`);
  }
  if (!Number.isSafeInteger(d.amountCents) || (d.amountCents as number) <= 0) {
    throw new InvalidEventError('INVALID_AMOUNT', 'invalid amountCents');
  }
  if (typeof d.entryDate !== 'string' || !isValidDate(d.entryDate) || !d.merchantId) {
    throw new InvalidEventError('INVALID_DATA', 'invalid date or merchant');
  }
  if (d.type !== 'CREDIT' && d.type !== 'DEBIT') {
    throw new InvalidEventError('INVALID_TYPE', 'invalid type');
  }
  return {
    eventId: e.eventId,
    merchantId: d.merchantId,
    date: d.entryDate,
    creditsCents: d.type === 'CREDIT' ? d.amountCents : 0,
    debitsCents: d.type === 'DEBIT' ? d.amountCents : 0,
  };
}

export function emptyBalance(merchantId: string, date: string): DailyBalance {
  return {
    merchantId,
    date,
    totalCreditsCents: 0,
    totalDebitsCents: 0,
    balanceCents: 0,
    entryCount: 0,
    updatedAt: null,
  };
}

/** Builds the list of dates in the range [from, to] (inclusive). */
export function datesInRange(from: string, to: string, maxDays: number): string[] {
  if (!isValidDate(from) || !isValidDate(to)) {
    throw new DomainError('INVALID_DATE', 'Dates must be in YYYY-MM-DD format');
  }
  if (from > to) throw new DomainError('INVALID_RANGE', '"from" must be earlier than or equal to "to"');
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= to) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > maxDays) {
      throw new DomainError('RANGE_TOO_LONG', `Maximum range is ${maxDays} days`);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
