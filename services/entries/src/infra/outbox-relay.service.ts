import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { hostname } from 'node:os';
import { EVENT_PUBLISHER, EventPublisher, OUTBOX_REPOSITORY, OutboxRepository } from '../application/ports';
import { CONFIG, Config } from '../shared/config';
import { outboxFailures, outboxPublished } from '../shared/metrics';

/**
 * Transactional Outbox relay: reads pending events and publishes them.
 * If Pub/Sub (or the balance service) is down, entries keep being accepted and
 * pile up in the outbox; publishing resumes on its own.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly workerId = `${hostname()}-${process.pid}`;
  private active = false;
  private loopPromise?: Promise<void>;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  onApplicationBootstrap() {
    if (this.cfg.mode === 'api') return;
    this.active = true;
    this.loopPromise = this.loop();
    this.logger.log(`Outbox relay started (${this.workerId})`);
  }

  private async loop() {
    let delay = this.cfg.relay.intervalMs;
    while (this.active) {
      try {
        const published = await this.processBatch();
        delay = published === this.cfg.relay.batchSize ? 0 : this.cfg.relay.intervalMs;
      } catch (e) {
        // Exponential backoff capped at 30s
        delay = Math.min(Math.max(delay * 2, 1000), 30000);
        this.logger.warn(`Relay failed, retrying in ${delay}ms: ${(e as Error).message}`);
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  }

  /** Exposed for tests. Returns how many events were published. */
  async processBatch(): Promise<number> {
    const batch = await this.outbox.reserveBatch(this.workerId, this.cfg.relay.batchSize, this.cfg.relay.lockMs);
    if (!batch.length) return 0;
    const ids = batch.map((m) => m.id);
    try {
      await this.publisher.publish(batch);
    } catch (e) {
      outboxFailures.inc(batch.length);
      await this.outbox.release(ids).catch(() => undefined);
      throw e;
    }
    // Dying here, after publishing and before marking, republishes the event.
    // That is why the consumer is idempotent by eventId.
    await this.outbox.markPublished(ids);
    outboxPublished.inc(batch.length);
    return batch.length;
  }

  async onApplicationShutdown() {
    this.active = false;
    await this.loopPromise;
  }
}
