import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { MongoProvider } from '../infra/mongo/mongo.provider';
import { register } from '../shared/metrics';

/**
 * Liveness depends on nothing external, to avoid cascading restarts.
 * Readiness depends ONLY on MongoDB: Pub/Sub being down does not take the service
 * out of rotation, because events pile up in the outbox.
 */
@Controller()
export class HealthController {
  constructor(private readonly mongo: MongoProvider) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    if (!(await this.mongo.ping())) throw new ServiceUnavailableException({ status: 'degraded', mongo: 'down' });
    return { status: 'ok', mongo: 'up' };
  }

  @Get('metrics')
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}
