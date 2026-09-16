import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';
import { CONFIG, Config } from '../../shared/config';

@Injectable()
export class MongoProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoProvider.name);
  readonly client: MongoClient;
  db!: Db;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    this.client = new MongoClient(cfg.mongo.uri, {
      // Durability: majority acknowledgement before answering 201.
      writeConcern: { w: 'majority' },
      readConcern: { level: 'majority' },
      retryWrites: true,
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
    });
  }

  async onModuleInit() {
    await this.client.connect();
    this.db = this.client.db(this.cfg.mongo.database);
    await this.createIndexes();
    this.logger.log('MongoDB connected');
  }

  private async createIndexes() {
    const entries = this.db.collection('entries');
    await entries.createIndex({ merchantId: 1, entryDate: 1, _id: 1 });
    await entries.createIndex(
      { merchantId: 1, idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
    );
    const outbox = this.db.collection('outbox');
    await outbox.createIndex({ status: 1, lockedUntil: 1, _id: 1 });
    // Published events expire after 7 days; the entries ledger is the source for a rebuild.
    await outbox.createIndex({ publishedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
