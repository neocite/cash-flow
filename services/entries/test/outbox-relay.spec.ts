import { RecordEntryUseCase } from '../src/application/record-entry.usecase';
import { OutboxRelayService } from '../src/infra/outbox-relay.service';
import { testConfig, FakePublisher, InMemoryRepository } from './fakes';

describe('Transactional Outbox: resilience', () => {
  const cfg = { ...testConfig(), mode: 'api' as const };
  let repo: InMemoryRepository;
  let publisher: FakePublisher;
  let relay: OutboxRelayService;
  let uc: RecordEntryUseCase;

  beforeEach(() => {
    repo = new InMemoryRepository();
    publisher = new FakePublisher();
    relay = new OutboxRelayService(repo, publisher, cfg);
    uc = new RecordEntryUseCase(repo, { now: () => new Date() }, cfg);
  });

  it('keeps accepting entries while the broker is down and publishes once it is back', async () => {
    publisher.down = true;
    for (let i = 0; i < 3; i++) {
      await uc.execute({ merchantId: 'm1', type: 'CREDIT', amountCents: 100 + i });
    }
    await expect(relay.processBatch()).rejects.toThrow('broker unavailable');
    expect(repo.entries).toHaveLength(3); // writes were not affected
    expect(repo.outbox.every((m) => !m.published && !m.locked)).toBe(true); // lock released

    publisher.down = false;
    await expect(relay.processBatch()).resolves.toBe(3);
    expect(publisher.published.map((m) => m.payload.data.amountCents)).toEqual([100, 101, 102]);
    expect(repo.outbox.every((m) => m.published)).toBe(true);
    await expect(relay.processBatch()).resolves.toBe(0);
  });
});
