import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EntriesController } from './api/entries.controller';
import { HealthController } from './api/health.controller';
import { ProblemDetailsFilter } from './api/http-exception.filter';
import { ListEntriesUseCase } from './application/list-entries.usecase';
import { CLOCK, ENTRY_REPOSITORY, EVENT_PUBLISHER, OUTBOX_REPOSITORY } from './application/ports';
import { RecordEntryUseCase } from './application/record-entry.usecase';
import { PubSubPublisher } from './infra/pubsub/pubsub-publisher';
import { MongoEntryRepository } from './infra/mongo/mongo-entry.repository';
import { MongoOutboxRepository } from './infra/mongo/mongo-outbox.repository';
import { MongoProvider } from './infra/mongo/mongo.provider';
import { OutboxRelayService } from './infra/outbox-relay.service';
import { CONFIG, config } from './shared/config';

@Module({
  controllers: [EntriesController, HealthController],
  providers: [
    { provide: CONFIG, useFactory: config },
    MongoProvider,
    { provide: ENTRY_REPOSITORY, useClass: MongoEntryRepository },
    { provide: OUTBOX_REPOSITORY, useClass: MongoOutboxRepository },
    { provide: EVENT_PUBLISHER, useClass: PubSubPublisher },
    { provide: CLOCK, useValue: { now: () => new Date() } },
    RecordEntryUseCase,
    ListEntriesUseCase,
    OutboxRelayService,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
