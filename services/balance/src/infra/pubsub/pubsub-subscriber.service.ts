import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Message, PubSub, Subscription } from '@google-cloud/pubsub';
import { ApplyEntryUseCase } from '../../application/apply-entry.usecase';
import { InvalidEventError } from '../../domain/daily-balance';
import { CONFIG, Config } from '../../shared/config';
import { eventsProcessed } from '../../shared/metrics';

/**
 * Entry topic subscriber. At-least-once: the message is only acked after the
 * event is applied to Mongo, and idempotency by eventId lives in the repository.
 * A transient error nacks, so Pub/Sub redelivers with backoff.
 * A malformed event is acked and discarded so it cannot block the subscription.
 * TODO: route it to a dead-letter topic instead.
 */
@Injectable()
export class PubSubSubscriberService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PubSubSubscriberService.name);
  private readonly client: PubSub;
  private subscription?: Subscription;
  private running = false;

  constructor(
    private readonly applyEntry: ApplyEntryUseCase,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {
    this.client = new PubSub({ projectId: cfg.pubsub.projectId });
  }

  get healthy(): boolean {
    return this.cfg.mode === 'api' || this.running;
  }

  onApplicationBootstrap() {
    if (this.cfg.mode === 'api') return;
    this.subscription = this.client.subscription(this.cfg.pubsub.subscription, {
      flowControl: { maxMessages: this.cfg.pubsub.maxConcurrent },
    });
    this.subscription.on('message', (m) => void this.handle(m));
    this.subscription.on('error', (e: Error) => {
      this.running = false;
      this.logger.error(`Subscription error: ${e.message}`);
    });
    this.running = true;
    this.logger.log(`Consuming ${this.cfg.pubsub.subscription}`);
  }

  async handle(message: Message) {
    try {
      await this.applyEntry.execute(JSON.parse(message.data.toString() || 'null'));
      message.ack();
    } catch (e) {
      if (e instanceof SyntaxError || e instanceof InvalidEventError) {
        this.logger.warn(`Event discarded (${message.id}): ${(e as Error).message}`);
        eventsProcessed.inc({ outcome: 'discarded' });
        message.ack();
        return;
      }
      // Transient: nack so Pub/Sub redelivers instead of losing the event.
      this.logger.error(`Failed to apply event ${message.id}: ${(e as Error).message}`);
      message.nack();
    }
  }

  async onApplicationShutdown() {
    this.running = false;
    await this.subscription?.close().catch(() => undefined);
    await this.client.close().catch(() => undefined);
  }
}
