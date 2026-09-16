import { ApplyEntryUseCase } from '../src/application/apply-entry.usecase';
import { GetBalanceUseCase } from '../src/application/get-balance.usecase';
import { config } from '../src/shared/config';
import { event, InMemoryBalanceRepository } from './fakes';

describe('Daily balance: use cases', () => {
  let repo: InMemoryBalanceRepository;
  let apply: ApplyEntryUseCase;
  let get: GetBalanceUseCase;

  beforeEach(() => {
    repo = new InMemoryBalanceRepository();
    apply = new ApplyEntryUseCase(repo);
    get = new GetBalanceUseCase(repo, config());
  });

  it('consolidates the credits and debits of the day', async () => {
    await apply.execute(event('CREDIT', 10_000));
    await apply.execute(event('CREDIT', 2_550));
    await apply.execute(event('DEBIT', 4_000));
    const r = await get.execute('m1', '2026-09-16', '2026-09-16');
    expect(r.days[0]).toMatchObject({
      totalCreditsCents: 12_550,
      totalDebitsCents: 4_000,
      balanceCents: 8_550,
      entryCount: 3,
    });
  });

  it('is idempotent: an event redelivered by the broker is not counted twice', async () => {
    const e = event('CREDIT', 500);
    expect(await apply.execute(e)).toBe('applied');
    expect(await apply.execute(e)).toBe('duplicate');
    const r = await get.execute('m1', '2026-09-16', '2026-09-16');
    expect(r.days[0].balanceCents).toBe(500);
  });

  it('the result does not depend on arrival order (commutative)', async () => {
    const events = [event('CREDIT', 700), event('DEBIT', 200), event('DEBIT', 900), event('CREDIT', 50)];
    const other = new InMemoryBalanceRepository();
    const applyOther = new ApplyEntryUseCase(other);
    for (const e of events) await apply.execute(e);
    for (const e of [...events].reverse()) await applyOther.execute(e);
    expect((await repo.findRange('m1', '2026-09-16', '2026-09-16'))[0].balanceCents).toBe(-350);
    expect((await other.findRange('m1', '2026-09-16', '2026-09-16'))[0].balanceCents).toBe(-350);
  });

  it('the range report fills days without movement and sums the totals', async () => {
    await apply.execute(event('CREDIT', 1_000, '2026-09-14'));
    await apply.execute(event('DEBIT', 250, '2026-09-16'));
    await apply.execute(event('CREDIT', 99_999, '2026-09-16', 'other-merchant'));
    const r = await get.execute('m1', '2026-09-14', '2026-09-16');
    expect(r.days.map((d) => d.balanceCents)).toEqual([1_000, 0, -250]);
    expect(r.totals).toEqual({ creditsCents: 1_000, debitsCents: 250, balanceCents: 750 });
  });

  it('an infrastructure error propagates (so the consumer retries) without marking the event', async () => {
    const e = event('CREDIT', 10);
    repo.down = true;
    await expect(apply.execute(e)).rejects.toThrow('mongo unavailable');
    repo.down = false;
    expect(await apply.execute(e)).toBe('applied');
  });
});
