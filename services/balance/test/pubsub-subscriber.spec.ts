import { Message } from '@google-cloud/pubsub';
import { ApplyEntryUseCase } from '../src/application/apply-entry.usecase';
import { PubSubSubscriberService } from '../src/infra/pubsub/pubsub-subscriber.service';
import { config } from '../src/shared/config';
import { event, InMemoryBalanceRepository } from './fakes';

const message = (value: string, id = 'msg-1') => {
  const ack = jest.fn();
  const nack = jest.fn();
  return { id, data: Buffer.from(value), ack, nack } as unknown as Message & {
    ack: jest.Mock;
    nack: jest.Mock;
  };
};

describe('PubSubSubscriberService.handle', () => {
  let repo: InMemoryBalanceRepository;
  let svc: PubSubSubscriberService;

  beforeEach(() => {
    repo = new InMemoryBalanceRepository();
    svc = new PubSubSubscriberService(new ApplyEntryUseCase(repo), config());
  });
  afterEach(() => svc.onApplicationShutdown());

  it('applies a valid event and acks', async () => {
    const m = message(JSON.stringify(event('CREDIT', 100)));
    await svc.handle(m);
    expect(repo.processed.size).toBe(1);
    expect(m.ack).toHaveBeenCalled();
    expect(m.nack).not.toHaveBeenCalled();
  });

  it('acks and discards invalid JSON instead of blocking the subscription', async () => {
    const m = message('{not-json');
    await svc.handle(m);
    expect(repo.processed.size).toBe(0);
    expect(m.ack).toHaveBeenCalled();
  });

  it('acks and discards an event with an invalid contract', async () => {
    const m = message(JSON.stringify({ ...event('CREDIT', 1), eventVersion: 99 }));
    await svc.handle(m);
    expect(repo.processed.size).toBe(0);
    expect(m.ack).toHaveBeenCalled();
  });

  it('nacks on a transient error so Pub/Sub redelivers', async () => {
    repo.down = true;
    const m = message(JSON.stringify(event('CREDIT', 1)));
    await svc.handle(m);
    expect(m.nack).toHaveBeenCalled();
    expect(m.ack).not.toHaveBeenCalled();
  });

  it('a redelivered event is not counted twice', async () => {
    const e = event('CREDIT', 250);
    await svc.handle(message(JSON.stringify(e), 'first-delivery'));
    await svc.handle(message(JSON.stringify(e), 'redelivery'));
    const [balance] = await repo.findRange('m1', '2026-09-16', '2026-09-16');
    expect(balance.balanceCents).toBe(250);
  });
});
