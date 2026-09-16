import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { PubSubSubscriberService } from '../infra/pubsub/pubsub-subscriber.service';
import { MongoProvider } from '../infra/mongo/mongo.provider';
import { register } from '../shared/metrics';

@Controller()
export class HealthController {
  constructor(
    private readonly mongo: MongoProvider,
    private readonly subscriber: PubSubSubscriberService,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    const mongo = await this.mongo.ping();
    const consumer = this.subscriber.healthy;
    if (!mongo) throw new ServiceUnavailableException({ status: 'unavailable', mongo: 'down' });
    // A stopped subscriber does not take reads down; it reports degraded and the
    // real alert comes from the subscription backlog.
    return { status: consumer ? 'ok' : 'degraded', mongo: 'up', consumer: consumer ? 'up' : 'down' };
  }

  @Get('metrics')
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}
