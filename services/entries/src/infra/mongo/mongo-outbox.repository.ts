import { Injectable } from '@nestjs/common';
import { Collection } from 'mongodb';
import { OutboxMessage, OutboxRepository } from '../../application/ports';
import { MongoProvider } from './mongo.provider';
import { OutboxDoc } from './mongo-entry.repository';

@Injectable()
export class MongoOutboxRepository implements OutboxRepository {
  constructor(private readonly mongo: MongoProvider) {}

  private get outbox(): Collection<OutboxDoc> {
    return this.mongo.db.collection<OutboxDoc>('outbox');
  }

  /**
   * Reserves one document at a time with findOneAndUpdate (atomic), so several
   * relay replicas never publish the same event in parallel. If a worker dies,
   * the lock expires and another one picks it up (at-least-once).
   */
  async reserveBatch(workerId: string, size: number, lockMs: number): Promise<OutboxMessage[]> {
    const now = new Date();
    const reserved: OutboxMessage[] = [];
    for (let i = 0; i < size; i++) {
      const doc = await this.outbox.findOneAndUpdate(
        {
          status: 'PENDING',
          $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
        },
        {
          $set: { lockedUntil: new Date(now.getTime() + lockMs), lockedBy: workerId },
          $inc: { attempts: 1 },
        },
        { sort: { _id: 1 }, returnDocument: 'after' },
      );
      if (!doc) break;
      reserved.push({ id: doc._id, key: doc.key, payload: doc.payload });
    }
    return reserved;
  }

  async markPublished(ids: string[]) {
    if (!ids.length) return;
    await this.outbox.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'PUBLISHED', publishedAt: new Date(), lockedUntil: null, lockedBy: null } },
    );
  }

  async release(ids: string[]) {
    if (!ids.length) return;
    await this.outbox.updateMany({ _id: { $in: ids } }, { $set: { lockedUntil: null, lockedBy: null } });
  }
}
