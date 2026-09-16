import { datesInRange, InvalidEventError, parseEvent } from '../src/domain/daily-balance';
import { event } from './fakes';

describe('DailyBalance (domain)', () => {
  it('turns credits and debits into deltas', () => {
    expect(parseEvent(event('CREDIT', 1000))).toMatchObject({ creditsCents: 1000, debitsCents: 0, date: '2026-09-16' });
    expect(parseEvent(event('DEBIT', 300))).toMatchObject({ creditsCents: 0, debitsCents: 300 });
  });

  it.each([
    ['null', null],
    ['unknown event type', { ...event('CREDIT', 1), eventType: 'Other' }],
    ['unsupported version', { ...event('CREDIT', 1), eventVersion: 2 }],
    ['negative amount', event('CREDIT', -1)],
    ['fractional amount', event('CREDIT', 1.5)],
    ['invalid date', event('CREDIT', 1, '2026-13-01')],
    ['invalid type', event('PIX' as never, 1)],
  ])('rejects a %s event as not retryable', (_name, e) => {
    expect(() => parseEvent(e)).toThrow(InvalidEventError);
  });

  it('builds the inclusive date range across months', () => {
    expect(datesInRange('2026-08-30', '2026-09-02', 31)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('caps the range size and validates the order', () => {
    expect(() => datesInRange('2026-01-01', '2026-03-01', 31)).toThrow('Maximum range');
    expect(() => datesInRange('2026-09-02', '2026-09-01', 31)).toThrow('earlier');
  });
});
