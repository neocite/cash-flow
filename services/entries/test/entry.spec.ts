import { Entry } from '../src/domain/entry';
import { DomainError } from '../src/shared/errors';

const TZ = 'America/Sao_Paulo';
// 2026-09-16 01:30 UTC is 2026-09-15 22:30 in Sao Paulo
const NOW = new Date('2026-09-16T01:30:00Z');

const base = { merchantId: 'm1', type: 'CREDIT', amountCents: 1050 };

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
}

describe('Entry (domain)', () => {
  it('creates a valid credit using the business date of the merchant timezone', () => {
    const entry = Entry.create(base, NOW, TZ);
    expect(entry.entryDate).toBe('2026-09-15');
    expect(entry.amountCents).toBe(1050);
    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUID v7
  });

  it.each([
    [{ type: 'PIX' }, 'INVALID_TYPE'],
    [{ amountCents: 0 }, 'INVALID_AMOUNT'],
    [{ amountCents: -10 }, 'INVALID_AMOUNT'],
    [{ amountCents: 10.5 }, 'INVALID_AMOUNT'],
    [{ amountCents: 1_000_000_001 }, 'AMOUNT_ABOVE_LIMIT'],
    [{ entryDate: '15/09/2026' }, 'INVALID_DATE'],
    [{ entryDate: '2026-02-30' }, 'INVALID_DATE'],
    [{ entryDate: '2026-09-16' }, 'FUTURE_DATE'],
    [{ entryDate: '2026-08-01' }, 'DATE_OUT_OF_WINDOW'],
    [{ description: 'x'.repeat(141) }, 'DESCRIPTION_TOO_LONG'],
    [{ merchantId: '' }, 'MERCHANT_REQUIRED'],
  ])('rejects %p with %s', (override, code) => {
    expect(errorCode(() => Entry.create({ ...base, ...override } as never, NOW, TZ))).toBe(code);
  });

  it('accepts a backdated entry inside the window', () => {
    const entry = Entry.create({ ...base, type: 'DEBIT', entryDate: '2026-09-01' }, NOW, TZ);
    expect(entry.entryDate).toBe('2026-09-01');
  });

  it('emits a versioned integration event with what the balance context needs', () => {
    const entry = Entry.create(base, NOW, TZ);
    const event = entry.toEvent();
    expect(event).toMatchObject({
      eventType: 'EntryRecorded',
      eventVersion: 1,
      data: { entryId: entry.id, merchantId: 'm1', type: 'CREDIT', amountCents: 1050, entryDate: '2026-09-15' },
    });
    expect(event.eventId).not.toBe(entry.toEvent().eventId);
  });
});
