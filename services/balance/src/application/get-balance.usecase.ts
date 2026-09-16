import { Inject, Injectable } from '@nestjs/common';
import { datesInRange, DailyBalance, emptyBalance } from '../domain/daily-balance';
import { CONFIG, Config } from '../shared/config';
import { BALANCE_REPOSITORY, BalanceRepository } from './ports';

export interface BalanceReport {
  merchantId: string;
  from: string;
  to: string;
  days: DailyBalance[];
  totals: { creditsCents: number; debitsCents: number; balanceCents: number };
}

@Injectable()
export class GetBalanceUseCase {
  constructor(
    @Inject(BALANCE_REPOSITORY) private readonly repo: BalanceRepository,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async execute(merchantId: string, from: string, to: string): Promise<BalanceReport> {
    // Bounded by maxDays (31), so the read cost is O(days) and never O(entries):
    // the worker already collapsed every entry into one document per day.
    const dates = datesInRange(from, to, this.cfg.query.maxDays);
    const found = new Map((await this.repo.findRange(merchantId, from, to)).map((b) => [b.date, b]));
    // Days without movement show up with a zero balance (continuous report)
    const days = dates.map((d) => found.get(d) ?? emptyBalance(merchantId, d));

    const totals = days.reduce(
      (t, d) => ({
        creditsCents: t.creditsCents + d.totalCreditsCents,
        debitsCents: t.debitsCents + d.totalDebitsCents,
        balanceCents: t.balanceCents + d.balanceCents,
      }),
      { creditsCents: 0, debitsCents: 0, balanceCents: 0 },
    );
    return { merchantId, from, to, days, totals };
  }
}
