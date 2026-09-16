import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PubSub, Topic } from '@google-cloud/pubsub';
import { EventPublisher, OutboxMessage } from '../../application/ports';
import { CONFIG, Config } from '../../shared/config';

@Injectable()
export class PubSubPublisher implements EventPublisher, OnModuleDestroy {
  private readonly logger = new Logger(PubSubPublisher.name);
  private readonly client: PubSub;
  private readonly topic: Topic;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    // With PUBSUB_EMULATOR_HOST set, the client talks to the local emulator.
    this.client = new PubSub({ projectId: cfg.pubsub.projectId });
    this.topic = this.client.topic(cfg.pubsub.topic, {
      batching: { maxMessages: 100, maxMilliseconds: 50 },
    });
  }

  async publish(messages: OutboxMessage[]): Promise<void> {
    if (!messages.length) return;
    // Published in parallel; a rejection fails the batch and the relay releases
    // the lock, so the events are picked up again on the next round.
    await Promise.all(
      messages.map((m) =>
        this.topic.publishMessage({
          data: Buffer.from(JSON.stringify(m.payload)),
          attributes: {
            'event-id': m.id,
            'event-type': m.payload.eventType,
            'event-version': String(m.payload.eventVersion),
            // Not an ordering key: applying a balance delta is commutative.
            // Kept as an attribute because it makes a stuck event easy to trace.
            'merchant-day': m.key,
          },
        }),
      ),
    );
    this.logger.debug(`${messages.length} event(s) published to ${this.cfg.pubsub.topic}`);
  }

  async onModuleDestroy() {
    await this.client.close().catch(() => undefined);
  }
}
