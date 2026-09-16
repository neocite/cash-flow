import { Injectable } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';
import { EntryRepository } from '../../application/ports';
import { Entry, EntryRecordedEvent, EntryType } from '../../domain/entry';
import { DuplicateIdempotencyKeyError } from '../../shared/errors';
import { MongoProvider } from './mongo.provider';

interface EntryDoc {
  _id: string;
  merchantId: string;
  type: EntryType;
  amountCents: number;
  description: string;
  entryDate: string;
  createdAt: Date;
  idempotencyKey?: string;
}

export interface OutboxDoc {
  _id: string;
  key: string;
  payload: EntryRecordedEvent;
  status: 'PENDING' | 'PUBLISHED';
  attempts: number;
  createdAt: Date;
  lockedUntil: Date | null;
  lockedBy?: string | null;
  publishedAt?: Date;
}

@Injectable()
export class MongoEntryRepository implements EntryRepository {
  constructor(private readonly mongo: MongoProvider) {}

  private get entries(): Collection<EntryDoc> {
    return this.mongo.db.collection<EntryDoc>('entries');
  }
  private get outbox(): Collection<OutboxDoc> {
    return this.mongo.db.collection<OutboxDoc>('outbox');
  }

  async saveWithEvent(entry: Entry, event: EntryRecordedEvent): Promise<void> {
    const session = this.mongo.client.startSession();
    try {
      await session.withTransaction(async () => {
        const doc: EntryDoc = {
          _id: entry.id,
          merchantId: entry.merchantId,
          type: entry.type,
          amountCents: entry.amountCents,
          description: entry.description,
          entryDate: entry.entryDate,
          createdAt: entry.createdAt,
        };
        if (entry.idempotencyKey) doc.idempotencyKey = entry.idempotencyKey;
        await this.entries.insertOne(doc, { session });
        await this.outbox.insertOne(
          {
            _id: event.eventId,
            // Partition key merchant+date: events for the same balance land together
            key: `${entry.merchantId}:${entry.entryDate}`,
            payload: event,
            status: 'PENDING',
            attempts: 0,
            createdAt: entry.createdAt,
            lockedUntil: null,
          },
          { session },
        );
      });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        throw new DuplicateIdempotencyKeyError();
      }
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async findById(merchantId: string, id: string) {
    const doc = await this.entries.findOne({ _id: id, merchantId });
    return doc ? this.toEntity(doc) : null;
  }

  async findByIdempotencyKey(merchantId: string, key: string) {
    const doc = await this.entries.findOne({ merchantId, idempotencyKey: key });
    return doc ? this.toEntity(doc) : null;
  }

  async listByDate(merchantId: string, date: string, limit: number, afterId?: string) {
    const filter: Record<string, unknown> = { merchantId, entryDate: date };
    if (afterId) filter._id = { $gt: afterId };
    const docs = await this.entries.find(filter).sort({ _id: 1 }).limit(limit).toArray();
    return docs.map((d) => this.toEntity(d));
  }

  private toEntity(d: EntryDoc): Entry {
    return Entry.restore({ ...d, id: d._id });
  }
}
