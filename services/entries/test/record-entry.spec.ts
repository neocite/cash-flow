import { RecordEntryUseCase } from '../src/application/record-entry.usecase';
import { DuplicateIdempotencyKeyError } from '../src/shared/errors';
import { testConfig, InMemoryRepository } from './fakes';

describe('RecordEntryUseCase', () => {
  const clock = { now: () => new Date('2026-09-16T15:00:00Z') };
  let repo: InMemoryRepository;
  let uc: RecordEntryUseCase;

  beforeEach(() => {
    repo = new InMemoryRepository();
    uc = new RecordEntryUseCase(repo, clock, testConfig());
  });

  it('persists the entry and writes the event to the outbox', async () => {
    const r = await uc.execute({ merchantId: 'm1', type: 'DEBIT', amountCents: 500 });
    expect(r.created).toBe(true);
    expect(repo.entries).toHaveLength(1);
    expect(repo.outbox).toHaveLength(1);
    expect(repo.outbox[0].key).toBe('m1:2026-09-16');
  });

  it('is idempotent by Idempotency-Key (a client retry does not duplicate)', async () => {
    const cmd = { merchantId: 'm1', type: 'CREDIT', amountCents: 100, idempotencyKey: 'order-12345' };
    const a = await uc.execute(cmd);
    const b = await uc.execute(cmd);
    expect(b.created).toBe(false);
    expect(b.entry.id).toBe(a.entry.id);
    expect(repo.entries).toHaveLength(1);
    expect(repo.outbox).toHaveLength(1);
  });

  it('does not clash when different merchants use the same key', async () => {
    await uc.execute({ merchantId: 'm1', type: 'CREDIT', amountCents: 100, idempotencyKey: 'same-key' });
    const r = await uc.execute({ merchantId: 'm2', type: 'CREDIT', amountCents: 100, idempotencyKey: 'same-key' });
    expect(r.created).toBe(true);
  });

  it('settles an idempotency race through the unique index', async () => {
    const cmd = { merchantId: 'm1', type: 'CREDIT', amountCents: 100, idempotencyKey: 'race-01' };
    const first = await uc.execute(cmd);
    // Simulates the other request that passed the lookup before the concurrent insert
    jest.spyOn(repo, 'findByIdempotencyKey').mockResolvedValueOnce(null);
    const save = jest.spyOn(repo, 'saveWithEvent');
    const r = await uc.execute(cmd);
    expect(save).toHaveBeenCalled();
    await expect(save.mock.results[0].value).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
    expect(r).toEqual({ entry: first.entry, created: false });
  });
});
