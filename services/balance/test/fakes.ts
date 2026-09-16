import { BalanceRepository } from '../src/application/ports';
import { BalanceDelta, DailyBalance } from '../src/domain/daily-balance';

export class InMemoryBalanceRepository implements BalanceRepository {
  processed = new Set<string>();
  balances = new Map<string, DailyBalance>();
  down = false;

  async apply(delta: BalanceDelta) {
    if (this.down) throw new Error('mongo unavailable');
    if (this.processed.has(delta.eventId)) return false;
    this.processed.add(delta.eventId);
    const k = `${delta.merchantId}:${delta.date}`;
    const b = this.balances.get(k) ?? {
      merchantId: delta.merchantId,
      date: delta.date,
      totalCreditsCents: 0,
      totalDebitsCents: 0,
      balanceCents: 0,
      entryCount: 0,
      updatedAt: null,
    };
    b.totalCreditsCents += delta.creditsCents;
    b.totalDebitsCents += delta.debitsCents;
    b.balanceCents = b.totalCreditsCents - b.totalDebitsCents;
    b.entryCount += 1;
    b.updatedAt = new Date();
    this.balances.set(k, b);
    return true;
  }

  async findRange(merchantId: string, from: string, to: string) {
    return [...this.balances.values()]
      .filter((b) => b.merchantId === merchantId && b.date >= from && b.date <= to)
      .map((b) => ({ ...b }));
  }
}

let seq = 0;
export const event = (
  type: 'CREDIT' | 'DEBIT',
  amountCents: number,
  entryDate = '2026-09-16',
  merchantId = 'm1',
) => ({
  eventId: `evt-${++seq}`,
  eventType: 'EntryRecorded',
  eventVersion: 1,
  occurredAt: new Date().toISOString(),
  data: { entryId: `e-${seq}`, merchantId, type, amountCents, entryDate },
});
