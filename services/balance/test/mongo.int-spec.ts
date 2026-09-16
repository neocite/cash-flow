import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { parseEvent } from '../src/domain/daily-balance';
import { MongoBalanceRepository } from '../src/infra/mongo/mongo-balance.repository';
import { MongoProvider } from '../src/infra/mongo/mongo.provider';
import { config } from '../src/shared/config';
import { event } from './fakes';

describe('MongoBalanceRepository (integration)', () => {
  let rs: MongoMemoryReplSet | undefined;
  let mongo: MongoProvider;
  let repo: MongoBalanceRepository;

  beforeAll(async () => {
    let uri = process.env.MONGO_TEST_URI;
    if (!uri) {
      rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
      uri = rs.getUri();
    }
    mongo = new MongoProvider({ ...config(), mongo: { uri, database: `test_${Date.now()}` } });
    await mongo.onModuleInit();
    repo = new MongoBalanceRepository(mongo);
  });
  afterAll(async () => {
    await mongo?.db.dropDatabase();
    await mongo?.onModuleDestroy();
    await rs?.stop();
  });

  it('applies concurrent deltas and ignores duplicates', async () => {
    const events = Array.from({ length: 20 }, (_, i) => event(i % 2 ? 'DEBIT' : 'CREDIT', 100));
    const duplicates = events.slice(0, 5);
    const results = await Promise.all([...events, ...duplicates].map((e) => repo.apply(parseEvent(e))));
    expect(results.filter(Boolean)).toHaveLength(20);

    const [balance] = await repo.findRange('m1', '2026-09-16', '2026-09-16');
    expect(balance).toMatchObject({ totalCreditsCents: 1000, totalDebitsCents: 1000, balanceCents: 0, entryCount: 20 });
  });
});
