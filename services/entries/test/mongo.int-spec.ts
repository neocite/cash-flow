import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoEntryRepository } from '../src/infra/mongo/mongo-entry.repository';
import { MongoOutboxRepository } from '../src/infra/mongo/mongo-outbox.repository';
import { MongoProvider } from '../src/infra/mongo/mongo.provider';
import { Entry } from '../src/domain/entry';
import { config } from '../src/shared/config';
import { DuplicateIdempotencyKeyError } from '../src/shared/errors';

/**
 * Integration against a real MongoDB (in-memory replica set), covering the
 * entry+outbox transaction, the idempotency index and the relay lock.
 */
describe('MongoDB (integration)', () => {
  let rs: MongoMemoryReplSet | undefined;
  let mongo: MongoProvider;
  let repo: MongoEntryRepository;
  let outbox: MongoOutboxRepository;

  beforeAll(async () => {
    // Uses the compose Mongo when MONGO_TEST_URI is set, otherwise an in-memory replica set.
    let uri = process.env.MONGO_TEST_URI;
    if (!uri) {
      rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
      uri = rs.getUri();
    }
    const database = `test_${Date.now()}`;
    mongo = new MongoProvider({ ...config(), mongo: { uri, database } });
    await mongo.onModuleInit();
    repo = new MongoEntryRepository(mongo);
    outbox = new MongoOutboxRepository(mongo);
  });
  afterAll(async () => {
    await mongo?.db.dropDatabase();
    await mongo?.onModuleDestroy();
    await rs?.stop();
  });

  const newEntry = (key?: string) =>
    Entry.create({ merchantId: 'm1', type: 'CREDIT', amountCents: 100, idempotencyKey: key }, new Date(), 'America/Sao_Paulo');

  it('writes entry and outbox atomically; a duplicate key leaves no orphan event', async () => {
    const a = newEntry('int-key-1');
    await repo.saveWithEvent(a, a.toEvent());
    const b = newEntry('int-key-1');
    await expect(repo.saveWithEvent(b, b.toEvent())).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);

    expect(await mongo.db.collection('entries').countDocuments()).toBe(1);
    expect(await mongo.db.collection('outbox').countDocuments()).toBe(1); // b's event rolled back
    expect((await repo.findByIdempotencyKey('m1', 'int-key-1'))?.id).toBe(a.id);
  });

  it('two relay workers never reserve the same event', async () => {
    for (let i = 0; i < 5; i++) {
      const e = newEntry();
      await repo.saveWithEvent(e, e.toEvent());
    }
    const [w1, w2] = await Promise.all([outbox.reserveBatch('w1', 4, 30000), outbox.reserveBatch('w2', 4, 30000)]);
    const ids = [...w1, ...w2].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);

    await outbox.markPublished(ids);
    expect(await outbox.reserveBatch('w3', 10, 30000)).toHaveLength(0);
  });

  it('lists by date with cursor pagination', async () => {
    const today = newEntry().entryDate;
    const p1 = await repo.listByDate('m1', today, 4);
    const p2 = await repo.listByDate('m1', today, 4, p1[3].id);
    expect(p1).toHaveLength(4);
    expect(p2).toHaveLength(2);
    expect(p1.map((e) => e.id)).toEqual([...p1.map((e) => e.id)].sort());
  });
});
