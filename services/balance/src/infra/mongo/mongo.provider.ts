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
      writeConcern: { w: 'majority' },
      readConcern: { level: 'majority' },
      retryWrites: true,
      maxPoolSize: 50,
      // Report reads can go to secondaries (read scaling)
      readPreference: 'primaryPreferred',
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
    // daily_balances uses _id = "<merchant>:<date>", so reads hit the primary key.
    await this.db.collection('daily_balances').createIndex({ merchantId: 1, date: 1 });
    // Idempotency ledger; expires after 30 days (longer than the Pub/Sub retention).
    await this.db
      .collection('processed_events')
      .createIndex({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
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
