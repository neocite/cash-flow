import { Injectable } from '@nestjs/common';
import { BalanceRepository } from '../../application/ports';
import { BalanceDelta, DailyBalance } from '../../domain/daily-balance';
import { MongoProvider } from './mongo.provider';

interface BalanceDoc {
  _id: string;
  merchantId: string;
  date: string;
  totalCreditsCents: number;
  totalDebitsCents: number;
  entryCount: number;
  updatedAt: Date;
}

@Injectable()
export class MongoBalanceRepository implements BalanceRepository {
  constructor(private readonly mongo: MongoProvider) {}

  async apply(delta: BalanceDelta): Promise<boolean> {
    const session = this.mongo.client.startSession();
    let applied = false;
    try {
      await session.withTransaction(async () => {
        applied = false;
        // upsert, not insert with a catch on 11000: a write error inside a
        // transaction aborts it on the server and the replay would never commit.
        const marked = await this.mongo.db
          .collection<{ _id: string; processedAt: Date }>('processed_events')
          .updateOne({ _id: delta.eventId }, { $setOnInsert: { processedAt: new Date() } }, { upsert: true, session });
        if (!marked.upsertedCount) return; // already applied
        await this.mongo.db.collection<BalanceDoc>('daily_balances').updateOne(
          { _id: `${delta.merchantId}:${delta.date}` },
          {
            $inc: {
              totalCreditsCents: delta.creditsCents,
              totalDebitsCents: delta.debitsCents,
              entryCount: 1,
            },
            $set: { updatedAt: new Date() },
            $setOnInsert: { merchantId: delta.merchantId, date: delta.date },
          },
          { upsert: true, session },
        );
        applied = true;
      });
    } finally {
      await session.endSession();
    }
    return applied;
  }

  async findRange(merchantId: string, from: string, to: string): Promise<DailyBalance[]> {
    const docs = await this.mongo.db
      .collection<BalanceDoc>('daily_balances')
      .find({ merchantId, date: { $gte: from, $lte: to } })
      .sort({ date: 1 })
      .toArray();
    return docs.map((d) => ({
      merchantId: d.merchantId,
      date: d.date,
      totalCreditsCents: d.totalCreditsCents,
      totalDebitsCents: d.totalDebitsCents,
      balanceCents: d.totalCreditsCents - d.totalDebitsCents,
      entryCount: d.entryCount,
      updatedAt: d.updatedAt,
    }));
  }
}
